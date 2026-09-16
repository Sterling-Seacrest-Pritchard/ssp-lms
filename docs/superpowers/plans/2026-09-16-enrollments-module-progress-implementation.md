# Enrollments & Module Progress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace live-recomputed course/module completion with persisted per-learner state (`enrollments`, `module_progress`), and gate the learner `/courses` list to only courses the person is actually enrolled in.

**Architecture:** Two new tables (`enrollments`, `module_progress`) sit between the existing audit-only `course_assignments` table and the existing raw `module_attempts`/`scorm_attempt_state`/`video_attempt_state` tables. Writes happen at commit time (SCORM/video commit routes upsert `module_progress` and roll the parent `enrollments.status` up); reads become simple lookups instead of live recomputation. `module_attempts.user_id` migrates from a raw email string to a real `users.id` UUID FK, done via a two-step migration (add+backfill, then drop+rename+constrain) matching the precedent already used for `courses.department` → `courses.department_id`.

**Tech Stack:** Next.js 16 (App Router), Drizzle ORM (`drizzle-orm/node-postgres`), Postgres (Cloud SQL), Vitest.

**Spec:** `docs/superpowers/specs/2026-09-15-enrollments-module-progress-design.md` (vault copy: `Output/SSP LMS — Enrollments & Module Progress Design 2026-09-15.md`)

## Global Constraints

- No CHECK constraints anywhere in this schema today (`courses.status`, `moduleVersions.status`, `moduleAttempts.status` are all plain `text().notNull().default(...)`) — `enrollments.status`/`source` and `module_progress.status` follow the same convention: plain text columns, app-level validation only, not SQL CHECK constraints. The spec's `check(...)` notation is shorthand for the allowed value set, not literal SQL.
- No explicit FK indexes beyond what a PK/unique constraint creates — matches the existing schema-wide gap (`Roadmap.md` follow-up, not fixed here).
- Every schema-altering migration must be run against production Cloud SQL via a one-off `pg` `Client` script (`drizzle-kit migrate` hangs indefinitely on this connection string — `sslmode=require&uselibpqcompat=true`), as the `postgres` superuser, split on `--> statement-breakpoint`, wrapped in `BEGIN`/`COMMIT`/`ROLLBACK`. After each migration, run `GRANT ALL PRIVILEGES ON <new_table> TO ssp_lms_app;` for any brand-new table (existing tables' grants already cover new columns). **Running any of these against production requires the user's explicit go-ahead each time** — do not run them unprompted, per this session's established pattern.
- `session.user.email` is the identity used everywhere in the request layer today (`auth()` → `session.user.email`). `users.id` (UUID) is the identity `enrollments`/`module_progress` are keyed on. Every read/write path that touches the new tables needs an email → `users.id` lookup; `module_attempts` stays email-keyed until Task 9/10 migrate it separately.
- Course detail/launch pages (`/courses/[id]`, SCORM/video launch routes) are **not** gated by enrollment in this pass — only the `/courses` list view. This matches the spec's literal scope (it only describes changing the list query); a signed-in learner who guesses a published course's URL can still reach its detail/launch page. This is a known, carried-over limitation, not a new one introduced here — flag it, don't silently expand scope to fix it.
- The admin SCORM test tool (`/admin/scorm-test/[moduleVersionId]`) launches modules for an admin who is never enrolled in the course being tested. `module_progress`/`enrollments` writes must degrade gracefully (skip + log) when no enrollment exists for the committing user's `(userId, courseId)` pair, rather than throwing — this keeps that admin tool working unmodified.

---

## File Structure

- **Modify** `lib/db/schema.ts` — add `enrollments`, `moduleProgress` tables; later (Task 10) change `moduleAttempts.userId` from `text` to `uuid` FK.
- **Create** `drizzle/migrations/0010_enrollments_module_progress.sql` — new tables.
- **Modify** `lib/db/users.ts` — add `getUserIdByEmail`.
- **Create** `lib/db/enrollments.ts` — `ensureEnrollment`, `getEnrollmentId`.
- **Modify** `lib/db/course-assignments.ts` — `assignCourse` wraps its insert + `ensureEnrollment` in one transaction.
- **Create** `lib/db/module-progress.ts` — `recordModuleCompletion` (upsert + conditional rollup).
- **Modify** `app/api/scorm/commit/route.ts`, `app/api/video/commit/route.ts` — call `recordModuleCompletion` after the existing attempt-state write.
- **Modify** `lib/scorm/course-progress.ts` — rename existing live-recompute logic to `computeLiveCourseProgress` (kept, used only by the Task 11 backfill script); add new `getCourseProgressForLearner` reading `enrollments`/`module_progress`.
- **Modify** `lib/db/queries.ts` — add `listEnrolledPublishedCourses(userId)`.
- **Modify** `app/(app)/courses/page.tsx` — use `listEnrolledPublishedCourses` instead of `listPublishedCourses` for the real-course section (mock section untouched).
- **Create** `drizzle/migrations/0011_module_attempts_user_id_uuid_add.sql`, `drizzle/migrations/0012_module_attempts_user_id_uuid_finish.sql` — two-step `module_attempts.user_id` migration.
- **Create** `scripts/verify-module-attempts-email-match.js` — dry-run verification query (Task 9, run before writing migration 0011's backfill for real).
- **Modify** `app/api/scorm/attempts/route.ts`, `app/api/video/attempts/route.ts`, `app/api/scorm/commit/route.ts`, `app/api/video/commit/route.ts`, `lib/scorm/completion-status.ts`, `lib/video/completion-status.ts` — swap `session.user.email` for the resolved `users.id` UUID once migration 0012 lands (Task 10).
- **Create** `scripts/backfill-enrollments-from-assignments.js`, `scripts/backfill-enrollments-from-attempts.js` — idempotent, dry-run-capable backfills (Task 11).

---

## Task 1: Schema — `enrollments` and `module_progress` tables

**Files:**
- Modify: `lib/db/schema.ts`
- Create: `drizzle/migrations/0010_enrollments_module_progress.sql`
- Test: `lib/db/schema.test.ts`

**Interfaces:**
- Produces: `enrollments` table (`id`, `userId`, `courseId`, `status`, `source`, `enrolledAt`, `dueAt`, `completedAt`, `cycleMonths`, `validUntil`), `moduleProgress` table (`id`, `enrollmentId`, `moduleId`, `status`, `bestScore`, `latestAttemptId`), both exported from `lib/db/schema.ts` for every later task to import.

- [ ] **Step 1: Write the failing schema test**

Add to `lib/db/schema.test.ts` (create the file if it doesn't already cover this — check first; if it exists, add these as new `it()` blocks in a `describe("enrollments")` / `describe("moduleProgress")`):

```ts
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "./client";
import { courses, enrollments, moduleProgress, modules, moduleVersions, users } from "./schema";

describe("enrollments", () => {
  it("enforces one enrollment per (user, course) pair", async () => {
    const [user] = await db
      .insert(users)
      .values({ email: `enroll-test-${randomUUID()}@example.com`, displayName: "Enroll Test" })
      .returning();
    const [course] = await db
      .insert(courses)
      .values({ code: `ENROLL-${randomUUID()}`, title: "Enroll Test Course" })
      .returning();
    try {
      await db.insert(enrollments).values({ userId: user.id, courseId: course.id });
      await expect(db.insert(enrollments).values({ userId: user.id, courseId: course.id })).rejects.toThrow();
    } finally {
      await db.delete(enrollments).where(eq(enrollments.userId, user.id));
      await db.delete(courses).where(eq(courses.id, course.id));
      await db.delete(users).where(eq(users.id, user.id));
    }
  });

  it("defaults status to not_started and source to assigned", async () => {
    const [user] = await db
      .insert(users)
      .values({ email: `enroll-default-${randomUUID()}@example.com`, displayName: "Enroll Default" })
      .returning();
    const [course] = await db
      .insert(courses)
      .values({ code: `ENROLL-DEFAULT-${randomUUID()}`, title: "Enroll Default Course" })
      .returning();
    try {
      const [row] = await db.insert(enrollments).values({ userId: user.id, courseId: course.id }).returning();
      expect(row.status).toBe("not_started");
      expect(row.source).toBe("assigned");
    } finally {
      await db.delete(enrollments).where(eq(enrollments.userId, user.id));
      await db.delete(courses).where(eq(courses.id, course.id));
      await db.delete(users).where(eq(users.id, user.id));
    }
  });
});

describe("moduleProgress", () => {
  it("enforces one progress row per (enrollment, module) pair", async () => {
    const [user] = await db
      .insert(users)
      .values({ email: `progress-test-${randomUUID()}@example.com`, displayName: "Progress Test" })
      .returning();
    const [course] = await db
      .insert(courses)
      .values({ code: `PROGRESS-${randomUUID()}`, title: "Progress Test Course" })
      .returning();
    const [mod] = await db
      .insert(modules)
      .values({ courseId: course.id, moduleType: "scorm", title: "Module 1" })
      .returning();
    const [enrollment] = await db.insert(enrollments).values({ userId: user.id, courseId: course.id }).returning();
    try {
      await db.insert(moduleProgress).values({ enrollmentId: enrollment.id, moduleId: mod.id });
      await expect(
        db.insert(moduleProgress).values({ enrollmentId: enrollment.id, moduleId: mod.id })
      ).rejects.toThrow();
    } finally {
      await db.delete(moduleProgress).where(eq(moduleProgress.enrollmentId, enrollment.id));
      await db.delete(enrollments).where(eq(enrollments.id, enrollment.id));
      await db.delete(modules).where(eq(modules.id, mod.id));
      await db.delete(courses).where(eq(courses.id, course.id));
      await db.delete(users).where(eq(users.id, user.id));
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/db/schema.test.ts`
Expected: FAIL — `enrollments`/`moduleProgress` don't exist yet (import error or undefined table).

- [ ] **Step 3: Add the tables to the schema**

In `lib/db/schema.ts`, add after `courseAssignments`:

```ts
export const enrollments = pgTable(
  "enrollments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id),
    courseId: uuid("course_id").notNull().references(() => courses.id),
    // Plain text, app-validated - not not_started/in_progress/completed/failed/expired
    // and self/assigned/auto enforced by the DB. See Global Constraints.
    status: text("status").notNull().default("not_started"),
    source: text("source").notNull().default("assigned"),
    enrolledAt: timestamp("enrolled_at", { withTimezone: true }).notNull().defaultNow(),
    // Copied from courses.dueDate at enrollment time, not a live reference -
    // a later change to the course's due date shouldn't retroactively move
    // an already-enrolled learner's deadline.
    dueAt: timestamp("due_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    // Reserved for v2 auto-reenroll; unused this pass (see spec Decisions).
    cycleMonths: integer("cycle_months"),
    validUntil: timestamp("valid_until", { withTimezone: true }),
  },
  (table) => [unique().on(table.userId, table.courseId)]
);

export const moduleProgress = pgTable(
  "module_progress",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    enrollmentId: uuid("enrollment_id").notNull().references(() => enrollments.id),
    moduleId: uuid("module_id").notNull().references(() => modules.id),
    // not_attempted/incomplete/completed/passed/failed - see Global Constraints.
    status: text("status").notNull().default("not_attempted"),
    bestScore: integer("best_score"),
    latestAttemptId: uuid("latest_attempt_id").references(() => moduleAttempts.id),
  },
  (table) => [unique().on(table.enrollmentId, table.moduleId)]
);
```

Note: `bestScore` is declared `integer` here (matches this schema's existing numeric columns, e.g. `durationSeconds`) rather than the spec's `numeric` — nothing in this pass writes a fractional score, and using `integer` avoids introducing Drizzle's `numeric` string-return-type handling for an unused column. Revisit if/when the quiz sub-project needs fractional scoring.

- [ ] **Step 4: Generate the migration scaffold**

Run: `npx dotenv -e .env.local -- drizzle-kit generate --custom --name enrollments_module_progress`

This creates an empty, correctly-numbered `drizzle/migrations/0010_enrollments_module_progress.sql` (per this repo's established pattern — `drizzle-kit migrate` hangs on this connection, so migrations are hand-written, not generated by diffing).

- [ ] **Step 5: Write the migration SQL**

`drizzle/migrations/0010_enrollments_module_progress.sql`:

```sql
CREATE TABLE "enrollments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"status" text DEFAULT 'not_started' NOT NULL,
	"source" text DEFAULT 'assigned' NOT NULL,
	"enrolled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"due_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cycle_months" integer,
	"valid_until" timestamp with time zone,
	CONSTRAINT "enrollments_user_id_course_id_unique" UNIQUE("user_id","course_id")
);
--> statement-breakpoint
CREATE TABLE "module_progress" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"module_id" uuid NOT NULL,
	"status" text DEFAULT 'not_attempted' NOT NULL,
	"best_score" integer,
	"latest_attempt_id" uuid,
	CONSTRAINT "module_progress_enrollment_id_module_id_unique" UNIQUE("enrollment_id","module_id")
);
--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "module_progress" ADD CONSTRAINT "module_progress_enrollment_id_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "module_progress" ADD CONSTRAINT "module_progress_module_id_modules_id_fk" FOREIGN KEY ("module_id") REFERENCES "modules"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "module_progress" ADD CONSTRAINT "module_progress_latest_attempt_id_module_attempts_id_fk" FOREIGN KEY ("latest_attempt_id") REFERENCES "module_attempts"("id") ON DELETE no action ON UPDATE no action;
```

- [ ] **Step 6: Apply the migration to production Cloud SQL**

Ask the user to confirm before running. Write a one-off script (same pattern as prior migrations) to a scratch location outside git tracking, connect as `postgres`, split on `--> statement-breakpoint`, run in a transaction. After it succeeds, run:

```sql
GRANT ALL PRIVILEGES ON enrollments TO ssp_lms_app;
GRANT ALL PRIVILEGES ON module_progress TO ssp_lms_app;
```

Delete the scratch script once done.

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run lib/db/schema.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add lib/db/schema.ts drizzle/migrations/0010_enrollments_module_progress.sql drizzle/migrations/meta lib/db/schema.test.ts
git commit -m "feat: add enrollments and module_progress tables"
```

---

## Task 2: `getUserIdByEmail` helper

**Files:**
- Modify: `lib/db/users.ts`
- Test: `lib/db/users.test.ts`

**Interfaces:**
- Consumes: `users` table from `lib/db/schema.ts` (Task 1, unchanged shape).
- Produces: `getUserIdByEmail(email: string): Promise<string | null>` — used by Tasks 3, 5, 7, 8.

- [ ] **Step 1: Write the failing test**

Add to `lib/db/users.test.ts`:

```ts
import { getUserIdByEmail } from "./users";

describe("getUserIdByEmail", () => {
  it("returns the user's id for a known email", async () => {
    const email = `lookup-${randomUUID()}@example.com`;
    const [user] = await db.insert(users).values({ email, displayName: "Lookup Test" }).returning();
    try {
      expect(await getUserIdByEmail(email)).toBe(user.id);
    } finally {
      await db.delete(users).where(eq(users.id, user.id));
    }
  });

  it("returns null for an unknown email", async () => {
    expect(await getUserIdByEmail(`unknown-${randomUUID()}@example.com`)).toBeNull();
  });
});
```

(`randomUUID`, `eq`, `db`, `users` are already imported at the top of this file per its existing tests.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/db/users.test.ts`
Expected: FAIL — `getUserIdByEmail` is not exported.

- [ ] **Step 3: Implement it**

Add to `lib/db/users.ts`:

```ts
export async function getUserIdByEmail(email: string): Promise<string | null> {
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  return row?.id ?? null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/db/users.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/db/users.ts lib/db/users.test.ts
git commit -m "feat: add getUserIdByEmail lookup helper"
```

---

## Task 3: `lib/db/enrollments.ts` — `ensureEnrollment` and `getEnrollmentId`

**Files:**
- Create: `lib/db/enrollments.ts`
- Test: `lib/db/enrollments.test.ts`

**Interfaces:**
- Consumes: `enrollments`, `courses` from `lib/db/schema.ts` (Task 1); a Drizzle transaction handle (`tx`), typed loosely as `Pick<typeof db, "select" | "insert">` since that's the only surface this function uses.
- Produces: `ensureEnrollment(tx, params: { userId: string; courseId: string }): Promise<void>` (Task 4 consumes this), `getEnrollmentId(userId: string, courseId: string): Promise<string | null>` (Task 5 and Task 7/8 consume this).

- [ ] **Step 1: Write the failing test**

`lib/db/enrollments.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { ensureEnrollment, getEnrollmentId } from "./enrollments";
import { db } from "./client";
import { courses, enrollments, users } from "./schema";

async function seedUserAndCourse(dueDate: Date | null = null) {
  const [user] = await db
    .insert(users)
    .values({ email: `enrollment-fn-${randomUUID()}@example.com`, displayName: "Enrollment Fn Test" })
    .returning();
  const [course] = await db
    .insert(courses)
    .values({ code: `ENROLLFN-${randomUUID()}`, title: "Enrollment Fn Course", dueDate })
    .returning();
  return { user, course };
}

describe("ensureEnrollment", () => {
  it("creates a not_started enrollment, copying the course's due date", async () => {
    const dueDate = new Date("2027-01-01T00:00:00Z");
    const { user, course } = await seedUserAndCourse(dueDate);
    try {
      await db.transaction(async (tx) => {
        await ensureEnrollment(tx, { userId: user.id, courseId: course.id });
      });
      const [row] = await db
        .select()
        .from(enrollments)
        .where(eq(enrollments.userId, user.id));
      expect(row.status).toBe("not_started");
      expect(row.dueAt?.toISOString()).toBe(dueDate.toISOString());
    } finally {
      await db.delete(enrollments).where(eq(enrollments.userId, user.id));
      await db.delete(courses).where(eq(courses.id, course.id));
      await db.delete(users).where(eq(users.id, user.id));
    }
  });

  it("is a no-op if an enrollment already exists (doesn't reset progress)", async () => {
    const { user, course } = await seedUserAndCourse();
    try {
      await db.transaction(async (tx) => {
        await ensureEnrollment(tx, { userId: user.id, courseId: course.id });
      });
      await db
        .update(enrollments)
        .set({ status: "completed" })
        .where(eq(enrollments.userId, user.id));

      await db.transaction(async (tx) => {
        await ensureEnrollment(tx, { userId: user.id, courseId: course.id });
      });

      const rows = await db.select().from(enrollments).where(eq(enrollments.userId, user.id));
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe("completed");
    } finally {
      await db.delete(enrollments).where(eq(enrollments.userId, user.id));
      await db.delete(courses).where(eq(courses.id, course.id));
      await db.delete(users).where(eq(users.id, user.id));
    }
  });
});

describe("getEnrollmentId", () => {
  it("returns the enrollment id for an enrolled (user, course) pair", async () => {
    const { user, course } = await seedUserAndCourse();
    try {
      const [enrollment] = await db
        .insert(enrollments)
        .values({ userId: user.id, courseId: course.id })
        .returning();
      expect(await getEnrollmentId(user.id, course.id)).toBe(enrollment.id);
    } finally {
      await db.delete(enrollments).where(eq(enrollments.userId, user.id));
      await db.delete(courses).where(eq(courses.id, course.id));
      await db.delete(users).where(eq(users.id, user.id));
    }
  });

  it("returns null when no enrollment exists", async () => {
    const { user, course } = await seedUserAndCourse();
    try {
      expect(await getEnrollmentId(user.id, course.id)).toBeNull();
    } finally {
      await db.delete(courses).where(eq(courses.id, course.id));
      await db.delete(users).where(eq(users.id, user.id));
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/db/enrollments.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement it**

`lib/db/enrollments.ts`:

```ts
import { and, eq } from "drizzle-orm";
import { db } from "./client";
import { courses, enrollments } from "./schema";

/**
 * Called inside the same transaction as a course_assignments insert
 * (lib/db/course-assignments.ts assignCourse) - not exported for standalone
 * use outside a transaction, since it's meant to be atomic with the
 * assignment record.
 */
export async function ensureEnrollment(
  tx: Pick<typeof db, "select" | "insert">,
  params: { userId: string; courseId: string }
): Promise<void> {
  const existing = await tx
    .select({ id: enrollments.id })
    .from(enrollments)
    .where(and(eq(enrollments.userId, params.userId), eq(enrollments.courseId, params.courseId)));
  if (existing.length > 0) return;

  const [course] = await tx.select({ dueDate: courses.dueDate }).from(courses).where(eq(courses.id, params.courseId));

  await tx.insert(enrollments).values({
    userId: params.userId,
    courseId: params.courseId,
    dueAt: course?.dueDate ?? null,
  });
}

export async function getEnrollmentId(userId: string, courseId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: enrollments.id })
    .from(enrollments)
    .where(and(eq(enrollments.userId, userId), eq(enrollments.courseId, courseId)));
  return row?.id ?? null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/db/enrollments.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/db/enrollments.ts lib/db/enrollments.test.ts
git commit -m "feat: add ensureEnrollment and getEnrollmentId"
```

---

## Task 4: `assignCourse` creates the enrollment transactionally

**Files:**
- Modify: `lib/db/course-assignments.ts`
- Test: `lib/db/course-assignments.test.ts`

**Interfaces:**
- Consumes: `ensureEnrollment` from `lib/db/enrollments.ts` (Task 3).
- Produces: `assignCourse` keeps its existing signature (`courseId, userId, assignedBy`) and `DuplicateAssignmentError` behavior — no caller changes needed.

- [ ] **Step 1: Write the failing test**

Add to `lib/db/course-assignments.test.ts` (add `enrollments` to the existing `./schema` import alongside `courses, users, courseAssignments`):

```ts
it("creates a not_started enrollment in the same transaction as the assignment", async () => {
  const user = await seedUser(randomUUID());
  const course = await seedCourse();
  try {
    await assignCourse(course.id, user.id, "admin@example.com");

    const [enrollment] = await db
      .select()
      .from(enrollments)
      .where(and(eq(enrollments.userId, user.id), eq(enrollments.courseId, course.id)));
    expect(enrollment).toBeDefined();
    expect(enrollment.status).toBe("not_started");
  } finally {
    await db.delete(enrollments).where(eq(enrollments.userId, user.id));
    await db.delete(courseAssignments).where(eq(courseAssignments.userId, user.id));
    await db.delete(courses).where(eq(courses.id, course.id));
    await db.delete(users).where(eq(users.id, user.id));
  }
});

it("unassigning a course does NOT delete the enrollment or reset its progress", async () => {
  const user = await seedUser(randomUUID());
  const course = await seedCourse();
  try {
    await assignCourse(course.id, user.id, "admin@example.com");
    await db.update(enrollments).set({ status: "in_progress" }).where(eq(enrollments.userId, user.id));

    await unassignCourse(course.id, user.id);

    const [enrollment] = await db
      .select()
      .from(enrollments)
      .where(and(eq(enrollments.userId, user.id), eq(enrollments.courseId, course.id)));
    expect(enrollment).toBeDefined();
    expect(enrollment.status).toBe("in_progress");
  } finally {
    await db.delete(enrollments).where(eq(enrollments.userId, user.id));
    await db.delete(courseAssignments).where(eq(courseAssignments.userId, user.id));
    await db.delete(courses).where(eq(courses.id, course.id));
    await db.delete(users).where(eq(users.id, user.id));
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/db/course-assignments.test.ts`
Expected: FAIL — no `enrollments` row gets created by `assignCourse` yet.

- [ ] **Step 3: Wrap the insert in a transaction**

In `lib/db/course-assignments.ts`, update the imports and `assignCourse`:

```ts
import { db } from "./client";
import { courseAssignments, courses, enrollments, users } from "./schema";
import { ensureEnrollment } from "./enrollments";
import { isUuid } from "@/lib/api/errors";

// ... (unchanged code above assignCourse)

export async function assignCourse(
  courseId: string,
  userId: string,
  assignedBy: string | null
): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await tx.insert(courseAssignments).values({ courseId, userId, assignedBy });
      await ensureEnrollment(tx, { userId, courseId });
    });
  } catch (error) {
    const pgCode = (error as { cause?: { code?: string } })?.cause?.code;
    if (pgCode === "23505") {
      throw new DuplicateAssignmentError("This course is already assigned to this user");
    }
    throw error;
  }
}
```

`unassignCourse` is unchanged — the new test above is a regression test confirming the spec's "unassign doesn't delete enrollment" decision, not a code change.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/db/course-assignments.test.ts`
Expected: PASS (all tests in the file, including the pre-existing duplicate-assignment test — the transaction wrap must not change `DuplicateAssignmentError` behavior).

- [ ] **Step 5: Commit**

```bash
git add lib/db/course-assignments.ts lib/db/course-assignments.test.ts
git commit -m "feat: create enrollment transactionally when a course is assigned"
```

---

## Task 5: `lib/db/module-progress.ts` — `recordModuleCompletion`

**Files:**
- Create: `lib/db/module-progress.ts`
- Test: `lib/db/module-progress.test.ts`

**Interfaces:**
- Consumes: `getUserIdByEmail` (Task 2), `getEnrollmentId` (Task 3), `getTrackedModuleVersionIds` (existing, from `lib/scorm/course-progress.ts`), `getLatestLessonStatus` (existing, `lib/scorm/completion-status.ts`), `getLatestVideoStatus` (existing, `lib/video/completion-status.ts`).
- Produces: `recordModuleCompletion(params: { userEmail: string; moduleVersionId: string }): Promise<void>` — Task 6 calls this from both commit routes.

- [ ] **Step 1: Write the failing test**

`lib/db/module-progress.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { recordModuleCompletion } from "./module-progress";
import { db } from "./client";
import {
  courses,
  enrollments,
  moduleAttempts,
  moduleProgress,
  modules,
  moduleVersions,
  scormAttemptState,
  users,
} from "./schema";

async function seedScormModuleWithAttempt(lessonStatus: string) {
  const [user] = await db
    .insert(users)
    .values({ email: `progress-${randomUUID()}@example.com`, displayName: "Progress Test" })
    .returning();
  const [course] = await db
    .insert(courses)
    .values({ code: `MODPROG-${randomUUID()}`, title: "Module Progress Course" })
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
  const [enrollment] = await db.insert(enrollments).values({ userId: user.id, courseId: course.id }).returning();
  const [attempt] = await db
    .insert(moduleAttempts)
    .values({ moduleVersionId: version.id, userId: user.email, attemptNumber: 1 })
    .returning();
  await db.insert(scormAttemptState).values({ moduleAttemptId: attempt.id, lessonStatus, rawCmi: {} });
  return { user, course, mod, version, enrollment, attempt };
}

describe("recordModuleCompletion", () => {
  it("upserts module_progress as completed and rolls the enrollment up to completed for a single-module course", async () => {
    const { user, course, mod, version, enrollment, attempt } = await seedScormModuleWithAttempt("completed");
    try {
      await recordModuleCompletion({ userEmail: user.email, moduleVersionId: version.id });

      const [progress] = await db
        .select()
        .from(moduleProgress)
        .where(and(eq(moduleProgress.enrollmentId, enrollment.id), eq(moduleProgress.moduleId, mod.id)));
      expect(progress.status).toBe("completed");

      const [updatedEnrollment] = await db.select().from(enrollments).where(eq(enrollments.id, enrollment.id));
      expect(updatedEnrollment.status).toBe("completed");
      expect(updatedEnrollment.completedAt).not.toBeNull();
    } finally {
      await db.delete(moduleProgress).where(eq(moduleProgress.enrollmentId, enrollment.id));
      await db.delete(scormAttemptState).where(eq(scormAttemptState.moduleAttemptId, attempt.id));
      await db.delete(moduleAttempts).where(eq(moduleAttempts.id, attempt.id));
      await db.delete(enrollments).where(eq(enrollments.id, enrollment.id));
      await db.update(modules).set({ currentVersionId: null }).where(eq(modules.id, mod.id));
      await db.delete(moduleVersions).where(eq(moduleVersions.id, version.id));
      await db.delete(modules).where(eq(modules.id, mod.id));
      await db.delete(courses).where(eq(courses.id, course.id));
      await db.delete(users).where(eq(users.id, user.id));
    }
  });

  it("marks the enrollment in_progress (not completed) when the module is only incomplete", async () => {
    const { user, course, mod, version, enrollment, attempt } = await seedScormModuleWithAttempt("incomplete");
    try {
      await recordModuleCompletion({ userEmail: user.email, moduleVersionId: version.id });

      const [updatedEnrollment] = await db.select().from(enrollments).where(eq(enrollments.id, enrollment.id));
      expect(updatedEnrollment.status).toBe("in_progress");
    } finally {
      await db.delete(moduleProgress).where(eq(moduleProgress.enrollmentId, enrollment.id));
      await db.delete(scormAttemptState).where(eq(scormAttemptState.moduleAttemptId, attempt.id));
      await db.delete(moduleAttempts).where(eq(moduleAttempts.id, attempt.id));
      await db.delete(enrollments).where(eq(enrollments.id, enrollment.id));
      await db.update(modules).set({ currentVersionId: null }).where(eq(modules.id, mod.id));
      await db.delete(moduleVersions).where(eq(moduleVersions.id, version.id));
      await db.delete(modules).where(eq(modules.id, mod.id));
      await db.delete(courses).where(eq(courses.id, course.id));
      await db.delete(users).where(eq(users.id, user.id));
    }
  });

  it("is a no-op (does not throw) when the committing user has no enrollment for this course - e.g. an admin using the SCORM test tool", async () => {
    const [user] = await db
      .insert(users)
      .values({ email: `no-enrollment-${randomUUID()}@example.com`, displayName: "No Enrollment Test" })
      .returning();
    const [course] = await db.insert(courses).values({ code: `NOENROLL-${randomUUID()}`, title: "No Enroll Course" }).returning();
    const [mod] = await db.insert(modules).values({ courseId: course.id, moduleType: "scorm", title: "Module 1" }).returning();
    const [version] = await db.insert(moduleVersions).values({ moduleId: mod.id, versionNumber: 1, status: "published" }).returning();
    await db.update(modules).set({ currentVersionId: version.id }).where(eq(modules.id, mod.id));
    const [attempt] = await db.insert(moduleAttempts).values({ moduleVersionId: version.id, userId: user.email, attemptNumber: 1 }).returning();
    await db.insert(scormAttemptState).values({ moduleAttemptId: attempt.id, lessonStatus: "completed", rawCmi: {} });

    try {
      await expect(recordModuleCompletion({ userEmail: user.email, moduleVersionId: version.id })).resolves.not.toThrow();
      const progressRows = await db.select().from(moduleProgress);
      expect(progressRows.find((p) => p.moduleId === mod.id)).toBeUndefined();
    } finally {
      await db.delete(scormAttemptState).where(eq(scormAttemptState.moduleAttemptId, attempt.id));
      await db.delete(moduleAttempts).where(eq(moduleAttempts.id, attempt.id));
      await db.update(modules).set({ currentVersionId: null }).where(eq(modules.id, mod.id));
      await db.delete(moduleVersions).where(eq(moduleVersions.id, version.id));
      await db.delete(modules).where(eq(modules.id, mod.id));
      await db.delete(courses).where(eq(courses.id, course.id));
      await db.delete(users).where(eq(users.id, user.id));
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/db/module-progress.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement it**

`lib/db/module-progress.ts`:

```ts
import { and, eq } from "drizzle-orm";
import { db } from "./client";
import { enrollments, modules, moduleProgress, moduleVersions } from "./schema";
import { getEnrollmentId } from "./enrollments";
import { getUserIdByEmail } from "./users";
import { getLatestLessonStatus } from "@/lib/scorm/completion-status";
import { getLatestVideoStatus } from "@/lib/video/completion-status";
import { getTrackedModuleVersionIds } from "@/lib/scorm/course-progress";

const FINISHED_LESSON_STATUSES = new Set(["completed", "passed"]);
const FINISHED_VIDEO_STATUSES = new Set(["completed"]);

/**
 * Called by both commit routes (app/api/scorm/commit, app/api/video/commit)
 * after they've written the raw scorm_attempt_state/video_attempt_state row.
 * Failures here must never surface as a failed commit response - a
 * progress-cache write failure is recoverable on the next commit, but a lost
 * attempt-state write is not (see spec Error Handling). Callers wrap this in
 * try/catch and log, not propagate.
 *
 * Deliberately a silent no-op (not an error) when the committing user has no
 * enrollment for this module's course - covers the admin SCORM test tool,
 * which launches modules for people who were never assigned/enrolled.
 */
export async function recordModuleCompletion(params: {
  userEmail: string;
  moduleVersionId: string;
}): Promise<void> {
  const userId = await getUserIdByEmail(params.userEmail);
  if (!userId) return;

  const [moduleRow] = await db
    .select({ moduleId: modules.id, courseId: modules.courseId, moduleType: modules.moduleType })
    .from(moduleVersions)
    .innerJoin(modules, eq(modules.id, moduleVersions.moduleId))
    .where(eq(moduleVersions.id, params.moduleVersionId));
  if (!moduleRow) return;

  const enrollmentId = await getEnrollmentId(userId, moduleRow.courseId);
  if (!enrollmentId) return;

  const finished = await isModuleFinished(moduleRow.moduleType, params.moduleVersionId, params.userEmail);

  const [existingProgress] = await db
    .select({ status: moduleProgress.status })
    .from(moduleProgress)
    .where(and(eq(moduleProgress.enrollmentId, enrollmentId), eq(moduleProgress.moduleId, moduleRow.moduleId)));

  const wasAlreadyFinished = existingProgress?.status === "completed";
  const newStatus = finished ? "completed" : "incomplete";

  if (!existingProgress) {
    await db.insert(moduleProgress).values({ enrollmentId, moduleId: moduleRow.moduleId, status: newStatus });
  } else if (existingProgress.status !== newStatus) {
    await db
      .update(moduleProgress)
      .set({ status: newStatus })
      .where(and(eq(moduleProgress.enrollmentId, enrollmentId), eq(moduleProgress.moduleId, moduleRow.moduleId)));
  }

  // Rolling the parent enrollment up is a course-wide query - only run it
  // when this commit could plausibly have changed the outcome (first time
  // this module reaches finished, or it just left finished), not on every
  // one of SCORM's frequent no-op commits.
  if (finished !== wasAlreadyFinished) {
    await recomputeEnrollmentStatus(enrollmentId, moduleRow.courseId);
  }
}

async function isModuleFinished(moduleType: string, moduleVersionId: string, userEmail: string): Promise<boolean> {
  if (moduleType === "video") {
    const status = await getLatestVideoStatus(moduleVersionId, userEmail);
    return status !== null && FINISHED_VIDEO_STATUSES.has(status);
  }
  const lessonStatus = await getLatestLessonStatus(moduleVersionId, userEmail);
  return lessonStatus !== null && FINISHED_LESSON_STATUSES.has(lessonStatus);
}

async function recomputeEnrollmentStatus(enrollmentId: string, courseId: string): Promise<void> {
  const courseModules = await db.select().from(modules).where(eq(modules.courseId, courseId));
  const trackable = courseModules.flatMap((m) =>
    m.currentVersionId ? [{ moduleType: m.moduleType, moduleVersionId: m.currentVersionId, moduleId: m.id }] : []
  );
  const trackedIds = await getTrackedModuleVersionIds(trackable);
  const trackedModuleIds = new Set(trackable.filter((m) => trackedIds.has(m.moduleVersionId)).map((m) => m.moduleId));
  if (trackedModuleIds.size === 0) return;

  const progressRows = await db
    .select({ moduleId: moduleProgress.moduleId, status: moduleProgress.status })
    .from(moduleProgress)
    .where(eq(moduleProgress.enrollmentId, enrollmentId));
  const completedCount = progressRows.filter(
    (p) => trackedModuleIds.has(p.moduleId) && p.status === "completed"
  ).length;

  if (completedCount === trackedModuleIds.size) {
    await db
      .update(enrollments)
      .set({ status: "completed", completedAt: new Date() })
      .where(eq(enrollments.id, enrollmentId));
  } else if (completedCount > 0) {
    await db.update(enrollments).set({ status: "in_progress" }).where(eq(enrollments.id, enrollmentId));
  }
}
```

Note `enrollments` is imported once at the top alongside `modules`/`moduleProgress`/`moduleVersions` — there is no dynamic `import()` anywhere in this file.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/db/module-progress.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/db/module-progress.ts lib/db/module-progress.test.ts
git commit -m "feat: add recordModuleCompletion (module_progress upsert + enrollment rollup)"
```

---

## Task 6: Wire `recordModuleCompletion` into the commit routes

**Files:**
- Modify: `app/api/scorm/commit/route.ts`, `app/api/video/commit/route.ts`
- Test: `app/api/scorm/commit/route.test.ts`, `app/api/video/commit/route.test.ts` (existing files — add cases)

**Interfaces:**
- Consumes: `recordModuleCompletion` from `lib/db/module-progress.ts` (Task 5).

- [ ] **Step 1: Write the failing test**

Add to `app/api/scorm/commit/route.test.ts`, following that file's existing setup pattern for seeding a course/module/version/attempt and mocking `auth()`:

```ts
it("still returns 200 and does not throw when recordModuleCompletion runs after a successful commit", async () => {
  // Seed a course/module/version/attempt exactly as this file's other tests
  // do, WITHOUT creating an enrollments row - recordModuleCompletion's
  // internal getEnrollmentId lookup will return null and no-op, proving the
  // commit path tolerates both the enrolled and not-enrolled case.
  // ... use this file's existing seed helper/pattern for course/module/attempt ...
  const response = await POST(request);
  expect(response.status).toBe(200);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/api/scorm/commit/route.test.ts`
Expected: This specific test may pass even before Step 3's code change, since nothing throws yet — that's expected for a route with no enrollment row involved. Confirm it still passes identically after Step 3 (it becomes a real regression guard once the call is wired in).

- [ ] **Step 3: Call it from both commit routes**

In `app/api/scorm/commit/route.ts`, add the import and, after the existing `scormAttemptState` insert/update block and before `return NextResponse.json({ ok: true })`:

```ts
import { recordModuleCompletion } from "@/lib/db/module-progress";

// ... inside POST, after the scormAttemptState write, using the same
// `attempt` row already selected earlier for the ownership check - add
// moduleVersionId to that select's column list instead of querying twice:
    const [attempt] = await db
      .select({ userId: moduleAttempts.userId, moduleVersionId: moduleAttempts.moduleVersionId })
      .from(moduleAttempts)
      .where(eq(moduleAttempts.id, attemptId));
    if (!attempt || attempt.userId !== sessionUserId) {
      return notFound("Attempt not found");
    }

    // ... existing scormAttemptState insert/update logic, unchanged ...

    try {
      await recordModuleCompletion({ userEmail: sessionUserId, moduleVersionId: attempt.moduleVersionId });
    } catch (error) {
      console.error("recordModuleCompletion failed after a successful SCORM commit", error);
    }

    return NextResponse.json({ ok: true });
```

Apply the identical pattern to `app/api/video/commit/route.ts`: extend its existing ownership-check select to also fetch `moduleVersionId`, then call `recordModuleCompletion({ userEmail: sessionUserId, moduleVersionId: attempt.moduleVersionId })` in a try/catch right before its `return NextResponse.json({ ok: true })`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/api/scorm/commit/route.test.ts app/api/video/commit/route.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/api/scorm/commit/route.ts app/api/video/commit/route.ts app/api/scorm/commit/route.test.ts app/api/video/commit/route.test.ts
git commit -m "feat: record module_progress on every SCORM/video commit"
```

---

## Task 7: `getCourseProgressForLearner` reads persisted state

**Files:**
- Modify: `lib/scorm/course-progress.ts`
- Modify: `lib/scorm/course-progress.test.ts` (existing tests move to target the renamed function; new tests added for the new one)

**Interfaces:**
- Consumes: `getUserIdByEmail` (Task 2), `enrollments`/`moduleProgress` (Task 1).
- Produces: `getCourseProgressForLearner(courseId: string, userEmail: string): Promise<CourseProgress>` — **same name and signature as today**, so `app/(app)/courses/page.tsx` and `app/(app)/courses/[id]/page.tsx` need no further changes beyond Task 8. Also produces `computeLiveCourseProgress` (renamed from today's `getCourseProgressForLearner` body) — Task 11's backfill script consumes this.

- [ ] **Step 1: Rename the existing function and its tests**

In `lib/scorm/course-progress.ts`, rename the current `getCourseProgressForLearner` function to `computeLiveCourseProgress` (its body, `isModuleFinishedForUser`, `TrackableModule`, `getTrackedModuleVersionIds`, and both `FINISHED_STATUSES` sets are unchanged — only the exported name of the top-level function changes). In `lib/scorm/course-progress.test.ts`, change every `getCourseProgressForLearner(...)` call to `computeLiveCourseProgress(...)` and the import line accordingly.

- [ ] **Step 2: Run the renamed tests to confirm they still pass**

Run: `npx vitest run lib/scorm/course-progress.test.ts`
Expected: PASS (pure rename, no behavior change yet).

- [ ] **Step 3: Write the failing test for the new persisted-read function**

Add to `lib/scorm/course-progress.test.ts` (add `enrollments, moduleProgress, users` to the existing `@/lib/db/schema` import):

```ts
import { getCourseProgressForLearner } from "./course-progress";

describe("getCourseProgressForLearner (persisted)", () => {
  it("returns not-started with no enrollment (falls back to not-started rather than throwing)", async () => {
    const [course] = await db
      .insert(courses)
      .values({ code: `PERSISTED-${randomUUID()}`, title: "Persisted Progress Test" })
      .returning();
    try {
      const result = await getCourseProgressForLearner(course.id, "nobody@example.com");
      expect(result).toEqual({ status: "not-started", progress: 0 });
    } finally {
      await db.delete(courses).where(eq(courses.id, course.id));
    }
  });

  it("reads status/progress directly from the enrollment and module_progress rows", async () => {
    const email = `persisted-${randomUUID()}@example.com`;
    const [user] = await db.insert(users).values({ email, displayName: "Persisted Test" }).returning();
    const [course] = await db
      .insert(courses)
      .values({ code: `PERSISTED-READ-${randomUUID()}`, title: "Persisted Read Test" })
      .returning();
    const [mod] = await db.insert(modules).values({ courseId: course.id, moduleType: "scorm", title: "M1" }).returning();
    const [version] = await db.insert(moduleVersions).values({ moduleId: mod.id, versionNumber: 1, status: "published" }).returning();
    await db.update(modules).set({ currentVersionId: version.id }).where(eq(modules.id, mod.id));
    const [enrollment] = await db
      .insert(enrollments)
      .values({ userId: user.id, courseId: course.id, status: "in_progress" })
      .returning();
    await db.insert(moduleProgress).values({ enrollmentId: enrollment.id, moduleId: mod.id, status: "completed" });

    try {
      const result = await getCourseProgressForLearner(course.id, email);
      expect(result).toEqual({ status: "in-progress", progress: 100 });
    } finally {
      await db.delete(moduleProgress).where(eq(moduleProgress.enrollmentId, enrollment.id));
      await db.delete(enrollments).where(eq(enrollments.id, enrollment.id));
      await db.update(modules).set({ currentVersionId: null }).where(eq(modules.id, mod.id));
      await db.delete(moduleVersions).where(eq(moduleVersions.id, version.id));
      await db.delete(modules).where(eq(modules.id, mod.id));
      await db.delete(courses).where(eq(courses.id, course.id));
      await db.delete(users).where(eq(users.id, user.id));
    }
  });
});
```

Note the second test's expected progress is `100` despite `enrollment.status` being `"in_progress"` and the course's one and only module being `completed` — this exercises `getCourseProgressForLearner`'s own progress-percentage calculation (`completed module_progress rows / total tracked modules`), which is deliberately independent of the (possibly stale-until-next-commit) `enrollments.status` column: progress % always derives live from `module_progress` counts, only the coarse `status` label comes from the cached `enrollments.status`.

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run lib/scorm/course-progress.test.ts`
Expected: FAIL — no `getCourseProgressForLearner` export yet (it was renamed away in Step 1).

- [ ] **Step 5: Implement the new function**

Add to `lib/scorm/course-progress.ts` (alongside the renamed `computeLiveCourseProgress`), adding `enrollments, moduleProgress` to the existing `@/lib/db/schema` import and a new import for `getUserIdByEmail`:

```ts
import { and, eq } from "drizzle-orm";
import { enrollments, moduleProgress } from "@/lib/db/schema";
import { getUserIdByEmail } from "@/lib/db/users";

export async function getCourseProgressForLearner(
  courseId: string,
  userEmail: string
): Promise<CourseProgress> {
  if (!isUuid(courseId)) {
    return { status: "not-started", progress: 0 };
  }

  const userId = await getUserIdByEmail(userEmail);
  if (!userId) {
    return { status: "not-started", progress: 0 };
  }

  const [enrollment] = await db
    .select()
    .from(enrollments)
    .where(and(eq(enrollments.userId, userId), eq(enrollments.courseId, courseId)));
  if (!enrollment) {
    return { status: "not-started", progress: 0 };
  }

  const courseModules = await db.select().from(modules).where(eq(modules.courseId, courseId));
  const published: TrackableModule[] = courseModules.flatMap((m) =>
    m.currentVersionId ? [{ moduleType: m.moduleType, moduleVersionId: m.currentVersionId }] : []
  );
  const trackedIds = await getTrackedModuleVersionIds(published);
  if (trackedIds.size === 0) {
    return { status: "not-started", progress: 0 };
  }

  const progressRows = await db
    .select({ status: moduleProgress.status })
    .from(moduleProgress)
    .where(eq(moduleProgress.enrollmentId, enrollment.id));
  const completedCount = progressRows.filter((p) => p.status === "completed").length;
  const progress = Math.round((completedCount / trackedIds.size) * 100);

  if (completedCount === 0) {
    return { status: "not-started", progress: 0 };
  }
  if (enrollment.status === "completed") {
    return { status: "completed", progress: 100 };
  }
  return { status: "in-progress", progress };
}
```

`db`, `eq` and `modules` are already imported at the top of the file for `computeLiveCourseProgress` — only `and`, `enrollments`, `moduleProgress`, and `getUserIdByEmail` are new.

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run lib/scorm/course-progress.test.ts`
Expected: PASS (all tests, renamed ones included)

- [ ] **Step 7: Commit**

```bash
git add lib/scorm/course-progress.ts lib/scorm/course-progress.test.ts
git commit -m "feat: getCourseProgressForLearner reads persisted enrollments/module_progress"
```

---

## Task 8: Gate `/courses` to enrolled courses

**Files:**
- Modify: `lib/db/queries.ts`
- Modify: `app/(app)/courses/page.tsx`
- Test: `lib/db/queries.test.ts` (create if it doesn't exist, or add to it if it does — check first)

**Interfaces:**
- Consumes: `getUserIdByEmail` (Task 2), `enrollments` (Task 1).
- Produces: `listEnrolledPublishedCourses(userId: string): Promise<RealCourseSummary[]>` (same `RealCourseSummary` shape as `listPublishedCourses`).

- [ ] **Step 1: Write the failing test**

`lib/db/queries.test.ts` (check whether this file exists first; if so, add a new `describe` block, matching its existing conventions):

```ts
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { listEnrolledPublishedCourses } from "./queries";
import { db } from "./client";
import { courses, enrollments, users } from "./schema";

describe("listEnrolledPublishedCourses", () => {
  it("only returns published courses the user is enrolled in", async () => {
    const [user] = await db
      .insert(users)
      .values({ email: `enrolled-list-${randomUUID()}@example.com`, displayName: "Enrolled List Test" })
      .returning();
    const [enrolledCourse] = await db
      .insert(courses)
      .values({ code: `ENROLLED-${randomUUID()}`, title: "Enrolled Course", status: "published" })
      .returning();
    const [notEnrolledCourse] = await db
      .insert(courses)
      .values({ code: `NOTENROLLED-${randomUUID()}`, title: "Not Enrolled Course", status: "published" })
      .returning();
    await db.insert(enrollments).values({ userId: user.id, courseId: enrolledCourse.id });

    try {
      const result = await listEnrolledPublishedCourses(user.id);
      expect(result.map((c) => c.id)).toEqual([enrolledCourse.id]);
      expect(result.map((c) => c.id)).not.toContain(notEnrolledCourse.id);
    } finally {
      await db.delete(enrollments).where(eq(enrollments.userId, user.id));
      await db.delete(courses).where(eq(courses.id, enrolledCourse.id));
      await db.delete(courses).where(eq(courses.id, notEnrolledCourse.id));
      await db.delete(users).where(eq(users.id, user.id));
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/db/queries.test.ts`
Expected: FAIL — `listEnrolledPublishedCourses` not exported.

- [ ] **Step 3: Implement it**

In `lib/db/queries.ts`, change the top import line from `import { eq, sql } from "drizzle-orm";` to `import { and, eq, sql } from "drizzle-orm";`, add `enrollments` to the `./schema` import, and add:

```ts
export async function listEnrolledPublishedCourses(userId: string): Promise<RealCourseSummary[]> {
  const rows = await db
    .select(courseSummaryColumns)
    .from(enrollments)
    .innerJoin(courses, eq(courses.id, enrollments.courseId))
    .leftJoin(modules, eq(modules.courseId, courses.id))
    .leftJoin(departments, eq(departments.id, courses.departmentId))
    .where(and(eq(enrollments.userId, userId), eq(courses.status, "published")))
    .groupBy(
      courses.id,
      courses.code,
      courses.title,
      departments.name,
      courses.thumbnail,
      courses.compliance,
      courses.dueDate
    )
    .orderBy(courses.createdAt);
  return rows.map(toSummary);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/db/queries.test.ts`
Expected: PASS

- [ ] **Step 5: Wire it into the courses page**

In `app/(app)/courses/page.tsx`, replace:

```ts
import { listPublishedCourses, type RealCourseSummary } from "@/lib/db/queries";
```

with:

```ts
import { listEnrolledPublishedCourses, type RealCourseSummary } from "@/lib/db/queries";
import { getUserIdByEmail } from "@/lib/db/users";
```

And inside the component, replace:

```ts
    const session = await auth();
    const userId = session?.user?.email;
    if (userId) {
      const published: RealCourseSummary[] = await listPublishedCourses();
```

with:

```ts
    const session = await auth();
    const userEmail = session?.user?.email;
    const userId = userEmail ? await getUserIdByEmail(userEmail) : null;
    if (userId && userEmail) {
      const published: RealCourseSummary[] = await listEnrolledPublishedCourses(userId);
```

And further down, where `getCourseProgressForLearner(course.id, userId)` is called (it still expects an email, per Task 7 — unchanged signature), change it to pass `userEmail`:

```ts
          const { status, progress } = await getCourseProgressForLearner(course.id, userEmail);
```

The mock-course section (`mockActive`/`mockFinished`, merged via `[...mockActive, ...realActive]`) is deliberately left untouched — per Global Constraints, this pass does not address the mock/demo course list.

- [ ] **Step 6: Run the full test suite and build**

Run: `npx vitest run && npx next build`
Expected: All tests pass, clean build.

- [ ] **Step 7: Commit**

```bash
git add lib/db/queries.ts lib/db/queries.test.ts "app/(app)/courses/page.tsx"
git commit -m "feat: gate /courses to enrolled courses only"
```

---

## Task 9: `module_attempts.user_id` migration, part 1 — add + backfill (nullable, additive)

**Files:**
- Create: `scripts/verify-module-attempts-email-match.js`
- Modify: `lib/db/schema.ts` (add `userIdNew` column alongside the existing `userId`, temporarily)
- Create: `drizzle/migrations/0011_module_attempts_user_id_uuid_add.sql`

**Interfaces:**
- No exported function changes — this task only adds a column and backfills it. All existing callers keep using `moduleAttempts.userId` (the text column) until Task 10.

- [ ] **Step 1: Write and run the verification script (read-only, no migration yet)**

`scripts/verify-module-attempts-email-match.js`:

```js
const { Client } = require("pg");

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query(`
      SELECT DISTINCT ma.user_id AS email
      FROM module_attempts ma
      LEFT JOIN users u ON u.email = ma.user_id
      WHERE u.id IS NULL
    `);
    if (rows.length === 0) {
      console.log("Every module_attempts.user_id value matches exactly one users.email. Safe to proceed.");
    } else {
      console.log(`${rows.length} module_attempts.user_id value(s) do NOT match any users.email:`);
      for (const row of rows) console.log(` - ${row.email}`);
      console.log("Resolve these case-by-case (backfill a users row, correct the email, or plan to null the FK) before writing the real migration.");
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

Ask the user for explicit confirmation, then run this against production (read-only query, no writes) using the same one-off script pattern as prior migrations (connect as `postgres` or `ssp_lms_app` — this is a plain `SELECT`, either role works). **Do not proceed to Step 2 until this returns zero mismatches or the user has told you how to handle any that appear.**

- [ ] **Step 2: Add the nullable UUID column to the schema**

In `lib/db/schema.ts`, add to `moduleAttempts` (temporarily, alongside the existing `userId: text(...)`):

```ts
export const moduleAttempts = pgTable("module_attempts", {
  id: uuid("id").primaryKey().defaultRandom(),
  moduleVersionId: uuid("module_version_id")
    .notNull()
    .references(() => moduleVersions.id),
  userId: text("user_id").notNull(),
  // Backfilled from users.email in migration 0011; becomes the real user_id
  // (renamed, NOT NULL, FK-constrained) in migration 0012 once verified.
  userIdNew: uuid("user_id_new").references(() => users.id),
  attemptNumber: integer("attempt_number").notNull().default(1),
  status: text("status").notNull().default("in_progress"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
});
```

- [ ] **Step 3: Generate the migration scaffold**

Run: `npx dotenv -e .env.local -- drizzle-kit generate --custom --name module_attempts_user_id_uuid_add`

- [ ] **Step 4: Write the migration SQL**

`drizzle/migrations/0011_module_attempts_user_id_uuid_add.sql`:

```sql
ALTER TABLE "module_attempts" ADD COLUMN "user_id_new" uuid;
--> statement-breakpoint
ALTER TABLE "module_attempts" ADD CONSTRAINT "module_attempts_user_id_new_users_id_fk" FOREIGN KEY ("user_id_new") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
UPDATE "module_attempts" ma
SET "user_id_new" = u.id
FROM "users" u
WHERE u.email = ma.user_id
  AND ma.user_id_new IS NULL;
```

- [ ] **Step 5: Apply the migration to production Cloud SQL**

Ask the user to confirm before running. Same one-off `pg` script pattern as Task 1 Step 6, run as `postgres`. No new table this time, so no `GRANT` needed (the column belongs to the already-granted `module_attempts` table).

- [ ] **Step 6: Verify the backfill is complete**

Run this query against production (read-only, confirm with the user first):

```sql
SELECT count(*) FROM module_attempts WHERE user_id_new IS NULL;
```

Expected: `0`. If not zero, stop and investigate before Task 10 (do not drop the old column with unbackfilled rows still present).

- [ ] **Step 7: Run the full test suite**

Run: `npx vitest run`
Expected: PASS (this column is additive and nothing reads it yet).

- [ ] **Step 8: Commit**

```bash
git add lib/db/schema.ts drizzle/migrations/0011_module_attempts_user_id_uuid_add.sql drizzle/migrations/meta scripts/verify-module-attempts-email-match.js
git commit -m "feat: add and backfill module_attempts.user_id_new (uuid), additive"
```

---

## Task 10: `module_attempts.user_id` migration, part 2 — cut over and update every caller

**Files:**
- Modify: `lib/db/schema.ts`
- Create: `drizzle/migrations/0012_module_attempts_user_id_uuid_finish.sql`
- Modify: `app/api/scorm/attempts/route.ts`, `app/api/video/attempts/route.ts`, `app/api/scorm/commit/route.ts`, `app/api/video/commit/route.ts`, `lib/db/module-progress.ts`
- Modify: their existing test files, plus `lib/scorm/completion-status.test.ts`, `lib/video/completion-status.test.ts`, `lib/scorm/course-progress.test.ts`, `lib/db/module-progress.test.ts` (seed data changes only)

**Interfaces:**
- Produces: `moduleAttempts.userId` is now `uuid`, FK'd to `users.id`, `NOT NULL`. `getLatestLessonStatus(moduleVersionId, userId)` and `getLatestVideoStatus(moduleVersionId, userId)` (both in `lib/scorm|video/completion-status.ts`) keep the exact same name and signature shape — the `userId` string they receive now means a `users.id` UUID instead of an email, so those two files need no code changes, only their tests' seed data changes.

- [ ] **Step 1: Finish the schema cutover**

In `lib/db/schema.ts`, replace the two-column `moduleAttempts` from Task 9 with the final shape:

```ts
export const moduleAttempts = pgTable("module_attempts", {
  id: uuid("id").primaryKey().defaultRandom(),
  moduleVersionId: uuid("module_version_id")
    .notNull()
    .references(() => moduleVersions.id),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  attemptNumber: integer("attempt_number").notNull().default(1),
  status: text("status").notNull().default("in_progress"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
});
```

- [ ] **Step 2: Generate and write the migration**

Run: `npx dotenv -e .env.local -- drizzle-kit generate --custom --name module_attempts_user_id_uuid_finish`

`drizzle/migrations/0012_module_attempts_user_id_uuid_finish.sql`:

```sql
ALTER TABLE "module_attempts" DROP CONSTRAINT "module_attempts_user_id_new_users_id_fk";
--> statement-breakpoint
ALTER TABLE "module_attempts" DROP COLUMN "user_id";
--> statement-breakpoint
ALTER TABLE "module_attempts" RENAME COLUMN "user_id_new" TO "user_id";
--> statement-breakpoint
ALTER TABLE "module_attempts" ALTER COLUMN "user_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "module_attempts" ADD CONSTRAINT "module_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
```

- [ ] **Step 3: Apply the migration to production Cloud SQL**

Ask the user to confirm before running (this one is destructive — it drops the old `user_id` text column). Same one-off script pattern, run as `postgres`.

- [ ] **Step 4: Update every call site from email to `users.id`**

`app/api/scorm/attempts/route.ts` and `app/api/video/attempts/route.ts`: add `import { getUserIdByEmail } from "@/lib/db/users";` and replace `const userId = session?.user?.email;` / the `if (!userId)` guard with:

```ts
    const userEmail = session?.user?.email;
    if (!userEmail) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }
    const userId = await getUserIdByEmail(userEmail);
    if (!userId) {
      return NextResponse.json({ error: "User record not found" }, { status: 404 });
    }
```

Every subsequent use of the local `userId` variable in these two files (the `moduleAttempts` select/insert) is unchanged — it's still called `userId`, just now holds a UUID instead of an email.

`app/api/scorm/commit/route.ts` and `app/api/video/commit/route.ts`: the `sessionUserId` used for the ownership check (`attempt.userId !== sessionUserId`) needs the same resolution:

```ts
    const userEmail = session?.user?.email;
    if (!userEmail) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }
    const sessionUserId = await getUserIdByEmail(userEmail);
    if (!sessionUserId) {
      return NextResponse.json({ error: "User record not found" }, { status: 404 });
    }
```

The `recordModuleCompletion` call added in Task 6 still takes an email (`lib/db/module-progress.ts` does its own internal `getUserIdByEmail` lookup) — keep passing `userEmail` to it, not `sessionUserId`:

```ts
    try {
      await recordModuleCompletion({ userEmail, moduleVersionId: attempt.moduleVersionId });
    } catch (error) {
      console.error("recordModuleCompletion failed after a successful commit", error);
    }
```

`lib/db/module-progress.ts`'s `isModuleFinished` helper currently receives `params.userEmail` and passes it straight to `getLatestLessonStatus`/`getLatestVideoStatus` — those two functions now expect a `users.id` UUID (since every `moduleAttempts.userId` they query against is now a UUID), so `recordModuleCompletion` must resolve and pass the UUID it already computed at the top of the function instead:

```ts
  const finished = await isModuleFinished(moduleRow.moduleType, params.moduleVersionId, userId);
```

(change the call site only — `userId` here is the same variable `recordModuleCompletion` already resolved via `getUserIdByEmail(params.userEmail)` at its top; `isModuleFinished`'s own signature/body is unchanged, it was always just forwarding whatever string it was given).

- [ ] **Step 5: Update every affected test file's seed data**

`app/api/scorm/attempts/route.test.ts`, `app/api/video/attempts/route.test.ts`, `app/api/scorm/commit/route.test.ts`, `app/api/video/commit/route.test.ts`, `lib/scorm/completion-status.test.ts`, `lib/video/completion-status.test.ts`, `lib/scorm/course-progress.test.ts`, `lib/db/module-progress.test.ts`: everywhere one of these tests currently uses a raw email string as the value passed to `moduleAttempts.userId` (e.g. `const userId = "course-progress-test@example.com";` then `moduleAttempts.values({ ..., userId })`), it must insert a real `users` row first and use that row's `id` instead:

```ts
const [testUser] = await db
  .insert(users)
  .values({ email: `some-unique-${randomUUID()}@example.com`, displayName: "Test User" })
  .returning();
const userId = testUser.id;
// ... later, unchanged:
await db.insert(moduleAttempts).values({ moduleVersionId, userId, attemptNumber: 1 });
```

Wherever a test also mocks `auth()`'s session for a route handler, keep supplying an email there (session identity stays email-based) — only the values passed directly into `moduleAttempts.userId` and into `getLatestLessonStatus`/`getLatestVideoStatus` change to the UUID. Check each file's existing session-mocking approach before editing so the mocked shape isn't broken.

- [ ] **Step 6: Run the full test suite and build**

Run: `npx vitest run && npx next build`
Expected: All tests pass, clean build.

- [ ] **Step 7: Commit**

```bash
git add lib/db/schema.ts drizzle/migrations/0012_module_attempts_user_id_uuid_finish.sql drizzle/migrations/meta app/api/scorm app/api/video lib/scorm lib/video lib/db/module-progress.ts
git commit -m "feat: module_attempts.user_id is now a real users.id FK"
```

---

## Task 11: Backfill scripts (dry-run capable)

**Files:**
- Create: `scripts/backfill-enrollments-from-assignments.js`
- Create: `scripts/backfill-enrollments-from-attempts.ts`

**Interfaces:**
- Consumes: `computeLiveCourseProgress` (Task 7) for deriving a status for the second script's pre-existing-history case.
- No app code consumes these — they're one-time operational scripts, run manually against production once, after all other tasks are deployed and before Task 8's `/courses` gating is relied upon by real users (otherwise someone with real history but no `course_assignments` row would lose access the moment Task 8 ships).

**Sequencing note:** run these (dry-run first, then for real, both with explicit user confirmation) **before** Task 8 is merged to `main`/deployed — or at minimum with no meaningful gap after — since Task 8's gating is what turns a missing `enrollments` row into an actual access loss rather than a latent gap.

- [ ] **Step 1: Write the assignments backfill script**

`scripts/backfill-enrollments-from-assignments.js`:

```js
const { Client } = require("pg");

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query(`
      SELECT ca.user_id, ca.course_id, c.due_date
      FROM course_assignments ca
      JOIN courses c ON c.id = ca.course_id
      LEFT JOIN enrollments e ON e.user_id = ca.user_id AND e.course_id = ca.course_id
      WHERE e.id IS NULL
    `);

    console.log(`${rows.length} course_assignments row(s) missing a matching enrollment.`);
    if (DRY_RUN) {
      for (const row of rows) console.log(` - would create enrollment: user ${row.user_id}, course ${row.course_id}`);
      return;
    }

    await client.query("BEGIN");
    for (const row of rows) {
      await client.query(
        `INSERT INTO enrollments (user_id, course_id, status, source, due_at)
         VALUES ($1, $2, 'not_started', 'assigned', $3)
         ON CONFLICT (user_id, course_id) DO NOTHING`,
        [row.user_id, row.course_id, row.due_date]
      );
    }
    await client.query("COMMIT");
    console.log(`Created ${rows.length} enrollment(s).`);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Write the orphan-attempt-history backfill script**

`scripts/backfill-enrollments-from-attempts.ts` — finds `(user, course)` pairs with real `module_attempts` history but no `course_assignments` row, derives a status by calling the retained `computeLiveCourseProgress` function against each pair. This one needs the app's actual Drizzle-based logic (not a hand-rolled SQL approximation), so it's a `.ts` file run with `npx tsx`, not plain `node`:

```ts
// Run with: npx tsx scripts/backfill-enrollments-from-attempts.ts [--dry-run]
import { db } from "../lib/db/client";
import { computeLiveCourseProgress } from "../lib/scorm/course-progress";
import { courseAssignments, enrollments, moduleAttempts, moduleVersions, modules, users } from "../lib/db/schema";
import { and, eq, isNull } from "drizzle-orm";

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  const orphanPairs = await db
    .selectDistinct({ userId: moduleAttempts.userId, courseId: modules.courseId })
    .from(moduleAttempts)
    .innerJoin(moduleVersions, eq(moduleVersions.id, moduleAttempts.moduleVersionId))
    .innerJoin(modules, eq(modules.id, moduleVersions.moduleId))
    .leftJoin(
      courseAssignments,
      and(eq(courseAssignments.userId, moduleAttempts.userId), eq(courseAssignments.courseId, modules.courseId))
    )
    .leftJoin(
      enrollments,
      and(eq(enrollments.userId, moduleAttempts.userId), eq(enrollments.courseId, modules.courseId))
    )
    .where(and(isNull(courseAssignments.id), isNull(enrollments.id)));

  console.log(`${orphanPairs.length} (user, course) pair(s) have attempt history but no assignment or enrollment.`);

  for (const pair of orphanPairs) {
    const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, pair.userId));
    if (!user) continue;
    const progress = await computeLiveCourseProgress(pair.courseId, user.email);
    const status = progress.status === "completed" ? "completed" : progress.status === "in-progress" ? "in_progress" : "not_started";

    if (DRY_RUN) {
      console.log(` - would create enrollment: user ${pair.userId}, course ${pair.courseId}, status ${status}`);
      continue;
    }
    await db
      .insert(enrollments)
      .values({ userId: pair.userId, courseId: pair.courseId, status, source: "auto" })
      .onConflictDoNothing();
  }
  console.log(DRY_RUN ? "Dry run complete." : `Backfilled ${orphanPairs.length} enrollment(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

Note: this script must run **after** Task 10 (it relies on `moduleAttempts.userId` already being a `users.id` UUID to join against `enrollments.userId`/`courseAssignments.userId` directly) — sequence it last regardless of task-number order if execution order ever diverges from the plan's task order.

- [ ] **Step 3: Run both scripts in dry-run mode against production, review output with the user**

```bash
npx tsx scripts/backfill-enrollments-from-attempts.ts --dry-run
node scripts/backfill-enrollments-from-assignments.js --dry-run
```

Ask the user to confirm before running either against production, dry-run or not (still a live DB connection). Review the printed output together before proceeding.

- [ ] **Step 4: Run both for real, with explicit confirmation**

```bash
node scripts/backfill-enrollments-from-assignments.js
npx tsx scripts/backfill-enrollments-from-attempts.ts
```

- [ ] **Step 5: Commit the scripts**

```bash
git add scripts/backfill-enrollments-from-assignments.js scripts/backfill-enrollments-from-attempts.ts
git commit -m "feat: add enrollments backfill scripts (assignments + orphan attempt history)"
```

---

## Self-Review Notes

**Spec coverage:** §1 Schema → Task 1 (+ Tasks 9-10 for `module_attempts.user_id`). §2 Data flow (assignment) → Task 4. §2 Data flow (attempt commit) → Tasks 5-6. §2 Data flow (course list) → Task 8. §2 `getCourseProgressForLearner` rewrite → Task 7. §3 migration → Tasks 9-10. §4 Migration/rollout backfills → Task 11. §5 Error handling (`ON CONFLICT DO NOTHING` equivalent via existence-check-before-insert, non-blocking progress writes) → Tasks 3-6 as implemented. §6 Testing → each task's own test steps plus Task 10 Step 5 for the cross-cutting seed-data updates.

**Known deviations from the spec, called out explicitly (not silent):**
- `module_progress.bestScore` is `integer`, not `numeric` (Task 1 note) — unused this pass either way.
- `recordModuleCompletion` only recomputes the enrollment rollup when a module's finished-state actually changes, not on every commit (Task 5) — an optimization beyond the spec's literal text, addressing the SCORM-commit-frequency concern raised in review.
- The admin SCORM-test-tool graceful-no-enrollment behavior (Task 5, Global Constraints) is an explicit addition beyond the spec's literal text, needed to avoid regressing an existing admin tool the spec doesn't mention.
- Course detail/launch pages remain ungated (Global Constraints) — spec only describes changing the list query; flagged as a carried-over limitation, not fixed here.
- Mock/demo courses on `/courses` remain unconditionally visible (Task 8) — spec doesn't address them; this was flagged as an open decision during plan review and defaulted to "leave as-is" as the least destructive option.
