"use client";

import { CheckCircle2 } from "lucide-react";
import { useScormRuntime } from "@/lib/scorm/use-scorm-runtime";

const SUCCESS_STATUSES = new Set(["completed", "passed"]);

export function ScormPlayer({
  moduleVersionId,
  contentUrl,
  scormVersion,
  userId,
}: {
  moduleVersionId: string;
  contentUrl: string;
  scormVersion: string;
  userId: string;
}) {
  const { attemptId, lastStatus, error } = useScormRuntime(moduleVersionId, scormVersion, userId);
  const isComplete = SUCCESS_STATUSES.has(lastStatus);

  return (
    <div className="flex flex-col gap-3">
      {isComplete && (
        <div className="flex items-center gap-2 text-sm font-medium text-emerald-600">
          <CheckCircle2 className="h-4 w-4" />
          Module complete
        </div>
      )}
      <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
        {/*
          Gate the iframe's mount on `attemptId`, same reasoning as the admin
          harness: a SCORM SCO calls LMSInitialize/Initialize as soon as its
          own document loads and expects window.API/API_1484_11 to already be
          set. Mounting unconditionally risks an intermittent load-order race.
        */}
        {attemptId ? (
          <iframe src={contentUrl} className="h-[70vh] w-full" title="Course content" />
        ) : error ? (
          <div className="flex h-[70vh] w-full items-center justify-center text-sm text-muted-foreground">
            Couldn&apos;t start this module — try refreshing the page.
          </div>
        ) : (
          <div className="flex h-[70vh] w-full items-center justify-center text-sm text-muted-foreground">
            Loading…
          </div>
        )}
      </div>
    </div>
  );
}
