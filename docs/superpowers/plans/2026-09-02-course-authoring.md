# Course Authoring Subsystem Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admins compose multiple modules (SCORM + placeholder Video) into a Course, reorder them, save as Draft, and Publish — at which point it appears on `/courses` as a full course card indistinguishable from the mock courses.

**Architecture:** Extend the existing schema minimally (four new `courses` columns, one new `video_module_versions` table mirroring the existing `scorm_module_versions` pattern), reuse the already-present-but-unused `courses.status`/`module_versions.status` draft/published fields, add a small set of admin mutation functions and thin API routes wrapping them, build one new single-page admin builder UI, and update the learner-facing `/courses` and `/courses/[id]` pages to fold published real courses into the same rendering path mock courses use.

**Tech Stack:** Next.js 16 App Router, Drizzle ORM against Supabase Postgres, `@dnd-kit/core` + `@dnd-kit/sortable` (new dependency, drag-and-drop reordering), Vitest for DB-touching helpers and API routes.

**Spec:** [docs/superpowers/specs/2026-09-02-course-authoring-design.md](../specs/2026-09-02-course-authoring-design.md) — read that first, this plan implements it task by task.

## Global Constraints

- No RBAC beyond existing sign-in — same posture as the rest of the app.
- Draft courses are invisible to learners: any learner-facing query only ever selects `status = "published"`; a learner hitting a draft course's URL gets the same `notFound()` as a nonexistent course, never a distinct "this is a draft" message.
- Real video upload/hosting stays out of scope — Video modules in this pass are placeholders (title + estimated duration, no file, not playable). Do not build any real ingest/transcoding/playback.
- Publishing does not lock a course — admins can keep editing after publish; changes are visible to learners immediately (no course-level versioning).
- `department` is free text (no fixed list exists anywhere in this codebase to constrain it against); rendered as `"General"` when blank. `dueDate` stays genuinely `null` when unset — never filled with a generated value. `thumbnail` is a Tailwind gradient class string (same scheme as `lib/mock-data/courses.ts`), auto-picked from a fixed rotation when unset.
- No automated test exists for any `.tsx` page/component in this codebase (established precedent) — this plan follows that precedent for the builder UI and the two learner page updates; every `lib/db`/`lib/scorm` helper and every API route gets a real DB-backed test (also established precedent — no mocking anywhere in this codebase's tests).
- Implement and verify against local dev only (`npm run dev`, port 3001) — do not touch the deployed Cloud Run service.

---

### Task 1: Schema — course metadata fields and video module versions

**Files:**
- Modify: `lib/db/schema.ts`
- Migration: generated into `drizzle/migrations/` by `npm run db:generate`

**Interfaces:**
- Produces: `courses.department` (text, nullable), `courses.thumbnail` (text, nullable), `courses.compliance` (boolean, not null, default false), `courses.dueDate` (timestamp with timezone, nullable); `videoModuleVersions` table (`moduleVersionId` uuid PK/FK -> `moduleVersions.id`, `durationMinutes` integer nullable). Consumed by every later task.

- [ ] **Step 1: Add the new columns and table**

In `lib/db/schema.ts`, add `boolean` to the import from `drizzle-orm/pg-core`:

```ts
import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";
```

Replace the `courses` table definition:

```ts
export const courses = pgTable("courses", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("draft"),
  department: text("department"),
  thumbnail: text("thumbnail"),
  compliance: boolean("compliance").notNull().default(false),
  dueDate: timestamp("due_date", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```

Add a new table after `scormModuleVersions`:

```ts
export const videoModuleVersions = pgTable("video_module_versions", {
  moduleVersionId: uuid("module_version_id")
    .primaryKey()
    .references(() => moduleVersions.id),
  durationMinutes: integer("duration_minutes"),
});
```

- [ ] **Step 2: Generate the migration**

Run: `npm run db:generate`
Expected: a new file appears under `drizzle/migrations/` (e.g. `0001_<generated-name>.sql`) containing `ALTER TABLE "courses" ADD COLUMN ...` and `CREATE TABLE "video_module_versions" ...` statements. Read the generated SQL to confirm it matches — Drizzle sometimes needs a confirmation prompt for column additions with defaults; answer according to the schema above (default `false` for `compliance`, no default for the nullable columns).

- [ ] **Step 3: Apply the migration**

Run: `npm run db:migrate`
Expected: completes without error.

- [ ] **Step 4: Verify against the real dev database**

Run: `npx tsc --noEmit`
Expected: no errors (confirms the schema file itself is syntactically and type-correct).

- [ ] **Step 5: Commit**

```bash
git add lib/db/schema.ts drizzle/migrations
git commit -m "feat: add course metadata columns and video_module_versions table"
```

---

### Task 2: Learner-facing query updates

**Files:**
- Modify: `lib/db/queries.ts`
- Modify: `lib/db/queries.test.ts`
- Create: `lib/scorm/course-progress.ts`
- Create: `lib/scorm/course-progress.test.ts`

**Interfaces:**
- Consumes: `courses.department/thumbnail/compliance/dueDate`, `videoModuleVersions` (Task 1); `getLatestLessonStatus(moduleVersionId, userId)` from `lib/scorm/completion-status.ts` (already exists).
- Produces: `RealCourseSummary` gains `department: string | null`, `thumbnail: string | null`, `compliance: boolean`, `dueDate: string | null`. `listPublishedCourses(): Promise<RealCourseSummary[]>` (new). `RealCourseDetail` gains the same four fields; `getRealCourseDetail(courseId)` now filters to `status = "published"` and returns `null` for a draft or nonexistent course. `getCourseForBuilder(courseId): Promise<CourseForBuilder | null>` (new, admin-facing, no status filter). `getCourseProgressForLearner(courseId, userId): Promise<{ status: "not-started" | "in-progress" | "completed"; progress: number }>` (new) — consumed by Task 8.

- [ ] **Step 1: Write the failing tests for the query changes**

Add to `lib/db/queries.test.ts`. Update the import line at the top of the test file to pull in the new functions:

```ts
import { listRealCourses, getRealCourseDetail, listPublishedCourses, getCourseForBuilder } from "./queries";
```

Add these tests inside the existing `describe("getRealCourseDetail", ...)` block, alongside the existing three:

```ts
  it("returns null for a draft course (not yet published)", async () => {
    const [course] = await db
      .insert(courses)
      .values({ code: `${courseCode}-draft`, title: "Draft Test Course" })
      .returning();
    try {
      const result = await getRealCourseDetail(course.id);
      expect(result).toBeNull();
    } finally {
      await db.delete(courses).where(eq(courses.id, course.id));
    }
  });
```

Modify the two existing tests that expect a non-null result so their `insert(courses)` calls include `status: "published"`:

```ts
  it("returns the course with its modules, resolving each module's currentVersionId", async () => {
    const [course] = await db
      .insert(courses)
      .values({ code: courseCode, title: "Detail Test Course", status: "published" })
      .returning();
```

(rest of that test unchanged)

```ts
  it("excludes modules with no currentVersionId (never had a version published)", async () => {
    const [course] = await db
      .insert(courses)
      .values({ code: `${courseCode}-nopub`, title: "No Publish Test", status: "published" })
      .returning();
```

(rest of that test unchanged)

Now add a new `describe` block for `listPublishedCourses` at the end of the file:

```ts
describe("listPublishedCourses", () => {
  const courseCode = `PUBLISHED-LIST-TEST-${randomUUID()}`;

  afterAll(async () => {
    await db.delete(courses).where(eq(courses.code, courseCode));
    await db.delete(courses).where(eq(courses.code, `${courseCode}-draft`));
  });

  it("includes only published courses, with department/thumbnail/compliance/dueDate", async () => {
    await db.insert(courses).values({
      code: courseCode,
      title: "Published List Test",
      status: "published",
      department: "Compliance",
      thumbnail: "bg-gradient-to-br from-blue-500 to-indigo-600",
      compliance: true,
      dueDate: new Date("2026-12-01T00:00:00Z"),
    });
    await db.insert(courses).values({
      code: `${courseCode}-draft`,
      title: "Draft Should Be Excluded",
    });

    const results = await listPublishedCourses();
    const found = results.find((c) => c.code === courseCode);
    const draftFound = results.find((c) => c.code === `${courseCode}-draft`);

    expect(found).toBeDefined();
    expect(found?.department).toBe("Compliance");
    expect(found?.thumbnail).toBe("bg-gradient-to-br from-blue-500 to-indigo-600");
    expect(found?.compliance).toBe(true);
    expect(found?.dueDate).toBeTruthy();
    expect(draftFound).toBeUndefined();
  });
});

describe("getCourseForBuilder", () => {
  const courseCode = `BUILDER-TEST-${randomUUID()}`;

  afterAll(async () => {
    const [course] = await db.select().from(courses).where(eq(courses.code, courseCode));
    if (course) {
      await db.delete(modules).where(eq(modules.courseId, course.id));
      await db.delete(courses).where(eq(courses.id, course.id));
    }
  });

  it("returns a draft course with its modules regardless of publish status", async () => {
    const [course] = await db
      .insert(courses)
      .values({ code: courseCode, title: "Builder Test Course" })
      .returning();
    await db.insert(modules).values({
      courseId: course.id,
      moduleType: "video",
      title: "Builder Test Module",
      sortOrder: 0,
    });

    const result = await getCourseForBuilder(course.id);

    expect(result).not.toBeNull();
    expect(result?.status).toBe("draft");
    expect(result?.modules).toHaveLength(1);
    expect(result?.modules[0].moduleType).toBe("video");
  });

  it("returns null for an unknown course id", async () => {
    const result = await getCourseForBuilder(randomUUID());
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/db/queries.test.ts`
Expected: FAIL — `listPublishedCourses`/`getCourseForBuilder` not exported, and the two modified tests fail because `getRealCourseDetail` doesn't filter by status yet (still passes for a draft course).

- [ ] **Step 3: Implement the query changes**

In `lib/db/queries.ts`, replace the whole file with:

```ts
import { eq, sql } from "drizzle-orm";
import { db } from "./client";
import { courses, modules } from "./schema";
import { isUuid } from "@/lib/api/errors";

export interface RealCourseSummary {
  id: string;
  code: string;
  title: string;
  moduleCount: number;
  department: string | null;
  thumbnail: string | null;
  compliance: boolean;
  dueDate: string | null;
}

const courseSummaryColumns = {
  id: courses.id,
  code: courses.code,
  title: courses.title,
  department: courses.department,
  thumbnail: courses.thumbnail,
  compliance: courses.compliance,
  dueDate: courses.dueDate,
  moduleCount: sql<number>`count(${modules.id}) filter (where ${modules.currentVersionId} is not null)::int`,
};

function toSummary(row: {
  id: string;
  code: string;
  title: string;
  department: string | null;
  thumbnail: string | null;
  compliance: boolean;
  dueDate: Date | null;
  moduleCount: number;
}): RealCourseSummary {
  return { ...row, dueDate: row.dueDate ? row.dueDate.toISOString() : null };
}

export async function listRealCourses(): Promise<RealCourseSummary[]> {
  const rows = await db
    .select(courseSummaryColumns)
    .from(courses)
    .leftJoin(modules, eq(modules.courseId, courses.id))
    .groupBy(
      courses.id,
      courses.code,
      courses.title,
      courses.department,
      courses.thumbnail,
      courses.compliance,
      courses.dueDate
    )
    .orderBy(courses.createdAt);
  return rows.map(toSummary);
}

export async function listPublishedCourses(): Promise<RealCourseSummary[]> {
  const rows = await db
    .select(courseSummaryColumns)
    .from(courses)
    .leftJoin(modules, eq(modules.courseId, courses.id))
    .where(eq(courses.status, "published"))
    .groupBy(
      courses.id,
      courses.code,
      courses.title,
      courses.department,
      courses.thumbnail,
      courses.compliance,
      courses.dueDate
    )
    .orderBy(courses.createdAt);
  return rows.map(toSummary);
}

export interface RealCourseDetail {
  id: string;
  title: string;
  department: string | null;
  thumbnail: string | null;
  compliance: boolean;
  dueDate: string | null;
  modules: {
    id: string;
    title: string;
    moduleVersionId: string;
  }[];
}

export async function getRealCourseDetail(courseId: string): Promise<RealCourseDetail | null> {
  if (!isUuid(courseId)) return null;

  const [course] = await db
    .select()
    .from(courses)
    .where(eq(courses.id, courseId));
  if (!course || course.status !== "published") return null;

  const courseModules = await db.select().from(modules).where(eq(modules.courseId, course.id));

  return {
    id: course.id,
    title: course.title,
    department: course.department,
    thumbnail: course.thumbnail,
    compliance: course.compliance,
    dueDate: course.dueDate ? course.dueDate.toISOString() : null,
    modules: courseModules.flatMap((m) =>
      m.currentVersionId
        ? [{ id: m.id, title: m.title, moduleVersionId: m.currentVersionId }]
        : []
    ),
  };
}

export interface BuilderModule {
  id: string;
  title: string;
  moduleType: string;
  moduleVersionId: string | null;
  sortOrder: number;
}

export interface CourseForBuilder {
  id: string;
  code: string;
  title: string;
  status: string;
  department: string | null;
  thumbnail: string | null;
  compliance: boolean;
  dueDate: string | null;
  modules: BuilderModule[];
}

export async function getCourseForBuilder(courseId: string): Promise<CourseForBuilder | null> {
  if (!isUuid(courseId)) return null;

  const [course] = await db.select().from(courses).where(eq(courses.id, courseId));
  if (!course) return null;

  const courseModules = await db
    .select()
    .from(modules)
    .where(eq(modules.courseId, course.id))
    .orderBy(modules.sortOrder);

  return {
    id: course.id,
    code: course.code,
    title: course.title,
    status: course.status,
    department: course.department,
    thumbnail: course.thumbnail,
    compliance: course.compliance,
    dueDate: course.dueDate ? course.dueDate.toISOString() : null,
    modules: courseModules.map((m) => ({
      id: m.id,
      title: m.title,
      moduleType: m.moduleType,
      moduleVersionId: m.currentVersionId,
      sortOrder: m.sortOrder,
    })),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/db/queries.test.ts`
Expected: PASS, all tests including the new ones.

- [ ] **Step 5: Write the failing test for course progress rollup**

Create `lib/scorm/course-progress.test.ts`:

```ts
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { getCourseProgressForLearner } from "./course-progress";
import { db } from "@/lib/db/client";
import {
  courses,
  modules,
  moduleVersions,
  moduleAttempts,
  scormAttemptState,
} from "@/lib/db/schema";

describe("getCourseProgressForLearner", () => {
  const courseCode = `COURSE-PROGRESS-TEST-${randomUUID()}`;
  const userId = "course-progress-test@example.com";

  afterAll(async () => {
    const [course] = await db.select().from(courses).where(eq(courses.code, courseCode));
    if (course) {
      const mods = await db.select().from(modules).where(eq(modules.courseId, course.id));
      const moduleIds = mods.map((m) => m.id);
      const attempts = await db
        .select()
        .from(moduleAttempts)
        .where(eq(moduleAttempts.userId, userId));
      const attemptIds = attempts.map((a) => a.id);
      if (attemptIds.length) {
        await db
          .delete(scormAttemptState)
          .where(inArray(scormAttemptState.moduleAttemptId, attemptIds));
        await db.delete(moduleAttempts).where(inArray(moduleAttempts.id, attemptIds));
      }
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

  it("returns not-started with 0 progress when the learner has no attempts", async () => {
    const [course] = await db
      .insert(courses)
      .values({ code: courseCode, title: "Course Progress Test", status: "published" })
      .returning();
    const [mod] = await db
      .insert(modules)
      .values({ courseId: course.id, moduleType: "scorm", title: "Module 1" })
      .returning();
    const [version] = await db
      .insert(moduleVersions)
      .values({ moduleId: mod.id, versionNumber: 1, status: "published" })
      .returning();
    await db.update(modules).set({ currentVersionId: version.id }).where(eq(modules.id, mod.id));

    const result = await getCourseProgressForLearner(course.id, userId);

    expect(result).toEqual({ status: "not-started", progress: 0 });
  });

  it("returns completed with 100 progress when every module is completed", async () => {
    const [course] = await db
      .insert(courses)
      .values({ code: `${courseCode}-done`, title: "Course Progress Done Test", status: "published" })
      .returning();
    const [mod] = await db
      .insert(modules)
      .values({ courseId: course.id, moduleType: "scorm", title: "Module 1" })
      .returning();
    const [version] = await db
      .insert(moduleVersions)
      .values({ moduleId: mod.id, versionNumber: 1, status: "published" })
      .returning();
    await db.update(modules).set({ currentVersionId: version.id }).where(eq(modules.id, mod.id));
    const [attempt] = await db
      .insert(moduleAttempts)
      .values({ moduleVersionId: version.id, userId, attemptNumber: 1 })
      .returning();
    await db
      .insert(scormAttemptState)
      .values({ moduleAttemptId: attempt.id, lessonStatus: "completed", rawCmi: {} });

    const result = await getCourseProgressForLearner(course.id, userId);

    expect(result).toEqual({ status: "completed", progress: 100 });

    await db.delete(scormAttemptState).where(eq(scormAttemptState.moduleAttemptId, attempt.id));
    await db.delete(moduleAttempts).where(eq(moduleAttempts.id, attempt.id));
    await db.update(modules).set({ currentVersionId: null }).where(eq(modules.id, mod.id));
    await db.delete(moduleVersions).where(eq(moduleVersions.id, version.id));
    await db.delete(modules).where(eq(modules.id, mod.id));
    await db.delete(courses).where(eq(courses.id, course.id));
  });

  it("returns in-progress with partial progress when only some modules are completed", async () => {
    const [course] = await db
      .insert(courses)
      .values({ code: `${courseCode}-partial`, title: "Course Progress Partial Test", status: "published" })
      .returning();
    const [modA] = await db
      .insert(modules)
      .values({ courseId: course.id, moduleType: "scorm", title: "Module A" })
      .returning();
    const [modB] = await db
      .insert(modules)
      .values({ courseId: course.id, moduleType: "scorm", title: "Module B" })
      .returning();
    const [versionA] = await db
      .insert(moduleVersions)
      .values({ moduleId: modA.id, versionNumber: 1, status: "published" })
      .returning();
    const [versionB] = await db
      .insert(moduleVersions)
      .values({ moduleId: modB.id, versionNumber: 1, status: "published" })
      .returning();
    await db.update(modules).set({ currentVersionId: versionA.id }).where(eq(modules.id, modA.id));
    await db.update(modules).set({ currentVersionId: versionB.id }).where(eq(modules.id, modB.id));
    const [attemptA] = await db
      .insert(moduleAttempts)
      .values({ moduleVersionId: versionA.id, userId, attemptNumber: 1 })
      .returning();
    await db
      .insert(scormAttemptState)
      .values({ moduleAttemptId: attemptA.id, lessonStatus: "completed", rawCmi: {} });

    const result = await getCourseProgressForLearner(course.id, userId);

    expect(result).toEqual({ status: "in-progress", progress: 50 });

    await db.delete(scormAttemptState).where(eq(scormAttemptState.moduleAttemptId, attemptA.id));
    await db.delete(moduleAttempts).where(eq(moduleAttempts.id, attemptA.id));
    await db
      .update(modules)
      .set({ currentVersionId: null })
      .where(inArray(modules.id, [modA.id, modB.id]));
    await db.delete(moduleVersions).where(inArray(moduleVersions.id, [versionA.id, versionB.id]));
    await db.delete(modules).where(inArray(modules.id, [modA.id, modB.id]));
    await db.delete(courses).where(eq(courses.id, course.id));
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run lib/scorm/course-progress.test.ts`
Expected: FAIL — `getCourseProgressForLearner` is not a function.

- [ ] **Step 7: Implement the course progress rollup**

Create `lib/scorm/course-progress.ts`:

```ts
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { modules } from "@/lib/db/schema";
import { getLatestLessonStatus } from "./completion-status";

const FINISHED_STATUSES = new Set(["completed", "passed"]);

export interface CourseProgress {
  status: "not-started" | "in-progress" | "completed";
  progress: number;
}

export async function getCourseProgressForLearner(
  courseId: string,
  userId: string
): Promise<CourseProgress> {
  const courseModules = await db
    .select()
    .from(modules)
    .where(eq(modules.courseId, courseId));
  const publishedModules = courseModules.filter((m) => m.currentVersionId !== null);

  if (publishedModules.length === 0) {
    return { status: "not-started", progress: 0 };
  }

  const statuses = await Promise.all(
    publishedModules.map((m) => getLatestLessonStatus(m.currentVersionId as string, userId))
  );
  const completedCount = statuses.filter((s) => s !== null && FINISHED_STATUSES.has(s)).length;
  const progress = Math.round((completedCount / publishedModules.length) * 100);

  if (completedCount === 0) {
    return { status: "not-started", progress: 0 };
  }
  if (completedCount === publishedModules.length) {
    return { status: "completed", progress: 100 };
  }
  return { status: "in-progress", progress };
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run lib/scorm/course-progress.test.ts`
Expected: PASS, 3/3.

- [ ] **Step 9: Run the full suite**

Run: `npx vitest run`
Expected: all tests pass.

- [ ] **Step 10: Commit**

```bash
git add lib/db/queries.ts lib/db/queries.test.ts lib/scorm/course-progress.ts lib/scorm/course-progress.test.ts
git commit -m "feat: add published-course filtering, builder query, and course progress rollup"
```

---

### Task 3: Course-authoring mutation functions

**Files:**
- Create: `lib/db/course-authoring.ts`
- Create: `lib/db/course-authoring.test.ts`

**Interfaces:**
- Consumes: `courses`, `modules`, `moduleVersions`, `scormModuleVersions`, `videoModuleVersions` from `lib/db/schema.ts` (Task 1).
- Produces: `createDraftCourse(): Promise<{ id: string }>`; `updateCourseDetails(courseId: string, fields: CourseDetailsUpdate): Promise<void>`; `publishCourse(courseId: string): Promise<{ ok: true } | { error: string }>`; `removeModule(courseId: string, moduleId: string): Promise<void>`; `reorderModules(courseId: string, orderedModuleIds: string[]): Promise<void>`; `addVideoPlaceholderModule(courseId: string, title: string, durationMinutes: number | null): Promise<{ moduleVersionId: string }>`. All consumed by Task 4's API routes.

- [ ] **Step 1: Write the failing tests**

Create `lib/db/course-authoring.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  createDraftCourse,
  updateCourseDetails,
  publishCourse,
  removeModule,
  reorderModules,
  addVideoPlaceholderModule,
} from "./course-authoring";
import { db } from "./client";
import { courses, modules, moduleVersions, videoModuleVersions } from "./schema";

describe("createDraftCourse", () => {
  it("creates a draft course with a generated title and unique code", async () => {
    const { id } = await createDraftCourse();
    try {
      const [course] = await db.select().from(courses).where(eq(courses.id, id));
      expect(course.status).toBe("draft");
      expect(course.title).toBe("Untitled Course");
      expect(course.code).toBeTruthy();
    } finally {
      await db.delete(courses).where(eq(courses.id, id));
    }
  });
});

describe("updateCourseDetails", () => {
  it("updates only the fields provided", async () => {
    const { id } = await createDraftCourse();
    try {
      await updateCourseDetails(id, { title: "New Title", department: "IT", compliance: true });
      const [course] = await db.select().from(courses).where(eq(courses.id, id));
      expect(course.title).toBe("New Title");
      expect(course.department).toBe("IT");
      expect(course.compliance).toBe(true);
    } finally {
      await db.delete(courses).where(eq(courses.id, id));
    }
  });

  it("clears the due date when given null", async () => {
    const { id } = await createDraftCourse();
    try {
      await updateCourseDetails(id, { dueDate: "2026-12-01" });
      await updateCourseDetails(id, { dueDate: null });
      const [course] = await db.select().from(courses).where(eq(courses.id, id));
      expect(course.dueDate).toBeNull();
    } finally {
      await db.delete(courses).where(eq(courses.id, id));
    }
  });
});

describe("publishCourse", () => {
  it("refuses to publish a course with zero modules", async () => {
    const { id } = await createDraftCourse();
    try {
      const result = await publishCourse(id);
      expect(result).toEqual({ error: "Add at least one module before publishing" });
      const [course] = await db.select().from(courses).where(eq(courses.id, id));
      expect(course.status).toBe("draft");
    } finally {
      await db.delete(courses).where(eq(courses.id, id));
    }
  });

  it("publishes a course with at least one module", async () => {
    const { id } = await createDraftCourse();
    try {
      await addVideoPlaceholderModule(id, "A Module", 5);
      const result = await publishCourse(id);
      expect(result).toEqual({ ok: true });
      const [course] = await db.select().from(courses).where(eq(courses.id, id));
      expect(course.status).toBe("published");
    } finally {
      const mods = await db.select().from(modules).where(eq(modules.courseId, id));
      const moduleIds = mods.map((m) => m.id);
      await db.update(modules).set({ currentVersionId: null }).where(inArray(modules.id, moduleIds));
      const versions = await db.select().from(moduleVersions).where(inArray(moduleVersions.moduleId, moduleIds));
      const versionIds = versions.map((v) => v.id);
      await db.delete(videoModuleVersions).where(inArray(videoModuleVersions.moduleVersionId, versionIds));
      await db.delete(moduleVersions).where(inArray(moduleVersions.id, versionIds));
      await db.delete(modules).where(inArray(modules.id, moduleIds));
      await db.delete(courses).where(eq(courses.id, id));
    }
  });
});

describe("addVideoPlaceholderModule", () => {
  it("creates a module, version, and video_module_versions row, and sets currentVersionId", async () => {
    const { id: courseId } = await createDraftCourse();
    try {
      const { moduleVersionId } = await addVideoPlaceholderModule(courseId, "Intro Video", 12);

      const [video] = await db
        .select()
        .from(videoModuleVersions)
        .where(eq(videoModuleVersions.moduleVersionId, moduleVersionId));
      expect(video.durationMinutes).toBe(12);

      const [mod] = await db.select().from(modules).where(eq(modules.courseId, courseId));
      expect(mod.moduleType).toBe("video");
      expect(mod.currentVersionId).toBe(moduleVersionId);
    } finally {
      const mods = await db.select().from(modules).where(eq(modules.courseId, courseId));
      const moduleIds = mods.map((m) => m.id);
      await db.update(modules).set({ currentVersionId: null }).where(inArray(modules.id, moduleIds));
      const versions = await db.select().from(moduleVersions).where(inArray(moduleVersions.moduleId, moduleIds));
      const versionIds = versions.map((v) => v.id);
      await db.delete(videoModuleVersions).where(inArray(videoModuleVersions.moduleVersionId, versionIds));
      await db.delete(moduleVersions).where(inArray(moduleVersions.id, versionIds));
      await db.delete(modules).where(inArray(modules.id, moduleIds));
      await db.delete(courses).where(eq(courses.id, courseId));
    }
  });
});

describe("removeModule", () => {
  it("deletes a module and its version rows", async () => {
    const { id: courseId } = await createDraftCourse();
    try {
      const { moduleVersionId } = await addVideoPlaceholderModule(courseId, "To Remove", 3);
      const [mod] = await db.select().from(modules).where(eq(modules.courseId, courseId));

      await removeModule(courseId, mod.id);

      const remainingModules = await db.select().from(modules).where(eq(modules.courseId, courseId));
      expect(remainingModules).toHaveLength(0);
      const remainingVersions = await db
        .select()
        .from(videoModuleVersions)
        .where(eq(videoModuleVersions.moduleVersionId, moduleVersionId));
      expect(remainingVersions).toHaveLength(0);
    } finally {
      await db.delete(courses).where(eq(courses.id, courseId));
    }
  });

  it("does nothing if the module belongs to a different course", async () => {
    const { id: courseId } = await createDraftCourse();
    const { id: otherCourseId } = await createDraftCourse();
    try {
      await addVideoPlaceholderModule(courseId, "Belongs Here", 3);
      const [mod] = await db.select().from(modules).where(eq(modules.courseId, courseId));

      await removeModule(otherCourseId, mod.id);

      const stillThere = await db.select().from(modules).where(eq(modules.id, mod.id));
      expect(stillThere).toHaveLength(1);
    } finally {
      const mods = await db.select().from(modules).where(eq(modules.courseId, courseId));
      const moduleIds = mods.map((m) => m.id);
      await db.update(modules).set({ currentVersionId: null }).where(inArray(modules.id, moduleIds));
      const versions = await db.select().from(moduleVersions).where(inArray(moduleVersions.moduleId, moduleIds));
      const versionIds = versions.map((v) => v.id);
      await db.delete(videoModuleVersions).where(inArray(videoModuleVersions.moduleVersionId, versionIds));
      await db.delete(moduleVersions).where(inArray(moduleVersions.id, versionIds));
      await db.delete(modules).where(inArray(modules.id, moduleIds));
      await db.delete(courses).where(inArray(courses.id, [courseId, otherCourseId]));
    }
  });
});

describe("reorderModules", () => {
  it("updates sortOrder to match the given order", async () => {
    const { id: courseId } = await createDraftCourse();
    try {
      await addVideoPlaceholderModule(courseId, "First", 1);
      await addVideoPlaceholderModule(courseId, "Second", 1);
      const mods = await db
        .select()
        .from(modules)
        .where(eq(modules.courseId, courseId))
        .orderBy(modules.createdAt);
      const [first, second] = mods;

      await reorderModules(courseId, [second.id, first.id]);

      const reordered = await db
        .select()
        .from(modules)
        .where(eq(modules.courseId, courseId))
        .orderBy(modules.sortOrder);
      expect(reordered[0].id).toBe(second.id);
      expect(reordered[1].id).toBe(first.id);
    } finally {
      const mods = await db.select().from(modules).where(eq(modules.courseId, courseId));
      const moduleIds = mods.map((m) => m.id);
      await db.update(modules).set({ currentVersionId: null }).where(inArray(modules.id, moduleIds));
      const versions = await db.select().from(moduleVersions).where(inArray(moduleVersions.moduleId, moduleIds));
      const versionIds = versions.map((v) => v.id);
      await db.delete(videoModuleVersions).where(inArray(videoModuleVersions.moduleVersionId, versionIds));
      await db.delete(moduleVersions).where(inArray(moduleVersions.id, versionIds));
      await db.delete(modules).where(inArray(modules.id, moduleIds));
      await db.delete(courses).where(eq(courses.id, courseId));
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/db/course-authoring.test.ts`
Expected: FAIL — the module doesn't exist yet.

- [ ] **Step 3: Implement the mutation functions**

Create `lib/db/course-authoring.ts`:

```ts
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "./client";
import { courses, modules, moduleVersions, scormModuleVersions, videoModuleVersions } from "./schema";

export async function createDraftCourse(): Promise<{ id: string }> {
  const [course] = await db
    .insert(courses)
    .values({ code: `DRAFT-${randomUUID().slice(0, 8)}`, title: "Untitled Course" })
    .returning();
  return { id: course.id };
}

export interface CourseDetailsUpdate {
  title?: string;
  code?: string;
  department?: string | null;
  compliance?: boolean;
  dueDate?: string | null;
  thumbnail?: string | null;
}

export async function updateCourseDetails(
  courseId: string,
  fields: CourseDetailsUpdate
): Promise<void> {
  const update: Record<string, unknown> = {};
  if (fields.title !== undefined) update.title = fields.title;
  if (fields.code !== undefined) update.code = fields.code;
  if (fields.department !== undefined) update.department = fields.department;
  if (fields.compliance !== undefined) update.compliance = fields.compliance;
  if (fields.dueDate !== undefined) {
    update.dueDate = fields.dueDate ? new Date(fields.dueDate) : null;
  }
  if (fields.thumbnail !== undefined) update.thumbnail = fields.thumbnail;
  if (Object.keys(update).length === 0) return;
  await db.update(courses).set(update).where(eq(courses.id, courseId));
}

export async function publishCourse(
  courseId: string
): Promise<{ ok: true } | { error: string }> {
  const courseModules = await db.select().from(modules).where(eq(modules.courseId, courseId));
  if (courseModules.length === 0) {
    return { error: "Add at least one module before publishing" };
  }
  await db.update(courses).set({ status: "published" }).where(eq(courses.id, courseId));
  return { ok: true };
}

export async function addVideoPlaceholderModule(
  courseId: string,
  title: string,
  durationMinutes: number | null
): Promise<{ moduleVersionId: string }> {
  const [courseModule] = await db
    .insert(modules)
    .values({ courseId, moduleType: "video", title })
    .returning();
  const [version] = await db
    .insert(moduleVersions)
    .values({ moduleId: courseModule.id, versionNumber: 1, status: "published", publishedAt: new Date() })
    .returning();
  await db.insert(videoModuleVersions).values({ moduleVersionId: version.id, durationMinutes });
  await db.update(modules).set({ currentVersionId: version.id }).where(eq(modules.id, courseModule.id));
  return { moduleVersionId: version.id };
}

export async function removeModule(courseId: string, moduleId: string): Promise<void> {
  const [courseModule] = await db
    .select()
    .from(modules)
    .where(and(eq(modules.id, moduleId), eq(modules.courseId, courseId)));
  if (!courseModule) return;

  await db.update(modules).set({ currentVersionId: null }).where(eq(modules.id, courseModule.id));

  const versions = await db
    .select()
    .from(moduleVersions)
    .where(eq(moduleVersions.moduleId, courseModule.id));
  const versionIds = versions.map((v) => v.id);
  if (versionIds.length) {
    await db.delete(scormModuleVersions).where(inArray(scormModuleVersions.moduleVersionId, versionIds));
    await db.delete(videoModuleVersions).where(inArray(videoModuleVersions.moduleVersionId, versionIds));
    await db.delete(moduleVersions).where(inArray(moduleVersions.id, versionIds));
  }

  await db.delete(modules).where(eq(modules.id, courseModule.id));
}

export async function reorderModules(courseId: string, orderedModuleIds: string[]): Promise<void> {
  await db.transaction(async (tx) => {
    for (let i = 0; i < orderedModuleIds.length; i++) {
      await tx
        .update(modules)
        .set({ sortOrder: i })
        .where(and(eq(modules.id, orderedModuleIds[i]), eq(modules.courseId, courseId)));
    }
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/db/course-authoring.test.ts`
Expected: PASS, all tests.

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add lib/db/course-authoring.ts lib/db/course-authoring.test.ts
git commit -m "feat: add course-authoring mutation functions"
```

---

### Task 4: Admin course API routes

**Files:**
- Create: `app/api/admin/courses/route.ts`
- Create: `app/api/admin/courses/route.test.ts`
- Create: `app/api/admin/courses/[courseId]/route.ts`
- Create: `app/api/admin/courses/[courseId]/route.test.ts`
- Create: `app/api/admin/courses/[courseId]/publish/route.ts`
- Create: `app/api/admin/courses/[courseId]/publish/route.test.ts`
- Create: `app/api/admin/courses/[courseId]/modules/video/route.ts`
- Create: `app/api/admin/courses/[courseId]/modules/[moduleId]/route.ts`
- Create: `app/api/admin/courses/[courseId]/modules/reorder/route.ts`
- Create: `app/api/admin/courses/[courseId]/modules/reorder/route.test.ts`

**Interfaces:**
- Consumes: all six functions from `lib/db/course-authoring.ts` (Task 3); `isUuid`, `badRequest`, `notFound`, `serverError` from `lib/api/errors.ts` (already exist).
- Produces: `POST /api/admin/courses` → `{ courseId: string }`; `PATCH /api/admin/courses/[courseId]` → `{ ok: true }`; `POST /api/admin/courses/[courseId]/publish` → `{ ok: true }` or 400 `{ error }`; `POST /api/admin/courses/[courseId]/modules/video` → `{ moduleVersionId: string }`; `DELETE /api/admin/courses/[courseId]/modules/[moduleId]` → `{ ok: true }`; `PATCH /api/admin/courses/[courseId]/modules/reorder` → `{ ok: true }`. Consumed by Task 6 (builder UI).

- [ ] **Step 1: Write the failing tests for the create and publish routes**

Create `app/api/admin/courses/route.test.ts`:

```ts
import { describe, it, expect, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { POST } from "./route";
import { db } from "@/lib/db/client";
import { courses } from "@/lib/db/schema";

describe("POST /api/admin/courses", () => {
  let createdId: string | undefined;

  afterAll(async () => {
    if (createdId) await db.delete(courses).where(eq(courses.id, createdId));
  });

  it("creates a draft course and returns its id", async () => {
    const request = new NextRequest("http://localhost/api/admin/courses", { method: "POST" });
    const response = await POST(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.courseId).toBeTruthy();
    createdId = body.courseId;

    const [course] = await db.select().from(courses).where(eq(courses.id, body.courseId));
    expect(course.status).toBe("draft");
  });
});
```

Create `app/api/admin/courses/[courseId]/publish/route.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { POST } from "./route";
import { createDraftCourse, addVideoPlaceholderModule } from "@/lib/db/course-authoring";
import { db } from "@/lib/db/client";
import { courses, modules, moduleVersions, videoModuleVersions } from "@/lib/db/schema";

describe("POST /api/admin/courses/[courseId]/publish", () => {
  it("returns 400 when the course has no modules", async () => {
    const { id } = await createDraftCourse();
    try {
      const request = new NextRequest(
        `http://localhost/api/admin/courses/${id}/publish`,
        { method: "POST" }
      );
      const response = await POST(request, { params: Promise.resolve({ courseId: id }) });
      expect(response.status).toBe(400);
    } finally {
      await db.delete(courses).where(eq(courses.id, id));
    }
  });

  it("publishes a course that has at least one module", async () => {
    const { id } = await createDraftCourse();
    await addVideoPlaceholderModule(id, "A Module", 5);
    try {
      const request = new NextRequest(
        `http://localhost/api/admin/courses/${id}/publish`,
        { method: "POST" }
      );
      const response = await POST(request, { params: Promise.resolve({ courseId: id }) });
      expect(response.status).toBe(200);

      const [course] = await db.select().from(courses).where(eq(courses.id, id));
      expect(course.status).toBe("published");
    } finally {
      const mods = await db.select().from(modules).where(eq(modules.courseId, id));
      const moduleIds = mods.map((m) => m.id);
      await db.update(modules).set({ currentVersionId: null }).where(inArray(modules.id, moduleIds));
      const versions = await db.select().from(moduleVersions).where(inArray(moduleVersions.moduleId, moduleIds));
      const versionIds = versions.map((v) => v.id);
      await db.delete(videoModuleVersions).where(inArray(videoModuleVersions.moduleVersionId, versionIds));
      await db.delete(moduleVersions).where(inArray(moduleVersions.id, versionIds));
      await db.delete(modules).where(inArray(modules.id, moduleIds));
      await db.delete(courses).where(eq(courses.id, id));
    }
  });
});
```

Create `app/api/admin/courses/[courseId]/route.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { PATCH } from "./route";
import { createDraftCourse } from "@/lib/db/course-authoring";
import { db } from "@/lib/db/client";
import { courses } from "@/lib/db/schema";

describe("PATCH /api/admin/courses/[courseId]", () => {
  it("updates the given fields", async () => {
    const { id } = await createDraftCourse();
    try {
      const request = new NextRequest(`http://localhost/api/admin/courses/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ title: "Renamed", department: "HR", compliance: true }),
      });
      const response = await PATCH(request, { params: Promise.resolve({ courseId: id }) });
      expect(response.status).toBe(200);

      const [course] = await db.select().from(courses).where(eq(courses.id, id));
      expect(course.title).toBe("Renamed");
      expect(course.department).toBe("HR");
      expect(course.compliance).toBe(true);
    } finally {
      await db.delete(courses).where(eq(courses.id, id));
    }
  });

  it("returns 400 for a non-UUID courseId", async () => {
    const request = new NextRequest("http://localhost/api/admin/courses/not-a-uuid", {
      method: "PATCH",
      body: JSON.stringify({ title: "X" }),
    });
    const response = await PATCH(request, { params: Promise.resolve({ courseId: "not-a-uuid" }) });
    expect(response.status).toBe(400);
  });
});
```

Create `app/api/admin/courses/[courseId]/modules/reorder/route.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { PATCH } from "./route";
import { createDraftCourse, addVideoPlaceholderModule } from "@/lib/db/course-authoring";
import { db } from "@/lib/db/client";
import { courses, modules, moduleVersions, videoModuleVersions } from "@/lib/db/schema";

describe("PATCH /api/admin/courses/[courseId]/modules/reorder", () => {
  it("reorders modules to match the given array", async () => {
    const { id: courseId } = await createDraftCourse();
    await addVideoPlaceholderModule(courseId, "First", 1);
    await addVideoPlaceholderModule(courseId, "Second", 1);
    try {
      const mods = await db
        .select()
        .from(modules)
        .where(eq(modules.courseId, courseId))
        .orderBy(modules.createdAt);
      const [first, second] = mods;

      const request = new NextRequest(
        `http://localhost/api/admin/courses/${courseId}/modules/reorder`,
        { method: "PATCH", body: JSON.stringify({ moduleIds: [second.id, first.id] }) }
      );
      const response = await PATCH(request, { params: Promise.resolve({ courseId }) });
      expect(response.status).toBe(200);

      const reordered = await db
        .select()
        .from(modules)
        .where(eq(modules.courseId, courseId))
        .orderBy(modules.sortOrder);
      expect(reordered[0].id).toBe(second.id);
    } finally {
      const mods = await db.select().from(modules).where(eq(modules.courseId, courseId));
      const moduleIds = mods.map((m) => m.id);
      await db.update(modules).set({ currentVersionId: null }).where(inArray(modules.id, moduleIds));
      const versions = await db.select().from(moduleVersions).where(inArray(moduleVersions.moduleId, moduleIds));
      const versionIds = versions.map((v) => v.id);
      await db.delete(videoModuleVersions).where(inArray(videoModuleVersions.moduleVersionId, versionIds));
      await db.delete(moduleVersions).where(inArray(moduleVersions.id, versionIds));
      await db.delete(modules).where(inArray(modules.id, moduleIds));
      await db.delete(courses).where(eq(courses.id, courseId));
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run app/api/admin/courses`
Expected: FAIL — none of the route files exist yet.

- [ ] **Step 3: Implement the routes**

Create `app/api/admin/courses/route.ts`:

```ts
import { NextResponse } from "next/server";
import { createDraftCourse } from "@/lib/db/course-authoring";
import { serverError } from "@/lib/api/errors";

export async function POST() {
  try {
    const { id } = await createDraftCourse();
    return NextResponse.json({ courseId: id });
  } catch (error) {
    return serverError(error);
  }
}
```

Create `app/api/admin/courses/[courseId]/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { updateCourseDetails } from "@/lib/db/course-authoring";
import { badRequest, isUuid, serverError } from "@/lib/api/errors";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ courseId: string }> }
) {
  try {
    const { courseId } = await params;
    if (!isUuid(courseId)) {
      return badRequest("courseId must be a UUID");
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return badRequest("Request body must be valid JSON");
    }

    await updateCourseDetails(courseId, body as Record<string, unknown>);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return serverError(error);
  }
}
```

Create `app/api/admin/courses/[courseId]/publish/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { publishCourse } from "@/lib/db/course-authoring";
import { badRequest, isUuid, serverError } from "@/lib/api/errors";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ courseId: string }> }
) {
  try {
    const { courseId } = await params;
    if (!isUuid(courseId)) {
      return badRequest("courseId must be a UUID");
    }

    const result = await publishCourse(courseId);
    if ("error" in result) {
      return badRequest(result.error);
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return serverError(error);
  }
}
```

Create `app/api/admin/courses/[courseId]/modules/video/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { addVideoPlaceholderModule } from "@/lib/db/course-authoring";
import { badRequest, isUuid, serverError } from "@/lib/api/errors";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ courseId: string }> }
) {
  try {
    const { courseId } = await params;
    if (!isUuid(courseId)) {
      return badRequest("courseId must be a UUID");
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return badRequest("Request body must be valid JSON");
    }

    const { title, durationMinutes } = (body ?? {}) as { title?: string; durationMinutes?: number };
    if (typeof title !== "string" || title.trim().length === 0) {
      return badRequest("title is required");
    }

    const { moduleVersionId } = await addVideoPlaceholderModule(
      courseId,
      title,
      typeof durationMinutes === "number" ? durationMinutes : null
    );
    return NextResponse.json({ moduleVersionId });
  } catch (error) {
    return serverError(error);
  }
}
```

Create `app/api/admin/courses/[courseId]/modules/[moduleId]/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { removeModule } from "@/lib/db/course-authoring";
import { badRequest, isUuid, serverError } from "@/lib/api/errors";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ courseId: string; moduleId: string }> }
) {
  try {
    const { courseId, moduleId } = await params;
    if (!isUuid(courseId) || !isUuid(moduleId)) {
      return badRequest("courseId and moduleId must be UUIDs");
    }

    await removeModule(courseId, moduleId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return serverError(error);
  }
}
```

Create `app/api/admin/courses/[courseId]/modules/reorder/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { reorderModules } from "@/lib/db/course-authoring";
import { badRequest, isUuid, serverError } from "@/lib/api/errors";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ courseId: string }> }
) {
  try {
    const { courseId } = await params;
    if (!isUuid(courseId)) {
      return badRequest("courseId must be a UUID");
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return badRequest("Request body must be valid JSON");
    }

    const { moduleIds } = (body ?? {}) as { moduleIds?: unknown };
    if (!Array.isArray(moduleIds) || !moduleIds.every((id) => typeof id === "string")) {
      return badRequest("moduleIds must be an array of strings");
    }

    await reorderModules(courseId, moduleIds);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return serverError(error);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run app/api/admin/courses`
Expected: PASS, all tests.

- [ ] **Step 5: Typecheck and run the full suite**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx vitest run`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add app/api/admin/courses
git commit -m "feat: add admin course authoring API routes"
```

---

### Task 5: SCORM upload route — attach to an existing course

**Files:**
- Modify: `app/api/admin/scorm-upload/route.ts`
- Modify: `app/api/admin/scorm-upload/route.test.ts`

**Interfaces:**
- Consumes: `courses`, `modules`, `moduleVersions`, `scormModuleVersions` from `lib/db/schema.ts` (unchanged); `isUuid` from `lib/api/errors.ts`.
- Produces: the route's request body gains an optional `courseId` field. When provided, the route attaches the new module to that course instead of creating/reusing a course by code. Response shape (`{ moduleVersionId, launchUrl, prefix }`) is unchanged. Consumed by Task 6 (builder's "Upload SCORM Package" path).

- [ ] **Step 1: Write the failing test for attach mode**

Add to `app/api/admin/scorm-upload/route.test.ts`, inside the existing `describe` block (after the existing tests):

```ts
  it("attaches to an existing course when courseId is provided, without needing courseCode/courseTitle", async () => {
    const [existingCourse] = await db
      .insert(courses)
      .values({ code: `${courseCode}-attach`, title: "Attach Target Course" })
      .returning();

    const form = new FormData();
    form.set(
      "package",
      new File([new Uint8Array(buildSamplePackage())], "package.zip", { type: "application/zip" })
    );
    form.set("courseId", existingCourse.id);
    form.set("moduleTitle", "Attached Module");

    const request = new NextRequest("http://localhost/api/admin/scorm-upload", {
      method: "POST",
      body: form,
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    const body = await response.json();

    const attachedModule = await db.select().from(modules).where(eq(modules.courseId, existingCourse.id));
    expect(attachedModule).toHaveLength(1);
    expect(attachedModule[0].title).toBe("Attached Module");

    await db.delete(scormModuleVersions).where(eq(scormModuleVersions.moduleVersionId, body.moduleVersionId));
    await db.update(modules).set({ currentVersionId: null }).where(eq(modules.courseId, existingCourse.id));
    await db.delete(moduleVersions).where(eq(moduleVersions.id, body.moduleVersionId));
    await db.delete(modules).where(eq(modules.courseId, existingCourse.id));
    await db.delete(courses).where(eq(courses.id, existingCourse.id));
    const { data } = await supabaseStorage.from("scorm-packages").list(body.prefix);
    const paths = (data ?? []).map((f) => `${body.prefix}/${f.name}`);
    if (paths.length) await supabaseStorage.from("scorm-packages").remove(paths);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/api/admin/scorm-upload/route.test.ts`
Expected: FAIL — the new test's request is currently rejected as missing `courseCode`/`courseTitle` (still required in the current implementation).

- [ ] **Step 3: Implement attach mode**

In `app/api/admin/scorm-upload/route.ts`, add `isUuid` to the import from `@/lib/api/errors`:

```ts
import { badRequest, isUuid, serverError } from "@/lib/api/errors";
```

Replace the field extraction and validation block:

```ts
    const file = formData.get("package");
    const courseId = formData.get("courseId");
    const courseCode = formData.get("courseCode");
    const courseTitle = formData.get("courseTitle");
    const moduleTitle = formData.get("moduleTitle");

    if (!(file instanceof File) || typeof moduleTitle !== "string") {
      return badRequest("package and moduleTitle are required");
    }
    const attachToExistingCourse = typeof courseId === "string" && courseId.length > 0;
    if (!attachToExistingCourse && (typeof courseCode !== "string" || typeof courseTitle !== "string")) {
      return badRequest(
        "courseCode and courseTitle are required unless courseId is provided"
      );
    }
    if (attachToExistingCourse && !isUuid(courseId as string)) {
      return badRequest("courseId must be a UUID");
    }
```

Replace the course-resolution block:

```ts
    let course: typeof courses.$inferSelect;
    if (attachToExistingCourse) {
      const [existing] = await db.select().from(courses).where(eq(courses.id, courseId as string));
      if (!existing) {
        return badRequest("No course exists with that courseId");
      }
      course = existing;
    } else {
      const existing = await db.select().from(courses).where(eq(courses.code, courseCode as string));
      course =
        existing[0] ??
        (await db
          .insert(courses)
          .values({ code: courseCode as string, title: courseTitle as string })
          .returning())[0];
    }
```

(This replaces the previous `const existing = ...` / `const course = existing[0] ?? ...` two-line block — the rest of the route, from `const [courseModule] = await db.insert(modules)...` onward, is unchanged.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run app/api/admin/scorm-upload/route.test.ts`
Expected: PASS, all tests including the new one.

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx vitest run`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add app/api/admin/scorm-upload/route.ts app/api/admin/scorm-upload/route.test.ts
git commit -m "feat: let the SCORM upload route attach to an existing course"
```

---

### Task 6: Course builder UI

**Files:**
- Create: `app/(app)/admin/content/builder/[courseId]/page.tsx`
- Create: `app/(app)/admin/content/builder/[courseId]/builder-client.tsx`
- Modify: `package.json` (new dependencies)

**Interfaces:**
- Consumes: `getCourseForBuilder(courseId)` from `lib/db/queries.ts` (Task 2); all six admin course API routes from Task 4; the modified SCORM upload route from Task 5.
- Produces: the `/admin/content/builder/[courseId]` route. Consumed by Task 7 (Content Authoring page links here).

- [ ] **Step 1: Install the drag-and-drop dependency**

Run: `npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities`
Expected: `package.json`/`package-lock.json` updated, no errors.

- [ ] **Step 2: Create the server component wrapper**

Create `app/(app)/admin/content/builder/[courseId]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { getCourseForBuilder } from "@/lib/db/queries";
import { BuilderClient } from "./builder-client";

export default async function CourseBuilderPage(
  props: PageProps<"/admin/content/builder/[courseId]">
) {
  const { courseId } = await props.params;
  const course = await getCourseForBuilder(courseId);
  if (!course) {
    notFound();
  }

  return <BuilderClient initialCourse={course} />;
}
```

- [ ] **Step 3: Create the client component**

Create `app/(app)/admin/content/builder/[courseId]/builder-client.tsx`:

```tsx
"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  FileArchive,
  GripVertical,
  Loader2,
  PlayCircle,
  Trash2,
  UploadCloud,
} from "lucide-react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { CourseForBuilder, BuilderModule } from "@/lib/db/queries";

function ModuleRow({
  module,
  onRemove,
}: {
  module: BuilderModule;
  onRemove: (moduleId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: module.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2.5"
    >
      <button
        type="button"
        className="cursor-grab text-muted-foreground touch-none"
        aria-label="Drag to reorder"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <div className="flex-1">
        <p className="text-sm font-medium">{module.title}</p>
      </div>
      <Badge variant="outline" className="text-[10px] uppercase">
        {module.moduleType}
      </Badge>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Remove module"
        onClick={() => onRemove(module.id)}
      >
        <Trash2 className="h-4 w-4 text-destructive" />
      </Button>
    </div>
  );
}

export function BuilderClient({ initialCourse }: { initialCourse: CourseForBuilder }) {
  const [course, setCourse] = useState(initialCourse);
  const [addModuleOpen, setAddModuleOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [videoTitle, setVideoTitle] = useState("");
  const [videoDuration, setVideoDuration] = useState("");
  const [scormFile, setScormFile] = useState<File | null>(null);
  const [scormTitle, setScormTitle] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sensors = useSensors(useSensor(PointerSensor));

  async function patchDetails(fields: Record<string, unknown>) {
    await fetch(`/api/admin/courses/${course.id}`, {
      method: "PATCH",
      body: JSON.stringify(fields),
    });
  }

  function updateField<K extends keyof CourseForBuilder>(key: K, value: CourseForBuilder[K]) {
    setCourse((prev) => ({ ...prev, [key]: value }));
  }

  async function handleRemoveModule(moduleId: string) {
    setCourse((prev) => ({ ...prev, modules: prev.modules.filter((m) => m.id !== moduleId) }));
    await fetch(`/api/admin/courses/${course.id}/modules/${moduleId}`, { method: "DELETE" });
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = course.modules.findIndex((m) => m.id === active.id);
    const newIndex = course.modules.findIndex((m) => m.id === over.id);
    const reordered = arrayMove(course.modules, oldIndex, newIndex);
    setCourse((prev) => ({ ...prev, modules: reordered }));

    await fetch(`/api/admin/courses/${course.id}/modules/reorder`, {
      method: "PATCH",
      body: JSON.stringify({ moduleIds: reordered.map((m) => m.id) }),
    });
  }

  async function handleAddVideo(e: React.FormEvent) {
    e.preventDefault();
    const response = await fetch(`/api/admin/courses/${course.id}/modules/video`, {
      method: "POST",
      body: JSON.stringify({
        title: videoTitle,
        durationMinutes: videoDuration ? Number(videoDuration) : null,
      }),
    });
    if (response.ok) {
      const { moduleVersionId } = await response.json();
      setCourse((prev) => ({
        ...prev,
        modules: [
          ...prev.modules,
          {
            id: moduleVersionId,
            title: videoTitle,
            moduleType: "video",
            moduleVersionId,
            sortOrder: prev.modules.length,
          },
        ],
      }));
      setVideoTitle("");
      setVideoDuration("");
      setAddModuleOpen(false);
    }
  }

  async function handleUploadScorm(e: React.FormEvent) {
    e.preventDefault();
    if (!scormFile) {
      setUploadError("Choose a SCORM .zip package to upload");
      return;
    }
    setUploading(true);
    setUploadError(null);
    const form = new FormData();
    form.set("package", scormFile);
    form.set("courseId", course.id);
    form.set("moduleTitle", scormTitle);

    const response = await fetch("/api/admin/scorm-upload", { method: "POST", body: form });
    const body = await response.json();
    if (!response.ok) {
      setUploadError(body.error ?? "Upload failed");
      setUploading(false);
      return;
    }
    setCourse((prev) => ({
      ...prev,
      modules: [
        ...prev.modules,
        {
          id: body.moduleVersionId,
          title: scormTitle,
          moduleType: "scorm",
          moduleVersionId: body.moduleVersionId,
          sortOrder: prev.modules.length,
        },
      ],
    }));
    setScormFile(null);
    setScormTitle("");
    setUploading(false);
    setAddModuleOpen(false);
  }

  async function handlePublish() {
    setPublishing(true);
    setPublishError(null);
    const response = await fetch(`/api/admin/courses/${course.id}/publish`, { method: "POST" });
    const body = await response.json();
    if (!response.ok) {
      setPublishError(body.error ?? "Could not publish");
      setPublishing(false);
      return;
    }
    setCourse((prev) => ({ ...prev, status: "published" }));
    setPublishing(false);
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <Link
            href="/admin/content"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Content Authoring
          </Link>
          <div className="mt-2 flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{course.title}</h1>
            <Badge variant={course.status === "published" ? "secondary" : "outline"}>
              {course.status === "published" ? "Published" : "Draft"}
            </Badge>
          </div>
        </div>
        <Button
          onClick={handlePublish}
          disabled={publishing || course.modules.length === 0}
        >
          {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {course.status === "published" ? "Republish" : "Publish"}
        </Button>
      </div>
      {publishError && <p className="text-sm text-destructive">{publishError}</p>}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Course Details</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                value={course.title}
                onChange={(e) => updateField("title", e.target.value)}
                onBlur={() => patchDetails({ title: course.title })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="code">Course Code</Label>
              <Input
                id="code"
                value={course.code}
                onChange={(e) => updateField("code", e.target.value)}
                onBlur={() => patchDetails({ code: course.code })}
              />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="department">Department</Label>
              <Input
                id="department"
                value={course.department ?? ""}
                placeholder="General"
                onChange={(e) => updateField("department", e.target.value)}
                onBlur={() => patchDetails({ department: course.department })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="dueDate">Due Date (optional)</Label>
              <Input
                id="dueDate"
                type="date"
                value={course.dueDate ? course.dueDate.slice(0, 10) : ""}
                onChange={(e) => updateField("dueDate", e.target.value || null)}
                onBlur={() => patchDetails({ dueDate: course.dueDate })}
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="compliance"
              checked={course.compliance}
              onCheckedChange={(checked: boolean) => {
                updateField("compliance", checked);
                patchDetails({ compliance: checked });
              }}
            />
            <Label htmlFor="compliance">Compliance required</Label>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Modules</CardTitle>
          <Dialog open={addModuleOpen} onOpenChange={setAddModuleOpen}>
            <DialogTrigger
              render={
                <Button size="sm" type="button">
                  Add Module
                </Button>
              }
            />
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Module</DialogTitle>
              </DialogHeader>
              <Tabs defaultValue="scorm">
                <TabsList>
                  <TabsTrigger value="scorm">Upload SCORM Package</TabsTrigger>
                  <TabsTrigger value="video">Add Video Placeholder</TabsTrigger>
                </TabsList>
                <TabsContent value="scorm">
                  <form onSubmit={handleUploadScorm} className="flex flex-col gap-4 pt-4">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="scormModuleTitle">Module Title</Label>
                      <Input
                        id="scormModuleTitle"
                        value={scormTitle}
                        onChange={(e) => setScormTitle(e.target.value)}
                        required
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="scormPackage">SCORM Package (.zip)</Label>
                      <input
                        ref={fileInputRef}
                        id="scormPackage"
                        type="file"
                        accept=".zip,application/zip"
                        onChange={(e) => setScormFile(e.target.files?.[0] ?? null)}
                      />
                      {scormFile && (
                        <p className="flex items-center gap-2 text-xs text-muted-foreground">
                          <FileArchive className="h-3.5 w-3.5" />
                          {scormFile.name}
                        </p>
                      )}
                    </div>
                    {uploadError && <p className="text-sm text-destructive">{uploadError}</p>}
                    <Button type="submit" disabled={uploading}>
                      {uploading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <UploadCloud className="h-4 w-4" />
                      )}
                      {uploading ? "Uploading…" : "Upload"}
                    </Button>
                  </form>
                </TabsContent>
                <TabsContent value="video">
                  <form onSubmit={handleAddVideo} className="flex flex-col gap-4 pt-4">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="videoTitle">Module Title</Label>
                      <Input
                        id="videoTitle"
                        value={videoTitle}
                        onChange={(e) => setVideoTitle(e.target.value)}
                        required
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="videoDuration">Estimated Duration (minutes)</Label>
                      <Input
                        id="videoDuration"
                        type="number"
                        min={0}
                        value={videoDuration}
                        onChange={(e) => setVideoDuration(e.target.value)}
                      />
                    </div>
                    <Button type="submit">
                      <PlayCircle className="h-4 w-4" />
                      Add Video Placeholder
                    </Button>
                  </form>
                </TabsContent>
              </Tabs>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <Separator />
        <CardContent className="flex flex-col gap-2 pt-4">
          {course.modules.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No modules yet — add one to be able to publish this course.
            </p>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext
                items={course.modules.map((m) => m.id)}
                strategy={verticalListSortingStrategy}
              >
                {course.modules.map((module) => (
                  <ModuleRow key={module.id} module={module} onRemove={handleRemoveModule} />
                ))}
              </SortableContext>
            </DndContext>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. If `PageProps<"/admin/content/builder/[courseId]">` errors as an unknown route, run `npm run dev`, let it start, stop it, and re-run `tsc` (Next.js generates route types from the filesystem on first dev-server run).

- [ ] **Step 5: Manually verify**

1. `npm run dev` (local dev, port 3001).
2. Navigate to `/admin/content`, note a course id doesn't exist yet — for this step, create one directly: `curl -X POST http://localhost:3001/api/admin/courses` (or use the browser's dev tools to POST) to get a `courseId`, then visit `/admin/content/builder/<that-id>`.
3. Confirm the page loads: title "Untitled Course", Draft badge, empty modules list, Publish button disabled.
4. Edit the title, department, due date, compliance switch — confirm each persists after a page reload (autosave via `onBlur`/`onCheckedChange` working).
5. Click "Add Module" → "Add Video Placeholder" tab, fill in a title and duration, submit — confirm it appears in the modules list with a "VIDEO" badge.
6. Click "Add Module" → "Upload SCORM Package" tab, upload a real package from `SCORM_Test_Packages/` — confirm it appears with a "SCORM" badge.
7. Drag to reorder the two modules — confirm the order persists after a page reload.
8. Remove a module — confirm it disappears and reload confirms it's gone.
9. Click Publish — confirm the badge switches to "Published".

- [ ] **Step 6: Commit**

```bash
git add "app/(app)/admin/content/builder" package.json package-lock.json
git commit -m "feat: add the course builder UI"
```

---

### Task 7: Content Authoring page wiring

**Files:**
- Modify: `app/(app)/admin/content/page.tsx`
- Create: `app/api/admin/courses/list/route.ts`

**Interfaces:**
- Consumes: `POST /api/admin/courses` (Task 4); `getCourseForBuilder`/`listRealCourses` from `lib/db/queries.ts`; `/admin/content/builder/[courseId]` (Task 6).
- Produces: `GET /api/admin/courses/list` → `{ courses: (RealCourseSummary & { status: string })[] }`. The "New Course" button creates a draft and navigates to the builder; each real course row's "Edit" button links to its builder page; a Draft/Published badge is added per real-course row.

- [ ] **Step 1: Add the list-with-status route**

Create `app/api/admin/courses/list/route.ts`:

```ts
import { NextResponse } from "next/server";
import { listRealCourses, getCourseForBuilder } from "@/lib/db/queries";
import { serverError } from "@/lib/api/errors";

export async function GET() {
  try {
    const summaries = await listRealCourses();
    const withStatus = await Promise.all(
      summaries.map(async (course) => {
        const detail = await getCourseForBuilder(course.id);
        return { ...course, status: detail?.status ?? "draft" };
      })
    );
    return NextResponse.json({ courses: withStatus });
  } catch (error) {
    return serverError(error);
  }
}
```

This re-fetches per-course via `getCourseForBuilder` only to obtain `status` (not present on `RealCourseSummary`). Since this route is admin-only and course counts are expected to stay small (matching the rest of this project's un-batched per-item query patterns, e.g. `getCourseProgressForLearner`'s per-module loop), an N+1 here is acceptable — do not add `status` to `RealCourseSummary` itself, since that type is shared with the learner-facing `listPublishedCourses()` (Task 2) where every row is already known to be published and a `status` field would be redundant noise on every learner-facing card.

- [ ] **Step 2: Replace the Content Authoring page**

Replace the whole file `app/(app)/admin/content/page.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { courses as mockCourses } from "@/lib/mock-data/courses";
import type { RealCourseSummary } from "@/lib/db/queries";

export default function ContentAuthoringPage() {
  const router = useRouter();
  const [realCourses, setRealCourses] = useState<
    (RealCourseSummary & { status: string })[]
  >([]);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    fetch("/api/admin/courses/list")
      .then((res) => (res.ok ? res.json() : { courses: [] }))
      .then((body) => setRealCourses(body.courses ?? []))
      .catch(() => setRealCourses([]));
  }, []);

  async function handleNewCourse() {
    setCreating(true);
    const response = await fetch("/api/admin/courses", { method: "POST" });
    const body = await response.json();
    router.push(`/admin/content/builder/${body.courseId}`);
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Content Authoring</h1>
          <p className="text-sm text-muted-foreground">
            Build a course from one or more modules — SCORM packages and video placeholders.
          </p>
        </div>
        <Button onClick={handleNewCourse} disabled={creating}>
          <Plus className="h-4 w-4" />
          New Course
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">All Courses</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Modules</TableHead>
                <TableHead>Compliance</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {realCourses.map((course) => (
                <TableRow key={course.id}>
                  <TableCell className="font-medium">
                    <span className="flex items-center gap-2">
                      {course.title}
                      <Badge variant="secondary" className="text-[10px]">
                        Live
                      </Badge>
                      <Badge
                        variant={course.status === "published" ? "secondary" : "outline"}
                        className="text-[10px]"
                      >
                        {course.status === "published" ? "Published" : "Draft"}
                      </Badge>
                    </span>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {course.department ?? "General"}
                  </TableCell>
                  <TableCell>{course.moduleCount}</TableCell>
                  <TableCell>
                    {course.compliance ? (
                      <Badge variant="secondary">Required</Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Link href={`/admin/content/builder/${course.id}`}>
                      <Button variant="ghost" size="sm">
                        Edit
                      </Button>
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
              {mockCourses.map((course) => (
                <TableRow key={course.id}>
                  <TableCell className="font-medium">{course.title}</TableCell>
                  <TableCell>{course.department}</TableCell>
                  <TableCell>{course.modules.length}</TableCell>
                  <TableCell>
                    {course.compliance ? (
                      <Badge variant="secondary">Required</Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm">
                      Edit
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manually verify**

1. `npm run dev` (local dev, port 3001).
2. Visit `/admin/content` — confirm existing mock course rows are unchanged, and any existing real courses (from earlier session testing) show a Draft/Published badge alongside "Live".
3. Click "New Course" — confirm it navigates to `/admin/content/builder/<new-id>` with an empty "Untitled Course" draft.
4. Go back to `/admin/content` — confirm the new draft course now appears in the table with a "Draft" badge, and its "Edit" button links back into the builder.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/admin/content/page.tsx" app/api/admin/courses/list
git commit -m "feat: wire Content Authoring page into the course builder"
```

---

### Task 8: Learner course list — fold published courses into Active/Finished

**Files:**
- Modify: `app/(app)/courses/page.tsx`

**Interfaces:**
- Consumes: `listPublishedCourses()` from `lib/db/queries.ts` (Task 2); `getCourseProgressForLearner(courseId, userId)` from `lib/scorm/course-progress.ts` (Task 2); `auth()` from `@/auth` (already used elsewhere in this codebase, e.g. the learner SCORM route).

- [ ] **Step 1: Modify the page**

Replace `app/(app)/courses/page.tsx`:

```tsx
import Link from "next/link";
import { ShieldCheck, CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { courses } from "@/lib/mock-data/courses";
import { listPublishedCourses, type RealCourseSummary } from "@/lib/db/queries";
import { getCourseProgressForLearner } from "@/lib/scorm/course-progress";
import { auth } from "@/auth";

const statusLabel: Record<string, string> = {
  "not-started": "Not started",
  "in-progress": "In progress",
  completed: "Completed",
};

const statusVariant: Record<string, "secondary" | "default" | "outline"> = {
  "not-started": "outline",
  "in-progress": "default",
  completed: "secondary",
};

const THUMBNAIL_ROTATION = [
  "bg-gradient-to-br from-blue-500 to-indigo-600",
  "bg-gradient-to-br from-emerald-500 to-teal-600",
  "bg-gradient-to-br from-violet-500 to-purple-600",
  "bg-gradient-to-br from-rose-500 to-orange-500",
  "bg-gradient-to-br from-amber-500 to-yellow-500",
];

function autoThumbnailFor(courseId: string): string {
  let hash = 0;
  for (const char of courseId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return THUMBNAIL_ROTATION[hash % THUMBNAIL_ROTATION.length];
}

interface RenderableCourse {
  id: string;
  title: string;
  department: string;
  thumbnail: string;
  compliance: boolean;
  dueDate: string | null;
  status: "not-started" | "in-progress" | "completed";
  progress: number;
  moduleCount: number;
}

export default async function CoursesPage() {
  const mockActive = courses.filter((c) => c.status !== "completed");
  const mockFinished = courses.filter((c) => c.status === "completed");

  let realCourses: RenderableCourse[] = [];
  try {
    const session = await auth();
    const userId = session?.user?.email;
    if (userId) {
      const published: RealCourseSummary[] = await listPublishedCourses();
      realCourses = await Promise.all(
        published.map(async (course) => {
          const { status, progress } = await getCourseProgressForLearner(course.id, userId);
          return {
            id: course.id,
            title: course.title,
            department: course.department ?? "General",
            thumbnail: course.thumbnail ?? autoThumbnailFor(course.id),
            compliance: course.compliance,
            dueDate: course.dueDate,
            status,
            progress,
            moduleCount: course.moduleCount,
          };
        })
      );
    }
  } catch {
    // Real courses are additive; if the DB is unreachable, still render the mock sections.
  }

  const realActive = realCourses.filter((c) => c.status !== "completed");
  const realFinished = realCourses.filter((c) => c.status === "completed");
  const active: Array<(typeof courses)[number] | RenderableCourse> = [...mockActive, ...realActive];
  const finished: Array<(typeof courses)[number] | RenderableCourse> = [
    ...mockFinished,
    ...realFinished,
  ];

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">My Courses</h1>
        <p className="text-sm text-muted-foreground">
          {active.length} in progress &middot; {finished.length} finished
        </p>
      </div>

      <div>
        <h2 className="mb-4 text-lg font-medium">Active</h2>
        {active.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing in progress right now — nice work staying caught up.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {active.map((course) => (
              <Link key={course.id} href={`/courses/${course.id}`}>
                <Card className="h-full transition-shadow hover:shadow-md">
                  <div className={`h-24 rounded-t-xl ${course.thumbnail}`} />
                  <CardHeader>
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-base leading-snug">{course.title}</CardTitle>
                      {course.compliance && (
                        <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-600" />
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">{course.department}</p>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-3">
                    {"description" in course && (
                      <p className="line-clamp-2 text-sm text-muted-foreground">
                        {course.description}
                      </p>
                    )}
                    <div className="flex items-center justify-between">
                      <Badge variant={statusVariant[course.status]}>
                        {statusLabel[course.status]}
                      </Badge>
                      {course.dueDate && (
                        <span className="text-xs text-muted-foreground">
                          Due {course.dueDate.slice(0, 10)}
                        </span>
                      )}
                    </div>
                    <Progress value={course.progress} />
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>

      <div>
        <h2 className="mb-4 text-lg font-medium">Finished</h2>
        {finished.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing completed yet.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {finished.map((course) => (
              <Link key={course.id} href={`/courses/${course.id}`}>
                <Card className="transition-shadow hover:shadow-md">
                  <CardContent className="flex items-center gap-4 py-4">
                    <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
                    <div className="flex-1">
                      <p className="text-sm font-medium">{course.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {course.department} &middot;{" "}
                        {"modules" in course ? course.modules.length : course.moduleCount} modules
                      </p>
                    </div>
                    {course.compliance && <Badge variant="secondary">Compliance</Badge>}
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

Note: the mock `Course` type and the new `RenderableCourse` type both have `id`/`title`/`department`/`thumbnail`/`compliance`/`dueDate`/`status`/`progress` fields with matching names and compatible types (mock's `dueDate` is a plain date string, real's is an ISO string — both render correctly through `.slice(0, 10)`; mock dates like `"2026-09-15"` already slice to themselves harmlessly). The `"description" in course` / `"modules" in course` checks distinguish mock courses (which have those fields) from real ones (which don't) purely for conditional rendering, without needing a discriminated union.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Run the full suite**

Run: `npx vitest run`
Expected: all tests pass (this task touches no tested code paths directly).

- [ ] **Step 4: Manually verify**

1. `npm run dev` (local dev, port 3001), sign in.
2. Publish a course via the builder (Task 6/7) with at least one module.
3. Visit `/courses` — confirm the published course now appears in the "Active" section (assuming not yet completed), styled identically to a mock course card (thumbnail, department, compliance shield if set, due date if set, progress bar), with NO separate "Live Courses" section anywhere on the page.
4. Complete every module in that course (interact with its SCORM content to completion, or use the video placeholder — video modules have no real completion tracking yet, so a course containing only video placeholders will never reach "completed"; use a course with at least one SCORM module for this check).
5. Reload `/courses` — confirm the course now appears in "Finished" instead.
6. Leave a course in Draft (don't publish it) — confirm it does NOT appear anywhere on `/courses`.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/courses/page.tsx"
git commit -m "feat: fold published real courses into the learner course list"
```

---

### Task 9: Learner course detail — full template parity and access gate

**Files:**
- Modify: `app/(app)/courses/[id]/page.tsx`

**Interfaces:**
- Consumes: `getRealCourseDetail(courseId)` from `lib/db/queries.ts` (Task 2, now `status = "published"`-filtered); `getLatestLessonStatus(moduleVersionId, userId)` from `lib/scorm/completion-status.ts` (already exists); `auth()` from `@/auth`.

- [ ] **Step 1: Modify the page**

Replace the real-course branch in `app/(app)/courses/[id]/page.tsx` (everything from `if (!course) {` through its matching closing `}`):

```tsx
  if (!course) {
    const realCourse = await getRealCourseDetail(id);
    if (!realCourse) {
      notFound();
    }

    const session = await auth();
    const userId = session?.user?.email;

    const modulesWithStatus = await Promise.all(
      realCourse.modules.map(async (module) => {
        const lessonStatus = userId
          ? await getLatestLessonStatus(module.moduleVersionId, userId)
          : null;
        return { ...module, done: lessonStatus === "completed" || lessonStatus === "passed" };
      })
    );
    const completedCount = modulesWithStatus.filter((m) => m.done).length;
    const progress =
      modulesWithStatus.length === 0
        ? 0
        : Math.round((completedCount / modulesWithStatus.length) * 100);

    return (
      <div className="mx-auto flex max-w-4xl flex-col gap-6">
        <div>
          <Link href="/courses" className="text-sm text-muted-foreground hover:underline">
            &larr; Back to Courses
          </Link>
          <div className={`mt-4 h-32 rounded-xl ${realCourse.thumbnail ?? "bg-gradient-to-br from-blue-500 to-indigo-600"}`} />
          <div className="mt-4 flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">{realCourse.title}</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {realCourse.department ?? "General"}
                {realCourse.dueDate && ` · Due ${realCourse.dueDate.slice(0, 10)}`}
              </p>
            </div>
            {realCourse.compliance && <Badge variant="secondary">Compliance required</Badge>}
          </div>
          <div className="mt-4 flex items-center gap-3">
            <Progress value={progress} className="flex-1" />
            <span className="text-sm font-medium">{progress}%</span>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Modules</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col divide-y">
            {modulesWithStatus.length === 0 ? (
              <p className="py-3 text-sm text-muted-foreground">
                This course has no published modules yet.
              </p>
            ) : (
              modulesWithStatus.map((module) => (
                <div
                  key={module.id}
                  className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
                >
                  {module.done ? (
                    <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
                  ) : (
                    <Circle className="h-5 w-5 shrink-0 text-muted-foreground" />
                  )}
                  <div className="flex-1">
                    <p className="text-sm font-medium">{module.title}</p>
                  </div>
                  <Link href={`/courses/${realCourse.id}/scorm/${module.moduleVersionId}`}>
                    <Button variant={module.done ? "outline" : "default"} size="sm">
                      {module.done ? "Review" : "Start"}
                    </Button>
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

Add the two new imports at the top of the file, alongside the existing ones:

```tsx
import { getLatestLessonStatus } from "@/lib/scorm/completion-status";
import { auth } from "@/auth";
```

The rest of the file (the mock-course rendering path below this block) is completely unchanged.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Run the full suite**

Run: `npx vitest run`
Expected: all tests pass.

- [ ] **Step 4: Manually verify**

1. `npm run dev` (local dev, port 3001), sign in.
2. Visit a published real course's detail page (via `/courses` from Task 8) — confirm it now shows a thumbnail band, department, due date (if set), compliance badge (if set), and an overall progress bar, matching the mock course detail page's layout exactly.
3. Confirm each module row shows a checkmark if already completed by you, or an outline circle otherwise, and the button reads "Review" vs "Start" accordingly.
4. Attempt to visit a draft course's URL directly (copy its id from `/admin/content`, visit `/courses/<that-id>`) — confirm it 404s, identically to a nonexistent course id.
5. Confirm the existing mock courses (e.g. "Anti-Money Laundering Fundamentals") still render exactly as before — unaffected by this change.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/courses/[id]/page.tsx"
git commit -m "feat: give real courses full detail-page parity with mock courses, gate drafts from learners"
```

---

## Self-Review Notes

- **Spec coverage:** Section 1 (data model) → Task 1. Section 2 (builder UI) → Tasks 3, 4, 6. Section 3 (SCORM upload attach mode) → Task 5. Section 4 (reordering) → Tasks 3, 4, 6. Section 5 (learner-facing rendering + access gate) → Tasks 2, 8, 9. The Content Authoring page wiring called out in the spec's self-review addendum → Task 7.
- **Placeholder scan:** no TBD/TODO; every step has complete, real code or concrete numbered manual-verification instructions.
- **Type consistency:** `RealCourseSummary` (Task 2) fields match exactly what Task 7's `/api/admin/courses/list` route and Task 8's learner page consume. `RealCourseDetail` (Task 2) fields match Task 9's consumption. `CourseForBuilder`/`BuilderModule` (Task 2) match exactly what Task 6's `builder-client.tsx` renders and mutates. `CourseDetailsUpdate` (Task 3) fields match what Task 4's `PATCH` route accepts and what Task 6's `patchDetails` calls send. `CourseProgress` (Task 2) fields (`status`, `progress`) match exactly what Task 8 destructures from `getCourseProgressForLearner`.
