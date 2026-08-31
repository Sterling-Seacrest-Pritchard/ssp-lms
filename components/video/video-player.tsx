"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  CheckCircle2,
  RotateCcw,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// Fake playback runs faster than real time so a 25-minute module doesn't take 25 real minutes to watch.
const PLAYBACK_SPEED_MULTIPLIER = 20;
const TICK_MS = 250;

function formatTime(totalSeconds: number) {
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function VideoPlayer({
  courseId,
  courseTitle,
  moduleTitle,
  durationMinutes,
}: {
  courseId: string;
  courseTitle: string;
  moduleTitle: string;
  durationMinutes: number;
}) {
  const durationSeconds = durationMinutes * 60;
  const [elapsed, setElapsed] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(80);
  const [fullscreen, setFullscreen] = useState(false);
  const [completed, setCompleted] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!playing) return;
    const interval = setInterval(() => {
      setElapsed((prev) => {
        const next = prev + (TICK_MS / 1000) * PLAYBACK_SPEED_MULTIPLIER;
        if (next >= durationSeconds) {
          setPlaying(false);
          setCompleted(true);
          return durationSeconds;
        }
        return next;
      });
    }, TICK_MS);
    return () => clearInterval(interval);
  }, [playing, durationSeconds]);

  useEffect(() => {
    const onFullscreenChange = () => setFullscreen(!!document.fullscreenElement);
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

  const seekTo = (ratio: number) => {
    const next = Math.min(durationSeconds, Math.max(0, ratio * durationSeconds));
    setElapsed(next);
    if (next >= durationSeconds) {
      setPlaying(false);
      setCompleted(true);
    } else {
      setCompleted(false);
    }
  };

  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    seekTo((e.clientX - rect.left) / rect.width);
  };

  const markAsWatched = () => {
    setElapsed(durationSeconds);
    setPlaying(false);
    setCompleted(true);
  };

  const rewatch = () => {
    setElapsed(0);
    setCompleted(false);
    setPlaying(false);
  };

  const progressRatio = durationSeconds > 0 ? elapsed / durationSeconds : 0;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <Link
          href={`/courses/${courseId}`}
          className="text-sm text-muted-foreground hover:underline"
        >
          &larr; Back to {courseTitle}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{moduleTitle}</h1>
        <p className="text-sm text-muted-foreground">{durationMinutes} min video</p>
      </div>

      {completed && (
        <Card className="border-emerald-300">
          <CardContent className="flex items-center gap-4 py-5">
            <CheckCircle2 className="h-8 w-8 shrink-0 text-emerald-600" />
            <div className="flex-1">
              <p className="text-lg font-semibold">Watched</p>
              <p className="text-sm text-muted-foreground">
                Module marked complete.
              </p>
            </div>
            <Badge variant="secondary">Complete</Badge>
          </CardContent>
        </Card>
      )}

      <div
        ref={containerRef}
        className={cn(
          "flex flex-col overflow-hidden rounded-xl border bg-black",
          fullscreen && "h-screen justify-center"
        )}
      >
        <div className="relative flex aspect-video w-full items-center justify-center bg-black">
          {!playing && !completed && (
            <button
              type="button"
              onClick={() => setPlaying(true)}
              aria-label="Play"
              className="flex h-16 w-16 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
            >
              <Play className="h-8 w-8" />
            </button>
          )}
          {completed && (
            <CheckCircle2 className="h-16 w-16 text-white/30" />
          )}
        </div>

        <div className="flex flex-col gap-2 bg-black/95 px-4 py-3">
          <div
            onClick={handleProgressClick}
            className="h-1.5 w-full cursor-pointer rounded-full bg-white/20"
          >
            <div
              className="h-full rounded-full bg-white"
              style={{ width: `${progressRatio * 100}%` }}
            />
          </div>
          <div className="flex items-center gap-3 text-white">
            <button
              type="button"
              onClick={() => setPlaying((p) => !p)}
              aria-label={playing ? "Pause" : "Play"}
              disabled={completed}
              className="disabled:opacity-40"
            >
              {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </button>
            <span className="font-mono text-xs tabular-nums">
              {formatTime(elapsed)} / {formatTime(durationSeconds)}
            </span>
            <div className="ml-auto flex items-center gap-2">
              <button type="button" onClick={() => setMuted((m) => !m)} aria-label={muted ? "Unmute" : "Mute"}>
                {muted || volume === 0 ? (
                  <VolumeX className="h-4 w-4" />
                ) : (
                  <Volume2 className="h-4 w-4" />
                )}
              </button>
              <input
                type="range"
                min={0}
                max={100}
                value={muted ? 0 : volume}
                onChange={(e) => {
                  setVolume(Number(e.target.value));
                  setMuted(false);
                }}
                className="h-1 w-20 accent-white"
                aria-label="Volume"
              />
              <button type="button" onClick={toggleFullscreen} aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"}>
                {fullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {completed ? (
          <>
            <Button variant="outline" onClick={rewatch}>
              <RotateCcw className="h-4 w-4" />
              Rewatch
            </Button>
            <Link href={`/courses/${courseId}`}>
              <Button>Back to Course</Button>
            </Link>
          </>
        ) : (
          <Button variant="outline" onClick={markAsWatched}>
            Mark as watched
          </Button>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Demo only — no real video, controls run on simulated playback. Watched status isn&apos;t saved.
      </p>
    </div>
  );
}
