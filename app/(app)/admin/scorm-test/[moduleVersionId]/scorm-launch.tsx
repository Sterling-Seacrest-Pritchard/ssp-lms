"use client";

import { useEffect, useRef, useState } from "react";
import { Scorm12API, Scorm2004API } from "scorm-again";
import { CheckCircle2, Circle, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type ScormApiInstance = InstanceType<typeof Scorm12API> | InstanceType<typeof Scorm2004API>;

const SUCCESS_STATUSES = new Set(["completed", "passed"]);
const FAILURE_STATUSES = new Set(["failed"]);

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

  const isSuccess = SUCCESS_STATUSES.has(lastStatus);
  const isFailure = FAILURE_STATUSES.has(lastStatus);

  return (
    <div className="flex flex-col gap-4">
      <Card
        className={cn(
          "py-3",
          isSuccess && "border-emerald-300",
          isFailure && "border-destructive/40"
        )}
      >
        <CardContent className="flex flex-wrap items-center gap-3">
          {isSuccess ? (
            <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
          ) : (
            <Circle className="h-5 w-5 shrink-0 text-muted-foreground" />
          )}
          <div className="flex flex-1 flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">Attempt</span>
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
              {attemptId ?? "creating…"}
            </code>
            <Badge variant="outline" className="text-[10px]">
              SCORM {scormVersion}
            </Badge>
            <span className="text-muted-foreground">Last commit:</span>
            <Badge variant={isFailure ? "destructive" : "secondary"}>{lastStatus}</Badge>
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden py-0">
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
          <iframe src={contentUrl} className="h-[600px] w-full" title="SCORM content" />
        ) : (
          <div className="flex h-[600px] w-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            Preparing SCORM runtime…
          </div>
        )}
      </Card>
    </div>
  );
}
