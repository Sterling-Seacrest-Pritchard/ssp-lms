"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Maximize2, Minimize2, RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import { useScormRuntime } from "@/lib/scorm/use-scorm-runtime";
import { Button } from "@/components/ui/button";

const SUCCESS_STATUSES = new Set(["completed", "passed"]);

const ZOOM_STEP = 0.25;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2.5;

// Many SCORM authoring tools (Articulate Storyline in particular) render
// their content at a fixed "story size" and never scale it up past 100%,
// even when given a much larger iframe — enlarging the iframe alone just
// adds blank space around unchanged-size content. To make the whole module
// actually bigger, we read the content's true rendered size once it loads,
// then apply our own CSS transform to the iframe as a single visual unit
// (content + any of its own internal letterboxing together), scaled to
// exactly fit the available area. This works regardless of whether the SCO
// scales itself internally.
function getIframeDocument(iframe: HTMLIFrameElement): Document | null {
  try {
    return iframe.contentDocument;
  } catch {
    return null; // cross-origin (shouldn't happen via the same-origin content proxy, but fail safe)
  }
}

// Storyline's own internal scaler element — stable across Storyline 2 through
// 360. offsetWidth/Height reflect the element's authored size regardless of
// any transform:scale() Storyline itself has already applied to it.
function detectStorylineSize(iframe: HTMLIFrameElement): { w: number; h: number } | null {
  const doc = getIframeDocument(iframe);
  const stage = doc?.getElementById("presentation");
  if (stage && stage.offsetWidth > 0 && stage.offsetHeight > 0) {
    return { w: stage.offsetWidth, h: stage.offsetHeight };
  }
  return null;
}

// Generic fallback for non-Storyline content: whatever the document rendered
// at is treated as its native size. For genuinely responsive content this is
// a no-op (it already matches whatever box the iframe was given) — only used
// once we've given a Storyline-style scaler a real chance to appear first,
// since body.scrollWidth/Height is available near-instantly and would
// otherwise win the race before Storyline finishes rendering its own stage.
function detectFallbackSize(iframe: HTMLIFrameElement): { w: number; h: number } | null {
  const doc = getIframeDocument(iframe);
  const { scrollWidth, scrollHeight } = doc?.body ?? {};
  if (scrollWidth && scrollHeight) {
    return { w: scrollWidth, h: scrollHeight };
  }
  return null;
}

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
  const scrollRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [nativeSize, setNativeSize] = useState<{ w: number; h: number } | null>(null);
  const [availableSize, setAvailableSize] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === containerRef.current);
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  // Track how much space the player actually has, so the fit calculation
  // stays correct across fullscreen toggles, window resizes, and sidebar
  // collapse/expand. Read the size synchronously up front rather than
  // waiting solely on the observer's first callback, so there's no render
  // with a known container already in the DOM but availableSize still null.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setAvailableSize({ w: rect.width, h: rect.height });
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setAvailableSize({ w: width, h: height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const handleIframeLoad = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    // Give a Storyline-style scaler a real chance to appear before falling
    // back — the fallback is available almost immediately and would
    // otherwise win the race before Storyline finishes rendering its stage.
    let attempts = 0;
    const tryDetect = () => {
      const size = detectStorylineSize(iframe);
      if (size) {
        setNativeSize(size);
        return;
      }
      attempts += 1;
      if (attempts < 6) {
        setTimeout(tryDetect, 200);
        return;
      }
      setNativeSize(detectFallbackSize(iframe));
    };
    tryDetect();
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      containerRef.current?.requestFullscreen();
    }
  };

  const fitScale =
    nativeSize && availableSize && nativeSize.w > 0 && nativeSize.h > 0
      ? Math.min(availableSize.w / nativeSize.w, availableSize.h / nativeSize.h)
      : 1;
  const effectiveScale = fitScale * zoom;
  const zoomPercent = Math.round(zoom * 100);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {isComplete && (
        <div className="flex items-center gap-2 text-sm font-medium text-emerald-600">
          <CheckCircle2 className="h-4 w-4" />
          Module complete
        </div>
      )}
      <div
        ref={containerRef}
        // Fixed height (not a min-height floor) so this box never grows to
        // match its own zoomed content — a flex item's default
        // `min-height: auto` would otherwise let it expand past its
        // allotted space to fit oversized children, which feeds back into
        // the ResizeObserver below and runs the fit-scale calculation away.
        // This element (not the scroll box inside it) is the fullscreen
        // target, so the zoom/fullscreen toolbar stays anchored to its
        // corner regardless of how far the content beneath is scrolled.
        className="relative h-[85vh] min-h-0 overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10"
      >
        <div className="absolute right-3 top-3 z-10 flex items-center gap-1 rounded-lg bg-background/90 p-1 shadow-sm ring-1 ring-foreground/10">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => setZoom((z) => Math.max(ZOOM_MIN, z - ZOOM_STEP))}
            disabled={zoom <= ZOOM_MIN}
            aria-label="Zoom out"
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
          <span className="min-w-10 text-center text-xs tabular-nums text-muted-foreground">
            {zoomPercent}%
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => setZoom((z) => Math.min(ZOOM_MAX, z + ZOOM_STEP))}
            disabled={zoom >= ZOOM_MAX}
            aria-label="Zoom in"
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
          {zoom !== 1 && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => setZoom(1)}
              aria-label="Reset zoom"
            >
              <RotateCcw className="h-4 w-4" />
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={toggleFullscreen}
            aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          >
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </Button>
        </div>
        <div ref={scrollRef} className="h-full min-h-0 w-full overflow-auto">
          {/*
            Gate the iframe's mount on `attemptId`, same reasoning as the
            admin harness: a SCORM SCO calls LMSInitialize/Initialize as soon
            as its own document loads and expects window.API/API_1484_11 to
            already be set. Mounting unconditionally risks an intermittent
            load-order race.
          */}
          {attemptId ? (
            // A single stable <iframe> element across the nativeSize
            // transition — react to it via inline style, never via a
            // different conditional JSX branch. Two separate <iframe>
            // elements in an if/else here previously made React unmount the
            // first and mount a second once nativeSize was detected, forcing
            // a real content reload mid-launch. Since a SCORM SCO's own
            // unload handler calls Finish() on our shared window.API when
            // its iframe is torn down, that reload terminated the runtime
            // right as the reloaded content tried to Initialize on it —
            // surfacing as "LMS is already finished!" on every launch, not
            // just already-completed ones.
            <div className="flex h-full min-h-full w-full items-center justify-center">
              <div
                style={
                  nativeSize
                    ? { width: nativeSize.w * effectiveScale, height: nativeSize.h * effectiveScale }
                    : { width: "100%", height: "100%" }
                }
                className="relative shrink-0"
              >
                <iframe
                  ref={iframeRef}
                  src={contentUrl}
                  onLoad={handleIframeLoad}
                  allow="fullscreen"
                  title="Course content"
                  style={
                    nativeSize
                      ? {
                          width: nativeSize.w,
                          height: nativeSize.h,
                          transform: `scale(${effectiveScale})`,
                          transformOrigin: "top left",
                        }
                      : { width: "100%", height: "100%" }
                  }
                  className="absolute left-0 top-0 border-0"
                />
              </div>
            </div>
          ) : error ? (
            <div className="flex h-full min-h-full w-full items-center justify-center text-sm text-muted-foreground">
              Couldn&apos;t start this module — try refreshing the page.
            </div>
          ) : (
            <div className="flex h-full min-h-full w-full items-center justify-center text-sm text-muted-foreground">
              Loading…
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
