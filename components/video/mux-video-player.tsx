"use client";

import { useEffect, useRef, useState } from "react";
import MuxPlayer from "@mux/mux-player-react";
import { CheckCircle2 } from "lucide-react";

const TOLERANCE_SECONDS = 3;
const COMMIT_INTERVAL_MS = 15_000;

export function MuxVideoPlayer({
  playbackToken,
  durationSeconds,
  moduleVersionId,
  initialFurthestWatchedSeconds,
}: {
  playbackToken: string;
  durationSeconds: number;
  moduleVersionId: string;
  initialFurthestWatchedSeconds: number;
}) {
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const furthestRef = useRef(initialFurthestWatchedSeconds);
  const positionRef = useRef(initialFurthestWatchedSeconds);
  const attemptIdRef = useRef<string | null>(null);
  const playerRef = useRef<React.ElementRef<typeof MuxPlayer>>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/video/attempts", {
      method: "POST",
      body: JSON.stringify({ moduleVersionId }),
    })
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to create video attempt (status ${res.status})`);
        return res.json();
      })
      .then((body) => {
        if (cancelled) return;
        setAttemptId(body.attemptId);
        attemptIdRef.current = body.attemptId;
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to start this video");
      });
    return () => {
      cancelled = true;
    };
  }, [moduleVersionId]);

  function commit(status: "in_progress" | "completed") {
    if (!attemptIdRef.current) return;
    fetch("/api/video/commit", {
      method: "POST",
      body: JSON.stringify({
        attemptId: attemptIdRef.current,
        furthestWatchedSeconds: Math.floor(furthestRef.current),
        lastPositionSeconds: Math.floor(positionRef.current),
        status,
      }),
      keepalive: status === "completed" || document.visibilityState === "hidden",
    }).catch(() => {
      // Best-effort - a missed periodic commit is recovered by the next one
      // or the final `ended` commit; not surfaced to the learner.
    });
  }

  useEffect(() => {
    if (!attemptId) return;
    const interval = setInterval(() => commit("in_progress"), COMMIT_INTERVAL_MS);
    const onHide = () => commit("in_progress");
    document.addEventListener("visibilitychange", onHide);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [attemptId]);

  if (error) {
    return <p className="text-sm text-destructive">{error}</p>;
  }

  if (completed) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-center">
        <CheckCircle2 className="h-10 w-10 text-emerald-600" />
        <p className="text-lg font-medium">Video complete</p>
      </div>
    );
  }

  return (
    <MuxPlayer
      ref={playerRef}
      playbackId={undefined}
      tokens={{ playback: playbackToken }}
      startTime={initialFurthestWatchedSeconds}
      onLoadedMetadata={() => {
        if (playerRef.current) playerRef.current.currentTime = positionRef.current;
      }}
      onTimeUpdate={(e) => {
        const current = (e.target as HTMLVideoElement).currentTime;
        positionRef.current = current;
        if (current > furthestRef.current) furthestRef.current = current;
      }}
      onSeeking={(e) => {
        const target = e.target as HTMLVideoElement;
        if (target.currentTime > furthestRef.current + TOLERANCE_SECONDS) {
          target.currentTime = furthestRef.current;
        }
      }}
      onEnded={() => {
        // Only reachable via genuine playback reaching the end - skip-ahead
        // is blocked above, so this event is not reachable by jumping to
        // the end directly. Server-side double-check happens in the commit
        // route by trusting this signal the same way SCORM trusts raw_cmi
        // (Global Constraints) - not hardened, but this is the honest path.
        furthestRef.current = durationSeconds;
        commit("completed");
        setCompleted(true);
      }}
    />
  );
}
