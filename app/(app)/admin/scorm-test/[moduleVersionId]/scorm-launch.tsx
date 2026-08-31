"use client";

import { useEffect, useRef, useState } from "react";
import { Scorm12API, Scorm2004API } from "scorm-again";

type ScormApiInstance = InstanceType<typeof Scorm12API> | InstanceType<typeof Scorm2004API>;

export function ScormLaunch({
  moduleVersionId,
  contentUrl,
  scormVersion,
}: {
  moduleVersionId: string;
  contentUrl: string;
  scormVersion: string;
}) {
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [lastStatus, setLastStatus] = useState<string>("not started");
  const apiRef = useRef<ScormApiInstance | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function createAttempt() {
      const response = await fetch("/api/scorm/attempts", {
        method: "POST",
        body: JSON.stringify({ moduleVersionId, userId: "admin-test-user" }),
      });
      const body = await response.json();
      if (cancelled) return;
      setAttemptId(body.attemptId);

      // SCORM 1.2 SCOs look for `window.API` and call LMSInitialize/LMSCommit;
      // SCORM 2004 SCOs look for `window.API_1484_11` and call Initialize/Commit
      // (no "LMS" prefix - verified against node_modules/scorm-again's real
      // Scorm2004API, which is a distinct exported class, not a settings flag
      // on Scorm12API). The event scorm-again's BaseAPI.commit() fires also
      // differs by version: it's literally the method name passed as
      // `callbackName` - "LMSCommit" for 1.2, "Commit" for 2004 (verified
      // against node_modules/scorm-again/dist/esm/scorm-again.js).
      const is2004 = scormVersion === "2004";
      const api: ScormApiInstance = is2004
        ? new Scorm2004API({ autocommit: true, lmsCommitUrl: false })
        : new Scorm12API({ autocommit: true, lmsCommitUrl: false });

      api.on(is2004 ? "Commit" : "LMSCommit", async () => {
        // `api.cmi.toJSON()` returns a NESTED object ({ core: {...}, ... } for
        // 1.2, or the 2004 equivalent) with no "cmi." prefix - it does NOT
        // match the flattened dotted-key shape ("cmi.core.lesson_status",
        // "cmi.completion_status", "cmi.suspend_data", ...) that the commit
        // route (app/api/scorm/commit/route.ts) expects. `api.getFlattenedCMI()`
        // is BaseAPI's public method (shared by both API classes) that returns
        // exactly that flattened shape.
        const cmi = api.getFlattenedCMI() as Record<string, unknown>;
        setLastStatus(
          String(cmi["cmi.core.lesson_status"] ?? cmi["cmi.completion_status"] ?? "committed")
        );
        await fetch("/api/scorm/commit", {
          method: "POST",
          body: JSON.stringify({ attemptId: body.attemptId, cmi }),
        });
      });
      if (is2004) {
        (window as unknown as { API_1484_11: typeof api }).API_1484_11 = api;
      } else {
        (window as unknown as { API: typeof api }).API = api;
      }
      apiRef.current = api;
    }

    createAttempt();
    return () => {
      cancelled = true;
    };
  }, [moduleVersionId, scormVersion]);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Attempt: {attemptId ?? "creating..."} — last commit: {lastStatus}
      </p>
      {/*
        Gate the iframe's mount on `attemptId` (set only after `window.API` is
        assigned in the effect above). A SCORM 1.2 SCO calls LMSInitialize as
        soon as its own document loads and expects to find `window.API`
        immediately via the window-hierarchy lookup. If the iframe mounted
        unconditionally, the browser could start loading/executing the SCO
        before the async POST /api/scorm/attempts round trip resolves and
        `window.API = api` runs, causing an intermittent, network-timing-
        dependent LMSInitialize failure that would be easy to misread as a
        content/package problem instead of a load-order bug.
      */}
      {attemptId ? (
        <iframe src={contentUrl} className="h-[600px] w-full rounded border" title="SCORM content" />
      ) : (
        <div className="flex h-[600px] w-full items-center justify-center rounded border text-sm text-muted-foreground">
          Preparing SCORM runtime…
        </div>
      )}
    </div>
  );
}
