"use client";

import { useEffect, useRef, useState } from "react";
import { Scorm12API, Scorm2004API } from "scorm-again";

type ScormApiInstance = InstanceType<typeof Scorm12API> | InstanceType<typeof Scorm2004API>;

export interface UseScormRuntimeResult {
  attemptId: string | null;
  lastStatus: string;
  error: string | null;
}

export function useScormRuntime(
  moduleVersionId: string,
  scormVersion: string
): UseScormRuntimeResult {
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [lastStatus, setLastStatus] = useState<string>("not started");
  const [error, setError] = useState<string | null>(null);
  const apiRef = useRef<ScormApiInstance | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function createAttempt() {
      const response = await fetch("/api/scorm/attempts", {
        method: "POST",
        body: JSON.stringify({ moduleVersionId }),
      });
      if (!response.ok) {
        throw new Error(`Failed to create SCORM attempt (status ${response.status})`);
      }
      const body = await response.json();
      if (cancelled) return;
      if (!body?.attemptId) {
        throw new Error("Attempt creation response did not include an attemptId");
      }
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
        // `api.cmi.toJSON()` returns a NESTED object with no "cmi." prefix - it
        // does NOT match the flattened dotted-key shape ("cmi.core.lesson_status",
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

    createAttempt().catch((err) => {
      if (cancelled) return;
      setError(err instanceof Error ? err.message : "Failed to start the SCORM runtime");
    });
    return () => {
      cancelled = true;
    };
  }, [moduleVersionId, scormVersion]);

  return { attemptId, lastStatus, error };
}
