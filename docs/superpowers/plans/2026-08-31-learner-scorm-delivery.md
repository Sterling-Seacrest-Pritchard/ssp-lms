# Learner-Facing SCORM Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a real, signed-in learner launch a real DB-backed SCORM module from the existing `/courses` and `/courses/[id]` pages and have their progress tracked — reusing the already-proven upload → launch → commit mechanism, not rebuilding it.

**Architecture:** Extract the `scorm-again` runtime wiring out of the admin test harness into a shared hook (`useScormRuntime`), build a clean learner-facing player component on top of it, add a real-DB-course lookup that sits alongside (not replacing) the existing mock course data, and wire a new learner route that mirrors the admin harness's page shape but sources the real signed-in user's identity instead of a hardcoded test string.

**Tech Stack:** Next.js 16 App Router (Server Components + Route Handlers), Drizzle ORM against Supabase Postgres, `scorm-again` for the SCORM runtime, Vitest for the one DB-backed test in this plan.

**Spec:** [docs/superpowers/specs/2026-08-31-learner-scorm-delivery-design.md](../specs/2026-08-31-learner-scorm-delivery-design.md) — read that first, this plan implements it task by task.

## Global Constraints

- Implement and verify entirely against **local dev** (`npm run dev`, port 3001, local Supabase-backed `.env.local`) — do not touch the deployed Cloud Run service as part of this work.
- No new schema, no new API routes — this plan only adds UI/query-layer code on top of the already-shipped `courses`/`modules`/`module_versions`/`scorm_module_versions`/`module_attempts`/`scorm_attempt_state` tables and the already-shipped `/api/scorm/attempts`, `/api/scorm/commit`, `/api/scorm/content/[moduleVersionId]/[...path]` routes.
- Mock course data (`lib/mock-data/courses.ts`) and its existing pages stay untouched and working exactly as today — real courses are additive, never replacing or reshaping the mock rendering path.
- Real course ids are UUIDs, mock course ids are slugs (e.g. `"aml-2026"`) — no collision risk, so lookup is always "try mock first, fall back to real."
- `userId` for a learner's attempt is the real signed-in user's `session.user.email` (via `auth()`), never a hardcoded string — that hardcoded-string pattern (`"admin-test-user"`) stays exclusive to the admin test harness.
- No automated test exists for any `.tsx` page/component in this codebase (established precedent: SCORM harness page, upload page, etc. are all manual-verification-only) — this plan follows that same precedent. The one exception is the new DB query helper in Task 3, which gets a real round-trip test like every other `lib/db/*` helper in this codebase.

---

### Task 1: Extract the shared SCORM runtime hook

**Files:**
- Create: `lib/scorm/use-scorm-runtime.ts`
- Modify: `app/(app)/admin/scorm-test/[moduleVersionId]/scorm-launch.tsx`

**Interfaces:**
- Produces: `useScormRuntime(moduleVersionId: string, scormVersion: string, userId: string): { attemptId: string | null; lastStatus: string }` — a client-side hook, imported by both the admin harness (Task 1, this task) and the new learner player (Task 2).

- [ ] **Step 1: Create the hook, extracting the existing logic verbatim**

`lib/scorm/use-scorm-runtime.ts`:

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

    createAttempt();
    return () => {
      cancelled = true;
    };
  }, [moduleVersionId, scormVersion, userId]);

  return { attemptId, lastStatus };
}
```

- [ ] **Step 2: Refactor the admin harness to use the hook**

Replace `app/(app)/admin/scorm-test/[moduleVersionId]/scorm-launch.tsx` in full with:

```tsx
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
  const { attemptId, lastStatus } = useScormRuntime(
    moduleVersionId,
    scormVersion,
    "admin-test-user"
  );

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
```

- [ ] **Step 3: Run the full test suite to confirm nothing else broke**

Run: `npx vitest run`
Expected: all existing tests still pass (this task touches no tested code paths, but confirms the refactor didn't break an import elsewhere).

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manually verify the admin harness still works identically**

1. Start the dev server: `npm run dev` (must be on **local dev**, port 3001 — not the deployed Cloud Run service).
2. Sign in, navigate to `/admin/content`, click a previously-uploaded real course's module (or upload a fresh one via `/admin/content/upload` using a file from `SCORM_Test_Packages/`).
3. Confirm the harness page looks and behaves exactly as before: status card with attempt-id chip, SCORM-version badge, last-commit badge; content loads in the iframe below; interacting with the content updates the badge.

- [ ] **Step 5: Commit**

```bash
git add lib/scorm/use-scorm-runtime.ts "app/(app)/admin/scorm-test/[moduleVersionId]/scorm-launch.tsx"
git commit -m "refactor: extract SCORM runtime wiring into a shared useScormRuntime hook"
```

---

### Task 2: Learner-facing ScormPlayer component

**Files:**
- Create: `components/scorm/scorm-player.tsx`

**Interfaces:**
- Consumes: `useScormRuntime` from Task 1 (`lib/scorm/use-scorm-runtime.ts`).
- Produces: `ScormPlayer` component, imported by the new learner route in Task 4. Props: `{ moduleVersionId: string; contentUrl: string; scormVersion: string; userId: string }`.

- [ ] **Step 1: Create the component**

`components/scorm/scorm-player.tsx`:

```tsx
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
  const { attemptId, lastStatus } = useScormRuntime(moduleVersionId, scormVersion, userId);
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

- [ ] **Step 2: Typecheck and lint**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx eslint components/scorm/scorm-player.tsx`
Expected: no output (clean).

- [ ] **Step 3: Commit**

```bash
git add components/scorm/scorm-player.tsx
git commit -m "feat: add learner-facing ScormPlayer component"
```

---

### Task 3: Real course-detail query helper

**Files:**
- Modify: `lib/db/queries.ts`
- Test: `lib/db/queries.test.ts`

**Interfaces:**
- Consumes: `db`, `courses`, `modules` from `lib/db/schema.ts` and `lib/db/client.ts` (already imported in `lib/db/queries.ts`).
- Produces: `getRealCourseDetail(courseId: string): Promise<RealCourseDetail | null>` — `RealCourseDetail = { id: string; title: string; modules: { id: string; title: string; moduleVersionId: string }[] }`. Consumed by the new learner-facing course-detail branch in Task 6.

- [ ] **Step 1: Write the failing test**

Add to `lib/db/queries.test.ts` (existing file — add this `describe` block alongside the existing `listRealCourses` one):

```ts
import { getRealCourseDetail } from "./queries";
import { moduleVersions } from "./schema";

describe("getRealCourseDetail", () => {
  const courseCode = `QUERIES-DETAIL-TEST-${randomUUID()}`;

  afterAll(async () => {
    const [course] = await db.select().from(courses).where(eq(courses.code, courseCode));
    if (course) {
      const mods = await db.select().from(modules).where(eq(modules.courseId, course.id));
      const moduleIds = mods.map((m) => m.id);
      if (moduleIds.length) {
        for (const moduleId of moduleIds) {
          await db.update(modules).set({ currentVersionId: null }).where(eq(modules.id, moduleId));
        }
        const versions = await db
          .select()
          .from(moduleVersions)
          .where(inArray(moduleVersions.moduleId, moduleIds));
        if (versions.length) {
          await db.delete(moduleVersions).where(inArray(moduleVersions.id, versions.map((v) => v.id)));
        }
        await db.delete(modules).where(inArray(modules.id, moduleIds));
      }
      await db.delete(courses).where(eq(courses.id, course.id));
    }
  });

  it("returns null for an unknown course id", async () => {
    const result = await getRealCourseDetail(randomUUID());
    expect(result).toBeNull();
  });

  it("returns the course with its modules, resolving each module's currentVersionId", async () => {
    const [course] = await db
      .insert(courses)
      .values({ code: courseCode, title: "Detail Test Course" })
      .returning();
    const [courseModule] = await db
      .insert(modules)
      .values({ courseId: course.id, moduleType: "scorm", title: "Detail Test Module" })
      .returning();
    const [version] = await db
      .insert(moduleVersions)
      .values({ moduleId: courseModule.id, versionNumber: 1, status: "published" })
      .returning();
    await db
      .update(modules)
      .set({ currentVersionId: version.id })
      .where(eq(modules.id, courseModule.id));

    const result = await getRealCourseDetail(course.id);

    expect(result).not.toBeNull();
    expect(result?.title).toBe("Detail Test Course");
    expect(result?.modules).toHaveLength(1);
    expect(result?.modules[0]).toEqual({
      id: courseModule.id,
      title: "Detail Test Module",
      moduleVersionId: version.id,
    });
  });

  it("excludes modules with no currentVersionId (never had a version published)", async () => {
    const [course] = await db
      .insert(courses)
      .values({ code: `${courseCode}-nopub`, title: "No Publish Test" })
      .returning();
    await db
      .insert(modules)
      .values({ courseId: course.id, moduleType: "scorm", title: "Unpublished Module" });

    const result = await getRealCourseDetail(course.id);

    expect(result?.modules).toHaveLength(0);

    await db.delete(modules).where(eq(modules.courseId, course.id));
    await db.delete(courses).where(eq(courses.id, course.id));
  });
});
```

You'll also need `inArray` in the imports at the top of the test file — check the existing import line and extend it: `import { eq, inArray } from "drizzle-orm";`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/db/queries.test.ts`
Expected: FAIL — `getRealCourseDetail is not a function` (or similar "not exported" error).

- [ ] **Step 3: Implement `getRealCourseDetail`**

Add to `lib/db/queries.ts`, after the existing `listRealCourses` function:

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
      .filter((m) => m.currentVersionId !== null)
      .map((m) => ({ id: m.id, title: m.title, moduleVersionId: m.currentVersionId as string })),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/db/queries.test.ts`
Expected: PASS, 5 tests (2 existing `listRealCourses` + 3 new `getRealCourseDetail`).

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add lib/db/queries.ts lib/db/queries.test.ts
git commit -m "feat: add getRealCourseDetail query helper"
```

---

### Task 4: Learner route for launching a real SCORM module

**Files:**
- Create: `app/(app)/courses/[id]/scorm/[moduleId]/page.tsx`

**Interfaces:**
- Consumes: `auth` from `@/auth` (root of repo), `getScormLaunchInfo` from `lib/scorm/launch-info.ts` (existing, returns `{ launchUrl: string; gcsPrefix: string; scormVersion: string } | null`), `ScormPlayer` from Task 2.
- Produces: the `/courses/[id]/scorm/[moduleId]` route, linked to by Task 6's course-detail page.

- [ ] **Step 1: Create the page**

`app/(app)/courses/[id]/scorm/[moduleId]/page.tsx`:

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
  if (!userId) {
    notFound();
  }

  const info = await getScormLaunchInfo(moduleId);
  if (!info) {
    notFound();
  }

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

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (`PageProps<"/courses/[id]/scorm/[moduleId]">` is generated automatically by Next.js's typed-routes system once this file exists on disk and the dev server has run at least once — if you see a type error here specifically about this route not existing, run `npm run dev`, let it start, stop it, and re-run `tsc`.)

- [ ] **Step 3: Manually verify the route resolves for an already-uploaded module**

1. `npm run dev` (local dev, port 3001).
2. From a previous test upload (or upload a fresh package via `/admin/content/upload`), copy its `moduleVersionId` — visible in the URL after upload redirects to `/admin/scorm-test/<id>`.
3. Visit `/courses/<any-course-id>/scorm/<that-moduleVersionId>` directly (the course id in the URL doesn't affect this page's data lookup — it uses `moduleId` only — Task 6 wires the real link from the actual course).
4. Confirm the content loads and no attempt-id/version debug info is shown (compare against the admin harness at `/admin/scorm-test/<id>`, which should still show that info).

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/courses/[id]/scorm/[moduleId]/page.tsx"
git commit -m "feat: add learner-facing SCORM launch route"
```

---

### Task 5: Real courses on the course list page

**Files:**
- Modify: `app/(app)/courses/page.tsx`

**Interfaces:**
- Consumes: `listRealCourses` from `lib/db/queries.ts` (already exists, returns `RealCourseSummary[]` — `{ id, code, title, moduleCount }`).

- [ ] **Step 1: Make the page async and add a real-courses section**

Modify `app/(app)/courses/page.tsx`. Change the function signature and imports, and add a new section after the existing "Finished" section:

```tsx
import Link from "next/link";
import { ShieldCheck, CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { courses } from "@/lib/mock-data/courses";
import { listRealCourses } from "@/lib/db/queries";
```

Change `export default function CoursesPage()` to `export default async function CoursesPage()`, and add this line right after the existing `active`/`finished` filtering:

```tsx
const realCourses = await listRealCourses();
```

Add a new section at the end of the returned JSX, right before the closing `</div>` that wraps the whole page (after the existing "Finished" `<div>` block, still inside the outer `max-w-6xl` container):

```tsx
{realCourses.length > 0 && (
  <div>
    <h2 className="mb-4 text-lg font-medium">Live Courses</h2>
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {realCourses.map((course) => (
        <Link key={course.id} href={`/courses/${course.id}`}>
          <Card className="h-full transition-shadow hover:shadow-md">
            <CardHeader>
              <div className="flex items-start justify-between gap-2">
                <CardTitle className="text-base leading-snug">{course.title}</CardTitle>
                <Badge variant="secondary" className="text-[10px]">
                  Live
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                {course.moduleCount} module{course.moduleCount === 1 ? "" : "s"}
              </p>
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  </div>
)}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manually verify**

1. `npm run dev` (local dev, port 3001).
2. Upload a real package via `/admin/content/upload` if none exists yet.
3. Visit `/courses` — confirm the existing mock "Active"/"Finished" sections render exactly as before, and a new "Live Courses" section appears below with the uploaded course, tagged "Live", showing its module count.
4. Click the live course card — confirm it navigates to `/courses/<its-uuid>` (this will 404 until Task 6 lands — that's expected at this point in the plan).

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/courses/page.tsx"
git commit -m "feat: show real DB-backed courses on the course list page"
```

---

### Task 6: Real course detail page and module launch link

**Files:**
- Modify: `app/(app)/courses/[id]/page.tsx`

**Interfaces:**
- Consumes: `getRealCourseDetail` from Task 3.

- [ ] **Step 1: Add a real-course branch before the existing mock-only logic**

Modify `app/(app)/courses/[id]/page.tsx`. Add the import:

```tsx
import { getRealCourseDetail } from "@/lib/db/queries";
```

Replace the function body. The existing mock lookup and `notFound()` call:

```tsx
export default async function CourseDetailPage(props: PageProps<"/courses/[id]">) {
  const { id } = await props.params;
  const course = courses.find((c) => c.id === id);

  if (!course) {
    notFound();
  }
```

becomes:

```tsx
export default async function CourseDetailPage(props: PageProps<"/courses/[id]">) {
  const { id } = await props.params;
  const course = courses.find((c) => c.id === id);

  if (!course) {
    const realCourse = await getRealCourseDetail(id);
    if (!realCourse) {
      notFound();
    }
    return (
      <div className="mx-auto flex max-w-4xl flex-col gap-6">
        <div>
          <Link href="/courses" className="text-sm text-muted-foreground hover:underline">
            &larr; Back to Courses
          </Link>
          <div className="mt-4 flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{realCourse.title}</h1>
            <Badge variant="secondary" className="text-[10px]">
              Live
            </Badge>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Modules</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col divide-y">
            {realCourse.modules.length === 0 ? (
              <p className="py-3 text-sm text-muted-foreground">
                This course has no published modules yet.
              </p>
            ) : (
              realCourse.modules.map((module) => (
                <div
                  key={module.id}
                  className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <Circle className="h-5 w-5 shrink-0 text-muted-foreground" />
                  <div className="flex-1">
                    <p className="text-sm font-medium">{module.title}</p>
                  </div>
                  <Link href={`/courses/${realCourse.id}/scorm/${module.moduleVersionId}`}>
                    <Button size="sm">Start</Button>
                  </Link>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    );
  }
```

The rest of the file (the existing mock-course rendering below this block) stays exactly as it is today — untouched.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. `Circle`, `Card`, `CardHeader`, `CardTitle`, `CardContent`, `Badge`, `Button`, `Link` are all already imported at the top of this file for the existing mock-course rendering — no new imports needed beyond `getRealCourseDetail`.

- [ ] **Step 3: Run the full suite one more time**

Run: `npx vitest run`
Expected: all tests pass (this task touches no tested code paths directly, but confirms nothing broke).

- [ ] **Step 4: Manually verify the complete learner flow end to end**

1. `npm run dev` (local dev, port 3001).
2. Sign in as yourself.
3. Upload a real SCORM package via `/admin/content/upload` (use `SCORM_Test_Packages/07_articulate_real_sample.zip` for a real stress test, or any of the synthetic `01`-`06` packages).
4. Navigate to `/courses` — confirm the new course appears in "Live Courses".
5. Click into it — confirm the real course-detail branch renders (title + "Live" badge + module list with a "Start" button), and the existing mock courses below `/courses` still work exactly as before (spot check one, e.g. "Anti-Money Laundering Fundamentals").
6. Click "Start" on the real module — confirm it navigates to `/courses/<id>/scorm/<moduleVersionId>` and the content loads with the clean learner UI (no attempt-id/version debug info).
7. Interact with the content until it reports completion — confirm the "Module complete" indicator appears.
8. Query the database directly (or reuse the pattern from earlier `scripts/check-state.ts` runs this session) to confirm a `module_attempts` row exists with `user_id` set to your real signed-in email, not `"admin-test-user"`.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/courses/[id]/page.tsx"
git commit -m "feat: render real DB-backed courses on the course detail page"
```

---

## Self-Review Notes

- **Spec coverage**: implements all 4 numbered design sections (shared runtime hook, learner player component, real course/module data bridging including the course-list-page addition mentioned in §3, new learner route) plus the real-identity requirement from Global Constraints. The spec's "Open question" (using `email` as the interim identity) is carried through unchanged in Task 4/6, not re-litigated.
- **Placeholder scan**: no TBD/TODO markers; every step has complete, real code or concrete numbered manual-verification instructions.
- **Type consistency**: `RealCourseDetail`/`getRealCourseDetail` (Task 3) match exactly how they're consumed in Task 6 (`realCourse.title`, `realCourse.modules[].id/title/moduleVersionId`). `useScormRuntime`'s return shape (`{ attemptId, lastStatus }`) matches how both Task 1's refactored admin harness and Task 2's `ScormPlayer` destructure it. `ScormPlayer`'s props (`moduleVersionId, contentUrl, scormVersion, userId`) match exactly how Task 4's page constructs and passes them.
