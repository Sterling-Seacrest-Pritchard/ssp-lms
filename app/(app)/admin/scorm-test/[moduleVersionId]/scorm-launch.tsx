"use client";

import { useEffect, useRef, useState } from "react";
import { Scorm12API } from "scorm-again";

export function ScormLaunch({
  moduleVersionId,
  contentUrl,
}: {
  moduleVersionId: string;
  contentUrl: string;
}) {
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [lastStatus, setLastStatus] = useState<string>("not started");
  const apiRef = useRef<InstanceType<typeof Scorm12API> | null>(null);

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

      const api = new Scorm12API({
        autocommit: true,
        lmsCommitUrl: false,
      });
      // NOTE: `lmsCommitUrl: false` disables scorm-again's own network commit,
      // so the "CommitSuccess"/"CommitError" events (only fired after an HTTP
      // request completes) never fire. Instead we hook "LMSCommit", which
      // scorm-again's BaseAPI.commit() fires unconditionally via
      // `this.processListeners(callbackName)` every time the SCO calls
      // LMSCommit (or autocommit triggers it) - verified against
      // node_modules/scorm-again/dist/esm/scorm-again.js.
      api.on("LMSCommit", async () => {
        // `api.cmi.toJSON()` returns a NESTED object ({ core: {...}, ... })
        // with no "cmi." prefix - it does NOT match the flattened dotted-key
        // shape ("cmi.core.lesson_status", "cmi.suspend_data", ...) that the
        // Task 5 commit route (app/api/scorm/commit/route.ts) expects.
        // `api.getFlattenedCMI()` is BaseAPI's public method that returns
        // exactly that flattened shape (it flattens `{ cmi: this.cmi.toJSON() }`),
        // so we use it here instead of the brief's original guess.
        const cmi = api.getFlattenedCMI() as Record<string, unknown>;
        setLastStatus(String(cmi["cmi.core.lesson_status"] ?? "committed"));
        await fetch("/api/scorm/commit", {
          method: "POST",
          body: JSON.stringify({ attemptId: body.attemptId, cmi }),
        });
      });
      (window as unknown as { API: typeof api }).API = api;
      apiRef.current = api;
    }

    createAttempt();
    return () => {
      cancelled = true;
    };
  }, [moduleVersionId]);

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
