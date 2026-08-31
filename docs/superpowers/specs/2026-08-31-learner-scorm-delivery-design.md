# Learner-Facing SCORM Delivery — Design

**Status:** Approved 2026-08-31, not yet implemented.

## Goal

Give real learners (not just admins testing) a way to launch a real, DB-backed SCORM module from the existing course list/detail pages and have their progress tracked — reusing the already-proven upload → launch → commit mechanism from the SCORM Import Test Slice, not rebuilding it.

## Context

The SCORM Import Test Slice (implemented 2026-08-31) proved the core mechanism end to end, including against a real Storyline 360 package: upload, manifest parsing, same-origin content-proxy serving, `scorm-again` runtime wiring (both SCORM 1.2 and 2004), and CMI commits landing in `scorm_attempt_state`. All of that lives under `/admin/*` — an explicitly admin-only test harness ("not part of the learner-facing product," per its own page copy).

The app's actual course experience (`/courses`, `/courses/[id]`) is still 100% `lib/mock-data/courses.ts` — five hardcoded courses with `video`/`quiz`/`reading` module types, none of them real. Content Authoring already established the pattern for bridging mock and real data: query real DB rows alongside the mock array, tag real ones "Live," leave mock rows untouched. This design applies that same pattern to the learner-facing side.

## Non-Goals (explicitly deferred)

- Real course metadata (department, compliance, due-date, thumbnail) for DB-backed courses — schema doesn't have these columns yet, out of scope for this pass.
- Enrollments — no `enrollments` table exists yet. A learner can launch and complete a real module without "enrolling" in anything first.
- Resume-vs-new-attempt semantics — every launch creates a fresh attempt, same as the admin harness today. The "should this resume the last in-progress attempt instead" product decision is still open.
- RBAC beyond existing sign-in — any authenticated user can launch any real module they can navigate to, same posture as the rest of the learner-facing app today.

## Design

### 1. Shared SCORM runtime hook

Extract the `scorm-again` wiring currently inline in `app/(app)/admin/scorm-test/[moduleVersionId]/scorm-launch.tsx` into a reusable hook:

**New file: `lib/scorm/use-scorm-runtime.ts`**

```ts
"use client";

import { useEffect, useRef, useState } from "react";
import { Scorm12API, Scorm2004API } from "scorm-again";

type ScormApiInstance = InstanceType<typeof Scorm12API> | InstanceType<typeof Scorm2004API>;

export interface UseScormRuntimeResult {
  attemptId: string | null;
  lastStatus: string;
}

export function useScormRuntime(
  moduleVersionId: string,
  scormVersion: string,
  userId: string
): UseScormRuntimeResult {
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [lastStatus, setLastStatus] = useState<string>("not started");
  const apiRef = useRef<ScormApiInstance | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function createAttempt() {
      const response = await fetch("/api/scorm/attempts", {
        method: "POST",
        body: JSON.stringify({ moduleVersionId, userId }),
      });
      const body = await response.json();
      if (cancelled) return;
      setAttemptId(body.attemptId);

      const is2004 = scormVersion === "2004";
      const api: ScormApiInstance = is2004
        ? new Scorm2004API({ autocommit: true, lmsCommitUrl: false })
        : new Scorm12API({ autocommit: true, lmsCommitUrl: false });

      api.on(is2004 ? "Commit" : "LMSCommit", async () => {
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
  }, [moduleVersionId, scormVersion, userId]);

  return { attemptId, lastStatus };
}
```

This is a direct extraction of the existing, already-verified-live logic — same event names, same `getFlattenedCMI()` usage, same `window.API`/`window.API_1484_11` assignment. The only change: `userId` becomes a parameter instead of the admin harness's hardcoded `"admin-test-user"` string, and the iframe-gating-on-`attemptId` behavior (fixing the load-order race found during Step 7) moves to each caller's own render, since that's presentation, not runtime logic.

**Admin harness** (`scorm-launch.tsx`) becomes a thin wrapper: calls `useScormRuntime(moduleVersionId, scormVersion, "admin-test-user")`, keeps its existing debug status card (attempt-id chip, SCORM-version badge, color-coded last-commit badge) and full-bleed content card exactly as built today. No behavior change for admins.

### 2. Learner delivery component

**New file: `components/scorm/scorm-player.tsx`**

```tsx
"use client";

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
  const { attemptId, lastStatus } = useScormRuntime(moduleVersionId, scormVersion, userId);
  const isComplete = SUCCESS_STATUSES.has(lastStatus);

  return (
    <div className="flex flex-col gap-3">
      {isComplete && (
        <p className="text-sm font-medium text-emerald-600">Module complete</p>
      )}
      <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
        {attemptId ? (
          <iframe src={contentUrl} className="h-[70vh] w-full" title="Course content" />
        ) : (
          <div className="flex h-[70vh] w-full items-center justify-center text-sm text-muted-foreground">
            Loading…
          </div>
        )}
      </div>
    </div>
  );
}
```

No attempt-id chip, no SCORM-version badge, no raw commit-status text — per the approved design, learners see the content and a minimal completion indicator once a terminal status lands. The iframe-gating pattern (mount only after `attemptId` is set) carries over unchanged from the admin harness — it's the fix for the real load-order race found in Step 7, and applies identically here.

### 3. Real course/module data bridging

**New query helper, added to `lib/db/queries.ts`:**

```ts
export interface RealCourseDetail {
  id: string;
  title: string;
  modules: {
    id: string;
    title: string;
    moduleVersionId: string;
  }[];
}

export async function getRealCourseDetail(courseId: string): Promise<RealCourseDetail | null> {
  const [course] = await db.select().from(courses).where(eq(courses.id, courseId));
  if (!course) return null;

  const courseModules = await db.select().from(modules).where(eq(modules.courseId, course.id));

  return {
    id: course.id,
    title: course.title,
    modules: courseModules
      .filter((m) => m.currentVersionId)
      .map((m) => ({ id: m.id, title: m.title, moduleVersionId: m.currentVersionId! })),
  };
}
```

Mock course ids are slugs (`"aml-2026"`); real course ids are UUIDs — no collision risk, so lookup order is: try the mock array first (fast, no DB round trip for the demo courses), fall back to `getRealCourseDetail` if not found.

**`app/(app)/courses/page.tsx`** (course list): after the existing mock `.map()`, render real courses fetched via the existing `listRealCourses()` helper (already built for Content Authoring), each as a minimal card — title + a "Live" badge, blank department/compliance/due-date, linking to `/courses/[id]` same as mock cards.

**`app/(app)/courses/[id]/page.tsx`** (course detail): becomes async-aware of both sources.

```tsx
const course = courses.find((c) => c.id === id) ?? (await getRealCourseDetail(id));
```

For a real course, the module list renders each module with a `moduleType: "scorm"` implicit (every real module in this milestone is SCORM — no video/quiz/reading types exist for real rows), with a button linking to the new learner route. This is the same `module.type === "quiz" || module.type === "video"` branching pattern already in the file, extended with a real-course branch.

### 4. New learner route

**New file: `app/(app)/courses/[id]/scorm/[moduleId]/page.tsx`**

```tsx
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { getScormLaunchInfo } from "@/lib/scorm/launch-info";
import { ScormPlayer } from "@/components/scorm/scorm-player";

export default async function LearnerScormPage(
  props: PageProps<"/courses/[id]/scorm/[moduleId]">
) {
  const { moduleId } = await props.params;
  const session = await auth();
  const userId = session?.user?.email;
  if (!userId) notFound();

  const info = await getScormLaunchInfo(moduleId);
  if (!info) notFound();

  const contentUrl = `/api/scorm/content/${moduleId}/${info.launchUrl}`;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <ScormPlayer
        moduleVersionId={moduleId}
        contentUrl={contentUrl}
        scormVersion={info.scormVersion}
        userId={userId}
      />
    </div>
  );
}
```

Mirrors the admin harness's page structure exactly (same `getScormLaunchInfo` call, same content-proxy URL construction) — the only real difference is sourcing `userId` from the real authenticated session instead of a hardcoded string, and rendering `ScormPlayer` instead of the debug harness.

## Testing approach

- `use-scorm-runtime.ts`: no automated test (browser-only, same as the admin harness's existing scorm-again wiring — manual-verification-only per the original plan's precedent, since it requires a real browser + real SCORM content to exercise meaningfully).
- `getRealCourseDetail`: real DB round-trip test, same pattern as `listRealCourses`'s existing test.
- `LearnerScormPage`: no automated test for the page component itself (same reasoning as the harness page); manually verified live — upload a real package as admin, then launch it as a learner via `/courses/[id]` and confirm the same upload→launch→commit proof Step 7 already established, this time through the real learner path with a real session-derived `userId`.

## Open question surfaced during design, not blocking

`session.user` currently has no stable Entra object id (`oid`) surfaced — only `name`/`email`/`image`/`roles` (see `auth.ts`'s `session` callback). Using `email` as the interim learner identity string is consistent with the existing `currentUser.email` mock pattern and is real/stable enough for this milestone's free-text `module_attempts.userId` column. When the real `users` table gets built, `entra_object_id` becomes the actual join key — this is a compatible stepping stone, not a decision that needs revisiting now.
