"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Maximize2, Minimize2 } from "lucide-react";
import { useScormRuntime } from "@/lib/scorm/use-scorm-runtime";
import { Button } from "@/components/ui/button";

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
  const containerRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === containerRef.current);
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      containerRef.current?.requestFullscreen();
    }
  };

  return (
    <div className="flex h-full flex-col gap-3">
      {isComplete && (
        <div className="flex items-center gap-2 text-sm font-medium text-emerald-600">
          <CheckCircle2 className="h-4 w-4" />
          Module complete
        </div>
      )}
      <div
        ref={containerRef}
        className="relative min-h-[85vh] flex-1 overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10"
      >
        <Button
          type="button"
          variant="secondary"
          size="icon-sm"
          onClick={toggleFullscreen}
          className="absolute right-3 top-3 z-10"
          aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
        >
          {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </Button>
        {/*
          Gate the iframe's mount on `attemptId`, same reasoning as the admin
          harness: a SCORM SCO calls LMSInitialize/Initialize as soon as its
          own document loads and expects window.API/API_1484_11 to already be
          set. Mounting unconditionally risks an intermittent load-order race.
        */}
        {attemptId ? (
          <iframe
            src={contentUrl}
            className="h-full min-h-[85vh] w-full"
            allow="fullscreen"
            title="Course content"
          />
        ) : error ? (
          <div className="flex h-full min-h-[85vh] w-full items-center justify-center text-sm text-muted-foreground">
            Couldn&apos;t start this module — try refreshing the page.
          </div>
        ) : (
          <div className="flex h-full min-h-[85vh] w-full items-center justify-center text-sm text-muted-foreground">
            Loading…
          </div>
        )}
      </div>
    </div>
  );
}
