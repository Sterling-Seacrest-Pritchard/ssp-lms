"use client";

import { CheckCircle2, Circle, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useScormRuntime } from "@/lib/scorm/use-scorm-runtime";

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
  const { attemptId, lastStatus } = useScormRuntime(moduleVersionId, scormVersion);

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
          assigned inside useScormRuntime's effect). A SCORM 1.2 SCO calls
          LMSInitialize as soon as its own document loads and expects to find
          `window.API` immediately via the window-hierarchy lookup. If the
          iframe mounted unconditionally, the browser could start loading the
          SCO before the async POST /api/scorm/attempts round trip resolves,
          causing an intermittent LMSInitialize failure.
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
