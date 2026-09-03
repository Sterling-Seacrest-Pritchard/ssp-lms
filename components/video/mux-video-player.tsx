"use client";

import { useEffect, useRef, useState } from "react";
import MuxPlayer from "@mux/mux-player-react";
import { CheckCircle2, FastForward } from "lucide-react";
import { Button } from "@/components/ui/button";

const TOLERANCE_SECONDS = 3;
const COMMIT_INTERVAL_MS = 15_000;

export function MuxVideoPlayer({
  playbackId,
  playbackToken,
  durationSeconds,
  moduleVersionId,
  initialFurthestWatchedSeconds,
  isAdmin = false,
}: {
  /**
   * The raw Mux playback id. Required - `@mux/mux-player` builds the video
   * `src` from this and will render an empty player without it; it does NOT
   * derive the id from the signed token. Shipping the id to the client is
   * safe under the "signed" playback policy these assets use: the id alone
   * gets you nothing without the signed token below, which is the whole
   * point of that policy.
   */
  playbackId: string;
  playbackToken: string;
  durationSeconds: number;
  moduleVersionId: string;
  initialFurthestWatchedSeconds: number;
  /**
   * TEMPORARY, DEMO-ONLY: shows an admin-visible "Skip to end" escape hatch
   * that marks the video complete without actually watching it. Does not
   * change the real completion rule for anyone else - a learner (or an
   * admin who doesn't click it) still only completes by watching to a
   * genuine `ended` event, exactly as before. Remove this prop and the
   * button below once the demo no longer needs it.
   */
  isAdmin?: boolean;
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

  function skipToEnd() {
    // TEMPORARY, DEMO-ONLY - see the isAdmin prop doc above. Bypasses actual
    // playback entirely; the honest path (watch to a genuine `ended` event)
    // is completely unchanged for everyone, including admins who don't use
    // this button.
    furthestRef.current = durationSeconds;
    positionRef.current = durationSeconds;
    commit("completed");
    setCompleted(true);
  }

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
    <div className="flex flex-col gap-2">
      <MuxPlayer
        ref={playerRef}
        playbackId={playbackId}
        tokens={{ playback: playbackToken }}
        startTime={initialFurthestWatchedSeconds}
        style={{ width: "100%", aspectRatio: "16 / 9" }}
        className="mx-auto max-w-4xl overflow-hidden rounded-xl"
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
      {isAdmin && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={skipToEnd}
          className="self-start border-amber-400 text-amber-700 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950/30"
        >
          <FastForward className="h-4 w-4" />
          Skip to end (Demo — admin only, remove before go-live)
        </Button>
      )}
    </div>
  );
}
