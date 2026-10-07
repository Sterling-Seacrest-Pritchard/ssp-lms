# Notifications / Update System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give ssp-lms a persisted, in-app notification system (course-assigned, due-soon, overdue, admin broadcast) with read/unread state, replacing the dashboard's mock "Updates" feed, and let OrgAdmins/DepartmentAdmins send one-off custom broadcasts scoped to the whole company or to a department they administer.

**Architecture:** Fan-out-on-write — every notification is a row in one `notifications` table keyed by recipient `user_id`, including broadcasts (one row per resolved recipient at send time). A small trigger layer under `lib/notifications/` wraps the existing email senders so each event (course assigned, due-soon, overdue) writes one DB row and sends one email from a single call site. Admin broadcasts are in-app only.

**Tech Stack:** Next.js App Router, Drizzle ORM (Postgres, `drizzle-kit generate`/`migrate`), NextAuth + Entra ID, Vitest (tests run against the live dev DB, no separate test DB — see `vitest.config.ts`), shadcn/ui (`DropdownMenu`, `Badge`, `Select` already installed, no new components needed).

**Spec:** `docs/superpowers/specs/2026-10-07-notifications-update-system-design.md`

## Deviations from spec (locked during implementation research)

- **IDs are `uuid`, not serial/integer.** Every table in `lib/db/schema.ts` uses `uuid("id").primaryKey().defaultRandom()`; the spec's `serial` was wrong about this project's convention. `notifications` and `notification_broadcasts` both use `uuid`.
- **Broadcast authorship is a plain text email column (`author_email`), not a FK to `users.id`.** `courseAssignments.assignedBy`, `departmentCourseAssignments.assignedBy`, and `departmentAdmins.assignedBy` are all `text`, specifically so an admin-attribution record survives that admin's own user row being renamed or removed. `notification_broadcasts` follows the same convention. The department-scoping permission check still resolves the real `users.id` via `getUserIdByEmail` — only storage differs.
- **Enum-like columns use `text`, not `varchar`.** `lib/db/schema.ts` never imports `varchar`; every status/type-like column is `text(...)` with a comment listing the legal values, app-validated. `notifications.type` and `notification_broadcasts.target_scope` follow suit.
- **The due-date cron route's auth gap is real and gets fixed here.** `proxy.ts`'s matcher excludes `api/admin/entra-sync/cron` from session auth but not `api/admin/notifications/due-date-reminders/cron` — so today, a bearer-token-only Vercel Cron request to that route hits `!req.auth` and gets redirected before its own `CRON_SECRET` check ever runs. Task 4 fixes the matcher, since the overdue sweep being added to that same route would otherwise never run either.
- **The due-soon/overdue sweep logic stays in `lib/mail/due-date-reminders.ts`** (not a new `lib/notifications/due-date-sweep.ts`) — that file already owns this cron's querying logic end to end; splitting it across two files for one new pass would duplicate the candidate-query shape for no benefit.

## Global Constraints

- Admin broadcasts are in-app only — no email send path for `admin_broadcast` type notifications.
- Notifications persist indefinitely — no expiry/archive job.
- Settings-page notification toggles stay untouched and unwired — explicitly out of scope for this plan.
- `type` on `notifications` is one of exactly: `course_assigned` | `due_soon` | `overdue` | `admin_broadcast`.
- `target_scope` on `notification_broadcasts` is one of exactly: `all` | `department`.
- OrgAdmin may broadcast with either scope, to any department. DepartmentAdmin may only use `targetScope: "department"` with a `targetDepartmentId` they administer (per `department_admins`).
- No multi-tenant "organization" concept exists or is introduced — "OrgAdmin" means company-wide admin, matching `lib/roles.ts`.

## Review Focus

- Marking someone else's notification as read must silently no-op (0 rows affected), not error or leak whether that id belongs to another user — Task 6.
- A DepartmentAdmin broadcast naming a department they do not administer must be rejected with 403, not silently re-scoped or allowed — Task 7.
- The due-soon and overdue sweeps must be independently deduped (`due_reminder_sent_at` vs `overdue_notified_at`) so fixing/adding one never double-fires or skips the other for the same enrollment — Task 4.
- An inactive (`is_active = false`) user must never receive a new notification row, whether via course assignment, either due-date sweep pass, or broadcast fan-out — Tasks 3, 4, 5.
- A broadcast targeting a department with zero active users must succeed with `recipientCount: 0`, not throw or return an error — Task 5.

---

## Task 1: Schema — `notifications`, `notification_broadcasts`, `enrollments.overdue_notified_at`

**Files:**
- Modify: `lib/db/schema.ts` (add two new tables after `departmentAdmins`, add one column to `enrollments`)
- Create: migration via `npm run db:generate` (produces `drizzle/migrations/0019_*.sql` + matching `meta/0019_snapshot.json` + `meta/_journal.json` entry — do not hand-write these)
- Test: `lib/db/schema.test.ts` (extend existing file with a new `describe` block)

**Interfaces:**
- Produces: `notifications` table (`id: uuid`, `userId: uuid` FK→`users.id` `onDelete: cascade`, `type: text`, `title: text`, `body: text`, `linkHref: text | null`, `readAt: timestamp | null`, `createdAt: timestamp`, `broadcastId: uuid | null` FK→`notificationBroadcasts.id`), `notificationBroadcasts` table (`id: uuid`, `authorEmail: text`, `title: text`, `body: text`, `targetScope: text`, `targetDepartmentId: uuid | null` FK→`departments.id`, `createdAt: timestamp`), `enrollments.overdueNotifiedAt: timestamp | null`.

- [ ] **Step 1: Add the two new tables and the enrollments column to `lib/db/schema.ts`**

Add directly below the existing `departmentAdmins` export:

```ts
export const notificationBroadcasts = pgTable("notification_broadcasts", {
  id: uuid("id").primaryKey().defaultRandom(),
  authorEmail: text("author_email").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  // 'all' | 'department' - plain text, app-validated. See Global Constraints.
  targetScope: text("target_scope").notNull(),
  targetDepartmentId: uuid("target_department_id").references(() => departments.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  // 'course_assigned' | 'due_soon' | 'overdue' | 'admin_broadcast' - plain text,
  // app-validated. See Global Constraints.
  type: text("type").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  linkHref: text("link_href"),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  broadcastId: uuid("broadcast_id").references(() => notificationBroadcasts.id),
});
```

In the existing `enrollments` table, add directly after `dueReminderSentAt`:

```ts
  // Set the first time the due-date cron's overdue pass emails/notifies this
  // enrollment, mirroring dueReminderSentAt - see lib/mail/due-date-reminders.ts.
  overdueNotifiedAt: timestamp("overdue_notified_at", { withTimezone: true }),
```

- [ ] **Step 2: Generate the migration**

Run: `npm run db:generate`
Expected: new files `drizzle/migrations/0019_<auto-name>.sql` and `drizzle/migrations/meta/0019_snapshot.json`, plus a new entry appended to `drizzle/migrations/meta/_journal.json`.

- [ ] **Step 3: Apply the migration to the dev DB**

Run: `npm run db:migrate`
Expected: exits 0, no errors. (Tests in this repo run against the live dev DB per `vitest.config.ts`, so this must succeed before Step 4.)

- [ ] **Step 4: Write a schema smoke test**

Add to `lib/db/schema.test.ts`:

```ts
describe("notifications schema", () => {
  it("inserts a notification and a broadcast, and reads them back", async () => {
    const [user] = await db
      .insert(users)
      .values({ email: `notif-schema-${randomUUID()}@example.com`, displayName: "Schema Test User" })
      .returning();
    const [broadcast] = await db
      .insert(notificationBroadcasts)
      .values({ authorEmail: "admin@example.com", title: "Broadcast Title", body: "Broadcast body", targetScope: "all" })
      .returning();
    const [notification] = await db
      .insert(notifications)
      .values({ userId: user.id, type: "admin_broadcast", title: "Broadcast Title", body: "Broadcast body", broadcastId: broadcast.id })
      .returning();

    expect(notification.readAt).toBeNull();
    expect(notification.broadcastId).toBe(broadcast.id);

    await db.delete(notifications).where(eq(notifications.id, notification.id));
    await db.delete(notificationBroadcasts).where(eq(notificationBroadcasts.id, broadcast.id));
    await db.delete(users).where(eq(users.id, user.id));
  });
});
```

Add `notifications, notificationBroadcasts` to this file's existing `from "./schema"` import.

- [ ] **Step 5: Run the test**

Run: `npx vitest run lib/db/schema.test.ts`
Expected: PASS (all describe blocks in the file, including the new one)

- [ ] **Step 6: Commit**

```bash
git add lib/db/schema.ts lib/db/schema.test.ts drizzle/migrations
git commit -m "feat: add notifications and notification_broadcasts tables"
```

---

## Task 2: Notification core — create, list, mark read

**Files:**
- Create: `lib/notifications/create.ts`
- Create: `lib/notifications/queries.ts`
- Test: `lib/notifications/create.test.ts`
- Test: `lib/notifications/queries.test.ts`

**Interfaces:**
- Consumes: `notifications` table from Task 1.
- Produces: `createNotification(input: CreateNotificationInput): Promise<void>` where `CreateNotificationInput = { userId: string; type: "course_assigned" | "due_soon" | "overdue" | "admin_broadcast"; title: string; body: string; linkHref?: string | null; broadcastId?: string | null }`. `listNotificationsForUser(userId: string, opts?: { limit?: number; offset?: number }): Promise<NotificationRow[]>`. `countUnreadNotifications(userId: string): Promise<number>`. `markNotificationRead(id: string, userId: string): Promise<void>`. `markAllNotificationsRead(userId: string): Promise<void>`. `NotificationRow = { id: string; type: string; title: string; body: string; linkHref: string | null; readAt: string | null; createdAt: string }`.

- [ ] **Step 1: Write the failing test for `createNotification`**

```ts
// lib/notifications/create.test.ts
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users, notifications } from "@/lib/db/schema";
import { createNotification } from "./create";

describe("createNotification", () => {
  it("inserts a notification row for the given user", async () => {
    const [user] = await db
      .insert(users)
      .values({ email: `create-notif-${randomUUID()}@example.com`, displayName: "Create Notif User" })
      .returning();
    try {
      await createNotification({
        userId: user.id,
        type: "course_assigned",
        title: "New course assigned",
        body: "AML Fundamentals",
        linkHref: "/courses/abc",
      });
      const rows = await db.select().from(notifications).where(eq(notifications.userId, user.id));
      expect(rows).toHaveLength(1);
      expect(rows[0].type).toBe("course_assigned");
      expect(rows[0].linkHref).toBe("/courses/abc");
      expect(rows[0].readAt).toBeNull();
    } finally {
      await db.delete(notifications).where(eq(notifications.userId, user.id));
      await db.delete(users).where(eq(users.id, user.id));
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/notifications/create.test.ts`
Expected: FAIL (`Cannot find module './create'`)

- [ ] **Step 3: Implement `createNotification` in `lib/notifications/create.ts`**

```ts
export type NotificationType = "course_assigned" | "due_soon" | "overdue" | "admin_broadcast";

export interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  linkHref?: string | null;
  broadcastId?: string | null;
}

export async function createNotification(input: CreateNotificationInput): Promise<void>
```

Single `db.insert(notifications).values(...)` call, defaulting `linkHref`/`broadcastId` to `null` when omitted.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/notifications/create.test.ts`
Expected: PASS

- [ ] **Step 5: Write the failing tests for the query functions**

```ts
// lib/notifications/queries.test.ts
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users, notifications } from "@/lib/db/schema";
import { listNotificationsForUser, countUnreadNotifications, markNotificationRead, markAllNotificationsRead } from "./queries";

async function seedUser() {
  const [user] = await db
    .insert(users)
    .values({ email: `notif-query-${randomUUID()}@example.com`, displayName: "Query Test User" })
    .returning();
  return user;
}

describe("notification queries", () => {
  it("lists a user's notifications newest-first and counts unread", async () => {
    const user = await seedUser();
    try {
      const [older] = await db.insert(notifications).values({ userId: user.id, type: "due_soon", title: "Older", body: "b" }).returning();
      await db.update(notifications).set({ createdAt: new Date(Date.now() - 60000) }).where(eq(notifications.id, older.id));
      await db.insert(notifications).values({ userId: user.id, type: "overdue", title: "Newer", body: "b" });

      const rows = await listNotificationsForUser(user.id);
      expect(rows).toHaveLength(2);
      expect(rows[0].title).toBe("Newer");
      expect(await countUnreadNotifications(user.id)).toBe(2);
    } finally {
      await db.delete(notifications).where(eq(notifications.userId, user.id));
      await db.delete(users).where(eq(users.id, user.id));
    }
  });

  it("marks a single notification read only for its own user, no-ops for a foreign id", async () => {
    const owner = await seedUser();
    const stranger = await seedUser();
    try {
      const [note] = await db.insert(notifications).values({ userId: owner.id, type: "due_soon", title: "t", body: "b" }).returning();

      await markNotificationRead(note.id, stranger.id);
      let [row] = await db.select().from(notifications).where(eq(notifications.id, note.id));
      expect(row.readAt).toBeNull();

      await markNotificationRead(note.id, owner.id);
      [row] = await db.select().from(notifications).where(eq(notifications.id, note.id));
      expect(row.readAt).not.toBeNull();
    } finally {
      await db.delete(notifications).where(eq(notifications.userId, owner.id));
      await db.delete(users).where(eq(users.id, owner.id));
      await db.delete(users).where(eq(users.id, stranger.id));
    }
  });

  it("marks all of a user's notifications read", async () => {
    const user = await seedUser();
    try {
      await db.insert(notifications).values([
        { userId: user.id, type: "due_soon", title: "a", body: "b" },
        { userId: user.id, type: "overdue", title: "c", body: "d" },
      ]);
      await markAllNotificationsRead(user.id);
      expect(await countUnreadNotifications(user.id)).toBe(0);
    } finally {
      await db.delete(notifications).where(eq(notifications.userId, user.id));
      await db.delete(users).where(eq(users.id, user.id));
    }
  });
});
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `npx vitest run lib/notifications/queries.test.ts`
Expected: FAIL (`Cannot find module './queries'`)

- [ ] **Step 7: Implement the four query functions in `lib/notifications/queries.ts`**

```ts
export interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string;
  linkHref: string | null;
  readAt: string | null;
  createdAt: string;
}

export async function listNotificationsForUser(
  userId: string,
  opts?: { limit?: number; offset?: number }
): Promise<NotificationRow[]>

export async function countUnreadNotifications(userId: string): Promise<number>

export async function markNotificationRead(id: string, userId: string): Promise<void>

export async function markAllNotificationsRead(userId: string): Promise<void>
```

`listNotificationsForUser`: `WHERE userId = ?`, `ORDER BY createdAt DESC`, `LIMIT min(opts.limit ?? 20, 100)`, `OFFSET opts.offset ?? 0`; map `readAt`/`createdAt` to ISO strings (`null` stays `null`). `countUnreadNotifications`: `count(*)` `WHERE userId = ? AND readAt IS NULL`. `markNotificationRead`/`markAllNotificationsRead`: `UPDATE ... SET readAt = now()`, scoped by `userId` in the `WHERE` (plus `id` for the single version, plus `readAt IS NULL` for the bulk version so it doesn't re-stamp already-read rows).

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx vitest run lib/notifications/queries.test.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add lib/notifications/create.ts lib/notifications/create.test.ts lib/notifications/queries.ts lib/notifications/queries.test.ts
git commit -m "feat: add notification create/list/read-state core functions"
```

---

## Task 3: Course-assigned notification wiring

**Files:**
- Create: `lib/notifications/course-assigned.ts`
- Modify: `lib/db/course-assignments.ts:1-6,93-110` (import swap, call-site swap)
- Test: `lib/notifications/course-assigned.test.ts`
- Modify: `lib/db/course-assignments.test.ts` (update the existing email-mock assertions to the new call path)

**Interfaces:**
- Consumes: `createNotification` (Task 2), `sendCourseAssignedEmail`, `NotifyUser`, `NotifyCourse` (`lib/mail/notifications.ts`, unchanged).
- Produces: `notifyCourseAssigned(userId: string, user: NotifyUser, course: NotifyCourse & { courseId: string }): Promise<void>`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/notifications/course-assigned.test.ts
import { describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users, notifications } from "@/lib/db/schema";
import { sendCourseAssignedEmail } from "@/lib/mail/notifications";
import { notifyCourseAssigned } from "./course-assigned";

vi.mock("@/lib/mail/notifications", () => ({
  sendCourseAssignedEmail: vi.fn().mockResolvedValue(undefined),
}));

describe("notifyCourseAssigned", () => {
  it("writes a course_assigned notification and sends the email", async () => {
    const [user] = await db
      .insert(users)
      .values({ email: `notify-assigned-${randomUUID()}@example.com`, displayName: "Assignee" })
      .returning();
    try {
      await notifyCourseAssigned(
        user.id,
        { email: user.email, displayName: user.displayName },
        { courseId: "course-123", title: "AML Fundamentals", dueAt: null }
      );

      const rows = await db.select().from(notifications).where(eq(notifications.userId, user.id));
      expect(rows).toHaveLength(1);
      expect(rows[0].type).toBe("course_assigned");
      expect(rows[0].linkHref).toBe("/courses/course-123");

      expect(sendCourseAssignedEmail).toHaveBeenCalledWith(
        { email: user.email, displayName: user.displayName },
        { courseId: "course-123", title: "AML Fundamentals", dueAt: null }
      );
    } finally {
      await db.delete(notifications).where(eq(notifications.userId, user.id));
      await db.delete(users).where(eq(users.id, user.id));
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/notifications/course-assigned.test.ts`
Expected: FAIL (`Cannot find module './course-assigned'`)

- [ ] **Step 3: Implement `notifyCourseAssigned` in `lib/notifications/course-assigned.ts`**

```ts
import { createNotification } from "./create";
import { sendCourseAssignedEmail, type NotifyUser, type NotifyCourse } from "@/lib/mail/notifications";

export async function notifyCourseAssigned(
  userId: string,
  user: NotifyUser,
  course: NotifyCourse & { courseId: string }
): Promise<void> {
  await createNotification({
    userId,
    type: "course_assigned",
    title: "New course assigned",
    body: course.title,
    linkHref: `/courses/${course.courseId}`,
  });
  await sendCourseAssignedEmail(user, course);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/notifications/course-assigned.test.ts`
Expected: PASS

- [ ] **Step 5: Wire it into `assignCourse`**

In `lib/db/course-assignments.ts`, replace the `sendCourseAssignedEmail` import with `import { notifyCourseAssigned } from "@/lib/notifications/course-assigned";`, and replace the block at lines 102-107:

```ts
    if (course && user) {
      await sendCourseAssignedEmail(
        { email: user.email, displayName: user.displayName },
        { title: course.title, dueAt: course.dueDate }
      );
    }
```

with:

```ts
    if (course && user) {
      await notifyCourseAssigned(
        userId,
        { email: user.email, displayName: user.displayName },
        { courseId, title: course.title, dueAt: course.dueDate }
      );
    }
```

The surrounding `try`/`catch` (comment above it already explains why) is untouched — it now covers both the DB write and the email send, so a failure in either still can't block or undo the assignment that already committed.

- [ ] **Step 6: Update the existing course-assignments test's mock and assertions**

In `lib/db/course-assignments.test.ts`, change the `vi.mock("@/lib/mail/notifications", ...)` block to instead mock `@/lib/notifications/course-assigned`:

```ts
vi.mock("@/lib/notifications/course-assigned", () => ({
  notifyCourseAssigned: vi.fn().mockResolvedValue(undefined),
}));
```

and update the matching `import { sendCourseAssignedEmail } ...` line (if the file asserts on it anywhere — check before editing) to `import { notifyCourseAssigned } from "@/lib/notifications/course-assigned";`, adjusting any `expect(sendCourseAssignedEmail)...` call to `expect(notifyCourseAssigned)...` with the new three-argument shape.

- [ ] **Step 7: Run both affected test files**

Run: `npx vitest run lib/db/course-assignments.test.ts lib/notifications/course-assigned.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add lib/notifications/course-assigned.ts lib/notifications/course-assigned.test.ts lib/db/course-assignments.ts lib/db/course-assignments.test.ts
git commit -m "feat: write a notification row when a course is assigned"
```

---

## Task 4: Due-soon + overdue sweep, cron route, proxy matcher fix

**Files:**
- Modify: `lib/mail/notifications.ts` (add `sendOverdueEmail`)
- Modify: `lib/mail/due-date-reminders.ts` (due-soon pass also writes a notification; add new overdue pass)
- Modify: `app/api/admin/notifications/due-date-reminders/cron/route.ts` (run both passes)
- Modify: `proxy.ts:23` (matcher fix)
- Test: `lib/mail/notifications.test.ts` (extend)
- Test: `lib/mail/due-date-reminders.test.ts` (extend)
- Test: `app/api/admin/notifications/due-date-reminders/cron/route.test.ts` (check if this file exists; extend or create)

**Interfaces:**
- Consumes: `createNotification` (Task 2).
- Produces: `sendOverdueEmail(user: NotifyUser, course: NotifyCourse & { dueAt: string | Date }): Promise<void>` in `lib/mail/notifications.ts`. `sendOverdueNotifications(now?: Date): Promise<DueDateReminderResult>` in `lib/mail/due-date-reminders.ts` (same `DueDateReminderResult` shape as the existing `sendDueDateReminders`).

- [ ] **Step 1: Write the failing test for `sendOverdueEmail`**

Add to `lib/mail/notifications.test.ts` (mirror whatever pattern the existing `sendDueDateReminderEmail` test there already uses for asserting on `sendMail`'s call args/subject line):

```ts
describe("sendOverdueEmail", () => {
  it("sends an overdue email with the course title and due date", async () => {
    await sendOverdueEmail(
      { email: "learner@example.com", displayName: "Learner Name" },
      { title: "AML Fundamentals", dueAt: new Date("2026-01-01T00:00:00Z") }
    );
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: ["learner@example.com"], subject: expect.stringContaining("Overdue") })
    );
  });
});
```

(Match this repo's actual `vi.mock("./graph-mail", ...)` setup already present in that test file rather than re-declaring it.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/mail/notifications.test.ts`
Expected: FAIL (`sendOverdueEmail is not a function` / not exported)

- [ ] **Step 3: Implement `sendOverdueEmail` in `lib/mail/notifications.ts`**

Add after `sendDueDateReminderEmail`, following its exact structure (same `escapeHtml`/`wrapEmail`/`formatDate` usage), with subject `` `Overdue: ${course.title}` `` and body copy stating the course is now past its due date.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/mail/notifications.test.ts`
Expected: PASS

- [ ] **Step 5: Write the failing tests for the due-soon notification write and the new overdue pass**

Add to `lib/mail/due-date-reminders.test.ts` (reusing that file's existing `seedEnrollment`/`cleanup` helpers):

```ts
import { createNotification } from "@/lib/notifications/create";
import { sendOverdueEmail } from "./notifications";
import { sendOverdueNotifications } from "./due-date-reminders";

vi.mock("@/lib/notifications/create", () => ({
  createNotification: vi.fn().mockResolvedValue(undefined),
}));
// extend the existing vi.mock("./notifications", ...) block to also export sendOverdueEmail: vi.fn().mockResolvedValue(undefined)

describe("sendDueDateReminders notification write", () => {
  it("also writes a due_soon notification when it emails a reminder", async () => {
    const seeded = await seedEnrollment({ dueAt: daysFromNow(2) });
    try {
      await sendDueDateReminders(NOW);
      expect(createNotification).toHaveBeenCalledWith(
        expect.objectContaining({ userId: seeded.user.id, type: "due_soon" })
      );
    } finally {
      await cleanup([{ enrollmentId: seeded.enrollment.id, courseId: seeded.course.id, userId: seeded.user.id }]);
    }
  });
});

describe("sendOverdueNotifications", () => {
  it("emails and notifies an incomplete enrollment whose due date has passed", async () => {
    const seeded = await seedEnrollment({ dueAt: daysFromNow(-1) });
    try {
      const result = await sendOverdueNotifications(NOW);
      expect(result.sent).toBeGreaterThanOrEqual(1);
      expect(sendOverdueEmail).toHaveBeenCalled();
      expect(createNotification).toHaveBeenCalledWith(
        expect.objectContaining({ userId: seeded.user.id, type: "overdue" })
      );
      const [updated] = await db.select().from(enrollments).where(eq(enrollments.id, seeded.enrollment.id));
      expect(updated.overdueNotifiedAt).not.toBeNull();
    } finally {
      await cleanup([{ enrollmentId: seeded.enrollment.id, courseId: seeded.course.id, userId: seeded.user.id }]);
    }
  });

  it("does not re-notify an enrollment already marked overdue-notified", async () => {
    const seeded = await seedEnrollment({ dueAt: daysFromNow(-1) });
    await db.update(enrollments).set({ overdueNotifiedAt: daysFromNow(-1) }).where(eq(enrollments.id, seeded.enrollment.id));
    try {
      await sendOverdueNotifications(NOW);
      const called = vi.mocked(sendOverdueEmail).mock.calls.some(([user]) => user.email === seeded.user.email);
      expect(called).toBe(false);
    } finally {
      await cleanup([{ enrollmentId: seeded.enrollment.id, courseId: seeded.course.id, userId: seeded.user.id }]);
    }
  });

  it("skips a completed or inactive enrollment even if overdue", async () => {
    const completed = await seedEnrollment({ dueAt: daysFromNow(-1), status: "completed" });
    const inactive = await seedEnrollment({ dueAt: daysFromNow(-1), isActive: false });
    try {
      await sendOverdueNotifications(NOW);
      const emailed = vi.mocked(sendOverdueEmail).mock.calls.map(([user]) => user.email);
      expect(emailed).not.toContain(completed.user.email);
      expect(emailed).not.toContain(inactive.user.email);
    } finally {
      await cleanup([
        { enrollmentId: completed.enrollment.id, courseId: completed.course.id, userId: completed.user.id },
        { enrollmentId: inactive.enrollment.id, courseId: inactive.course.id, userId: inactive.user.id },
      ]);
    }
  });
});
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `npx vitest run lib/mail/due-date-reminders.test.ts`
Expected: FAIL (`sendOverdueNotifications` not exported; `createNotification` call assertion fails since `sendDueDateReminders` doesn't call it yet)

- [ ] **Step 7: Implement the due-soon notification write and `sendOverdueNotifications` in `lib/mail/due-date-reminders.ts`**

In the existing `sendDueDateReminders` loop, right after the successful `sendDueDateReminderEmail` call (before updating `dueReminderSentAt`), add:

```ts
await createNotification({
  userId: row.userId,
  type: "due_soon",
  title: "Course due soon",
  body: row.courseTitle,
  linkHref: `/courses/${row.courseId}`,
});
```

(Add `userId` and `courseId` to that query's `select` block — they're not currently selected, only needed for this.)

Add a new exported function with the same shape as `sendDueDateReminders`, querying the overdue condition instead:

```ts
export async function sendOverdueNotifications(now: Date = new Date()): Promise<DueDateReminderResult>
```

Candidates: `isNotNull(enrollments.dueAt)`, `isNull(enrollments.overdueNotifiedAt)`, `lte(enrollments.dueAt, now)` (strictly past due, not the due-soon window). Same per-row skip logic (`status !== "completed"`, `isActive`), same try/catch/counter pattern, calling `sendOverdueEmail` + `createNotification({ type: "overdue", ... })` then stamping `overdueNotifiedAt` on success, leaving it unset on failure.

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx vitest run lib/mail/due-date-reminders.test.ts`
Expected: PASS

- [ ] **Step 9: Wire the cron route to run both passes**

In `app/api/admin/notifications/due-date-reminders/cron/route.ts`, import `sendOverdueNotifications` alongside `sendDueDateReminders`, call both inside the existing `try`, and merge their results before responding:

```ts
const dueSoon = await sendDueDateReminders();
const overdue = await sendOverdueNotifications();
const result = {
  checked: dueSoon.checked + overdue.checked,
  sent: dueSoon.sent + overdue.sent,
  failed: dueSoon.failed + overdue.failed,
};
```

Keep the existing log line and `NextResponse.json(result)` return.

- [ ] **Step 10: Fix the proxy matcher gap**

In `proxy.ts:23`, add the due-date cron path to the existing negative-lookahead exclusion list, next to `api/admin/entra-sync/cron`:

```ts
"/((?!sign-in|api/auth|api/admin/entra-sync/cron|api/admin/notifications/due-date-reminders/cron|_next/static|_next/image|favicon.ico|icon.png|logo-horizontal-blue.png|logo-horizontal-white.png|logo-shield-blue.png|logo-shield-white.png).*)",
```

- [ ] **Step 11: Check for and update/create the cron route test**

Run `ls app/api/admin/notifications/due-date-reminders/cron/` to check whether `route.test.ts` already exists.
- If it exists: extend it to mock `sendOverdueNotifications` alongside `sendDueDateReminders` and assert the merged-result shape.
- If it doesn't: write one following the sibling pattern in `app/api/admin/entra-sync/cron/route.test.ts` (bearer-token accepted/rejected cases), with both sweep functions mocked.

- [ ] **Step 12: Run the cron route test**

Run: `npx vitest run app/api/admin/notifications/due-date-reminders/cron/route.test.ts`
Expected: PASS

- [ ] **Step 13: Commit**

```bash
git add lib/mail/notifications.ts lib/mail/notifications.test.ts lib/mail/due-date-reminders.ts lib/mail/due-date-reminders.test.ts app/api/admin/notifications/due-date-reminders/cron/route.ts app/api/admin/notifications/due-date-reminders/cron/route.test.ts proxy.ts
git commit -m "feat: add overdue notification sweep and fix cron route auth-bypass gap"
```

---

## Task 5: Broadcast creation

**Files:**
- Create: `lib/notifications/broadcast.ts`
- Test: `lib/notifications/broadcast.test.ts`

**Interfaces:**
- Consumes: `createNotification` (Task 2), `notificationBroadcasts`/`notifications`/`users` (schema, Task 1).
- Produces: `createBroadcast(input: CreateBroadcastInput): Promise<CreateBroadcastResult>` where `CreateBroadcastInput = { authorEmail: string; title: string; body: string; targetScope: "all" | "department"; targetDepartmentId?: string | null }` and `CreateBroadcastResult = { broadcastId: string; recipientCount: number }`. This function trusts its caller already authorized `authorEmail` for the given scope/department — see Task 7 for where that check lives.

- [ ] **Step 1: Write the failing tests**

```ts
// lib/notifications/broadcast.test.ts
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users, departments, notifications, notificationBroadcasts } from "@/lib/db/schema";
import { createBroadcast } from "./broadcast";

describe("createBroadcast", () => {
  it("fans out one notification per active user for scope 'all', skipping inactive users", async () => {
    const active = await db.insert(users).values({ email: `bc-active-${randomUUID()}@example.com`, displayName: "Active" }).returning();
    const inactive = await db.insert(users).values({ email: `bc-inactive-${randomUUID()}@example.com`, displayName: "Inactive", isActive: false }).returning();
    try {
      const result = await createBroadcast({ authorEmail: "org-admin@example.com", title: "Heads up", body: "System maintenance tonight", targetScope: "all" });
      expect(result.recipientCount).toBe(1);
      const rows = await db.select().from(notifications).where(eq(notifications.broadcastId, result.broadcastId));
      expect(rows).toHaveLength(1);
      expect(rows[0].userId).toBe(active[0].id);
    } finally {
      await db.delete(notifications).where(eq(notifications.userId, active[0].id));
      await db.delete(notificationBroadcasts).where(eq(notificationBroadcasts.authorEmail, "org-admin@example.com"));
      await db.delete(users).where(eq(users.id, active[0].id));
      await db.delete(users).where(eq(users.id, inactive[0].id));
    }
  });

  it("scopes to a department's active members for scope 'department'", async () => {
    const [dept] = await db.insert(departments).values({ name: `BC Dept ${randomUUID()}` }).returning();
    const [member] = await db.insert(users).values({ email: `bc-member-${randomUUID()}@example.com`, displayName: "Member", departmentId: dept.id }).returning();
    const [outsider] = await db.insert(users).values({ email: `bc-outsider-${randomUUID()}@example.com`, displayName: "Outsider" }).returning();
    try {
      const result = await createBroadcast({ authorEmail: "dept-admin@example.com", title: "Dept update", body: "New policy", targetScope: "department", targetDepartmentId: dept.id });
      expect(result.recipientCount).toBe(1);
      const rows = await db.select().from(notifications).where(eq(notifications.broadcastId, result.broadcastId));
      expect(rows.map((r) => r.userId)).toEqual([member.id]);
    } finally {
      await db.delete(notifications).where(eq(notifications.userId, member.id));
      await db.delete(notificationBroadcasts).where(eq(notificationBroadcasts.authorEmail, "dept-admin@example.com"));
      await db.delete(users).where(eq(users.id, member.id));
      await db.delete(users).where(eq(users.id, outsider.id));
      await db.delete(departments).where(eq(departments.id, dept.id));
    }
  });

  it("succeeds with zero recipients for a department with no active members", async () => {
    const [dept] = await db.insert(departments).values({ name: `Empty Dept ${randomUUID()}` }).returning();
    try {
      const result = await createBroadcast({ authorEmail: "dept-admin@example.com", title: "t", body: "b", targetScope: "department", targetDepartmentId: dept.id });
      expect(result.recipientCount).toBe(0);
      await db.delete(notificationBroadcasts).where(eq(notificationBroadcasts.id, result.broadcastId));
    } finally {
      await db.delete(departments).where(eq(departments.id, dept.id));
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/notifications/broadcast.test.ts`
Expected: FAIL (`Cannot find module './broadcast'`)

- [ ] **Step 3: Implement `createBroadcast` in `lib/notifications/broadcast.ts`**

```ts
export interface CreateBroadcastInput {
  authorEmail: string;
  title: string;
  body: string;
  targetScope: "all" | "department";
  targetDepartmentId?: string | null;
}

export interface CreateBroadcastResult {
  broadcastId: string;
  recipientCount: number;
}

export async function createBroadcast(input: CreateBroadcastInput): Promise<CreateBroadcastResult>
```

Insert one `notificationBroadcasts` row first (with `returning()` for its `id`). Resolve recipients: `targetScope === "all"` → `db.select({ id: users.id }).from(users).where(eq(users.isActive, true))`; `targetScope === "department"` → add `eq(users.departmentId, input.targetDepartmentId)` to that same `WHERE`. For each recipient, call `createNotification({ userId: recipient.id, type: "admin_broadcast", title: input.title, body: input.body, broadcastId: broadcast.id })` (sequential loop — same "intentionally simple" posture as the existing sweep loops). Return `{ broadcastId: broadcast.id, recipientCount: recipients.length }`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/notifications/broadcast.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/notifications/broadcast.ts lib/notifications/broadcast.test.ts
git commit -m "feat: add broadcast creation with org-wide/department fan-out"
```

---

## Task 6: Personal notification API routes

**Files:**
- Create: `app/api/notifications/route.ts`
- Create: `app/api/notifications/[id]/read/route.ts`
- Create: `app/api/notifications/read-all/route.ts`
- Test: `app/api/notifications/route.test.ts`
- Test: `app/api/notifications/[id]/read/route.test.ts`
- Test: `app/api/notifications/read-all/route.test.ts`

**Interfaces:**
- Consumes: `listNotificationsForUser`, `countUnreadNotifications`, `markNotificationRead`, `markAllNotificationsRead` (Task 2), `getUserIdByEmail` (`lib/db/users.ts`, unchanged), `auth` (`@/auth`), `isUuid`/`badRequest`/`serverError` (`lib/api/errors.ts`, unchanged).
- Produces: `GET /api/notifications` → `{ notifications: NotificationRow[]; unreadCount: number }`. `PATCH /api/notifications/:id/read` → `{ ok: true }`. `PATCH /api/notifications/read-all` → `{ ok: true }`.

- [ ] **Step 1: Write the failing test for `GET /api/notifications`**

```ts
// app/api/notifications/route.test.ts
import { describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users, notifications } from "@/lib/db/schema";
import { auth } from "@/auth";
import { GET } from "./route";

vi.mock("@/auth", () => ({ auth: vi.fn() }));

describe("GET /api/notifications", () => {
  it("returns the signed-in user's notifications and unread count", async () => {
    const [user] = await db.insert(users).values({ email: `api-notif-${randomUUID()}@example.com`, displayName: "API User" }).returning();
    vi.mocked(auth).mockResolvedValue({ user: { email: user.email } } as never);
    try {
      await db.insert(notifications).values({ userId: user.id, type: "due_soon", title: "t", body: "b" });
      const response = await GET();
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.notifications).toHaveLength(1);
      expect(body.unreadCount).toBe(1);
    } finally {
      await db.delete(notifications).where(eq(notifications.userId, user.id));
      await db.delete(users).where(eq(users.id, user.id));
    }
  });

  it("returns 401 when not signed in", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    const response = await GET();
    expect(response.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/api/notifications/route.test.ts`
Expected: FAIL (`Cannot find module './route'`)

- [ ] **Step 3: Implement `GET` in `app/api/notifications/route.ts`**

```ts
export async function GET(): Promise<NextResponse>
```

`auth()` → if no `session?.user?.email`, `401`. `getUserIdByEmail(email)` → if `null`, `401`. Otherwise `Promise.all([listNotificationsForUser(userId), countUnreadNotifications(userId)])`, respond `{ notifications, unreadCount }`. Wrap in try/catch → `serverError(error)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/api/notifications/route.test.ts`
Expected: PASS

- [ ] **Step 5: Write the failing test for `PATCH /api/notifications/:id/read`**

```ts
// app/api/notifications/[id]/read/route.test.ts
import { describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users, notifications } from "@/lib/db/schema";
import { auth } from "@/auth";
import { PATCH } from "./route";

vi.mock("@/auth", () => ({ auth: vi.fn() }));

describe("PATCH /api/notifications/:id/read", () => {
  it("marks the caller's own notification read", async () => {
    const [user] = await db.insert(users).values({ email: `read-${randomUUID()}@example.com`, displayName: "Reader" }).returning();
    vi.mocked(auth).mockResolvedValue({ user: { email: user.email } } as never);
    try {
      const [note] = await db.insert(notifications).values({ userId: user.id, type: "due_soon", title: "t", body: "b" }).returning();
      const response = await PATCH({} as never, { params: Promise.resolve({ id: note.id }) });
      expect(response.status).toBe(200);
      const [row] = await db.select().from(notifications).where(eq(notifications.id, note.id));
      expect(row.readAt).not.toBeNull();
    } finally {
      await db.delete(notifications).where(eq(notifications.userId, user.id));
      await db.delete(users).where(eq(users.id, user.id));
    }
  });

  it("returns 400 for a non-UUID id", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { email: "x@example.com" } } as never);
    const response = await PATCH({} as never, { params: Promise.resolve({ id: "not-a-uuid" }) });
    expect(response.status).toBe(400);
  });
});
```

Before writing this step, run `grep -r "params: Promise" app/api/admin/courses/[courseId]/route.ts` to confirm this Next.js version's exact dynamic-route handler signature (async `params` vs sync) and match it exactly rather than guessing.

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run "app/api/notifications/[id]/read/route.test.ts"`
Expected: FAIL (`Cannot find module './route'`)

- [ ] **Step 7: Implement `PATCH` in `app/api/notifications/[id]/read/route.ts`**

Auth + `getUserIdByEmail` same as Task 6 Step 3. Validate `id` with `isUuid` → `badRequest` if not. Call `markNotificationRead(id, userId)`. Respond `{ ok: true }`. No existence check needed — `markNotificationRead` already no-ops safely per Task 2.

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run "app/api/notifications/[id]/read/route.test.ts"`
Expected: PASS

- [ ] **Step 9: Write the failing test for `PATCH /api/notifications/read-all`, then implement it**

Mirror Steps 5-8 for `app/api/notifications/read-all/route.ts`, calling `markAllNotificationsRead(userId)` with no `id` param. Assert via `countUnreadNotifications` dropping to 0 after the call.

Run: `npx vitest run app/api/notifications/read-all/route.test.ts`
Expected: FAIL, then PASS after implementing.

- [ ] **Step 10: Commit**

```bash
git add app/api/notifications
git commit -m "feat: add personal notification list/read API routes"
```

---

## Task 7: Admin broadcast API route

**Files:**
- Create: `app/api/admin/notifications/broadcast/route.ts`
- Test: `app/api/admin/notifications/broadcast/route.test.ts`

**Interfaces:**
- Consumes: `createBroadcast` (Task 5), `getDepartmentAdminDepartmentIds` (`lib/db/department-admins.ts`, unchanged), `isOrgAdmin` (`lib/roles.ts`, unchanged), `getUserIdByEmail` (`lib/db/users.ts`, unchanged), `isUuid`/`badRequest`/`serverError` (`lib/api/errors.ts`).
- Produces: `POST /api/admin/notifications/broadcast` → `{ broadcastId: string; recipientCount: number }` on success; `400`/`403` on validation/permission failure.

- [ ] **Step 1: Write the failing tests**

```ts
// app/api/admin/notifications/broadcast/route.test.ts
import { describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users, departments, departmentAdmins, notifications, notificationBroadcasts } from "@/lib/db/schema";
import { auth } from "@/auth";
import { POST } from "./route";

vi.mock("@/auth", () => ({ auth: vi.fn() }));

function jsonRequest(body: unknown) {
  return { json: async () => body } as never;
}

describe("POST /api/admin/notifications/broadcast", () => {
  it("lets an OrgAdmin broadcast to all users", async () => {
    const [admin] = await db.insert(users).values({ email: `org-admin-${randomUUID()}@example.com`, displayName: "Org Admin" }).returning();
    vi.mocked(auth).mockResolvedValue({ user: { email: admin.email, roles: ["OrgAdmin"] } } as never);
    try {
      const response = await POST(jsonRequest({ title: "t", body: "b", targetScope: "all" }));
      expect(response.status).toBe(200);
      const payload = await response.json();
      await db.delete(notifications).where(eq(notifications.broadcastId, payload.broadcastId));
      await db.delete(notificationBroadcasts).where(eq(notificationBroadcasts.id, payload.broadcastId));
    } finally {
      await db.delete(users).where(eq(users.id, admin.id));
    }
  });

  it("rejects a DepartmentAdmin broadcasting with scope 'all'", async () => {
    const [admin] = await db.insert(users).values({ email: `dept-admin-${randomUUID()}@example.com`, displayName: "Dept Admin" }).returning();
    vi.mocked(auth).mockResolvedValue({ user: { email: admin.email, roles: ["DepartmentAdmin"] } } as never);
    try {
      const response = await POST(jsonRequest({ title: "t", body: "b", targetScope: "all" }));
      expect(response.status).toBe(403);
    } finally {
      await db.delete(users).where(eq(users.id, admin.id));
    }
  });

  it("rejects a DepartmentAdmin targeting a department they do not administer", async () => {
    const [admin] = await db.insert(users).values({ email: `dept-admin2-${randomUUID()}@example.com`, displayName: "Dept Admin" }).returning();
    const [dept] = await db.insert(departments).values({ name: `Foreign Dept ${randomUUID()}` }).returning();
    vi.mocked(auth).mockResolvedValue({ user: { email: admin.email, roles: ["DepartmentAdmin"] } } as never);
    try {
      const response = await POST(jsonRequest({ title: "t", body: "b", targetScope: "department", targetDepartmentId: dept.id }));
      expect(response.status).toBe(403);
    } finally {
      await db.delete(users).where(eq(users.id, admin.id));
      await db.delete(departments).where(eq(departments.id, dept.id));
    }
  });

  it("lets a DepartmentAdmin broadcast to a department they administer", async () => {
    const [admin] = await db.insert(users).values({ email: `dept-admin3-${randomUUID()}@example.com`, displayName: "Dept Admin" }).returning();
    const [dept] = await db.insert(departments).values({ name: `Own Dept ${randomUUID()}` }).returning();
    await db.insert(departmentAdmins).values({ userId: admin.id, departmentId: dept.id });
    vi.mocked(auth).mockResolvedValue({ user: { email: admin.email, roles: ["DepartmentAdmin"] } } as never);
    try {
      const response = await POST(jsonRequest({ title: "t", body: "b", targetScope: "department", targetDepartmentId: dept.id }));
      expect(response.status).toBe(200);
      const payload = await response.json();
      await db.delete(notificationBroadcasts).where(eq(notificationBroadcasts.id, payload.broadcastId));
    } finally {
      await db.delete(departmentAdmins).where(eq(departmentAdmins.userId, admin.id));
      await db.delete(users).where(eq(users.id, admin.id));
      await db.delete(departments).where(eq(departments.id, dept.id));
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run app/api/admin/notifications/broadcast/route.test.ts`
Expected: FAIL (`Cannot find module './route'`)

- [ ] **Step 3: Implement `POST` in `app/api/admin/notifications/broadcast/route.ts`**

```ts
export async function POST(request: NextRequest): Promise<NextResponse>
```

Parse JSON body (bad-JSON → `badRequest`, matching `app/api/admin/department-admins/route.ts`'s pattern). Validate `title`/`body` are non-empty strings, `targetScope` is `"all"` or `"department"`, and if `"department"`, `targetDepartmentId` is a UUID (`isUuid`) — `badRequest` otherwise. `auth()` → if no session email, `403` ("Admin role required", matching the existing in-handler-recheck convention; the proxy already gates `/api/admin/*` to some admin tier). If `targetScope === "all"` and `!isOrgAdmin(session.user.roles)` → `403`. If `targetScope === "department"` and `!isOrgAdmin(...)`: call `getUserIdByEmail(session.user.email)`, then `getDepartmentAdminDepartmentIds(userId)`, and `403` if `targetDepartmentId` isn't in that list. Otherwise call `createBroadcast({ authorEmail: session.user.email, title, body, targetScope, targetDepartmentId })` and return its result as JSON. Wrap in try/catch → `serverError`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run app/api/admin/notifications/broadcast/route.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/notifications/broadcast
git commit -m "feat: add admin broadcast API route with org/department scope checks"
```

---

## Task 8: Header bell + dashboard feed

**Files:**
- Modify: `components/shell/app-shell.tsx` (add bell dropdown to the header, around line 268)
- Modify: `app/(app)/page.tsx` (swap the mock `updates` import for a real fetch)
- Delete: `lib/mock-data/updates.ts`

**Interfaces:**
- Consumes: `GET /api/notifications` (Task 6).

- [ ] **Step 1: Add a `NotificationBell` client component**

Create `components/shell/notification-bell.tsx`: a client component that fetches `GET /api/notifications?limit=10` on mount, renders a `Bell` icon (`lucide-react`, already imported pattern in `app-shell.tsx`) wrapped in the existing `DropdownMenu`/`DropdownMenuTrigger`/`DropdownMenuContent`/`DropdownMenuItem` components (`components/ui/dropdown-menu.tsx`, no new dependency), with a `Badge` (`components/ui/badge.tsx`) showing `unreadCount` when `> 0`. Each item: click → `PATCH /api/notifications/:id/read`, then `router.push(linkHref)` if present, and update local state to decrement the badge. Include a "Mark all read" item calling `PATCH /api/notifications/read-all`.

- [ ] **Step 2: Mount it in `app-shell.tsx`**

In the header's right-hand `<div className="flex items-center gap-3">` block (line 268), add `<NotificationBell />` before the `<Avatar>`, only when `isAuthenticated`.

- [ ] **Step 3: Swap the dashboard "Updates" card to real data**

In `app/(app)/page.tsx`, remove the `import { updates, type UpdateType } from "@/lib/mock-data/updates"` line and the `updateIcon` record's reliance on that type. Fetch the current user's notifications server-side (this is already an async server component — call `listNotificationsForUser(userId)` directly from `lib/notifications/queries.ts`, same pattern as the existing `listEnrolledPublishedCourses` call a few lines above, rather than fetching its own API route). Map each `NotificationRow.type` to an icon using the same `Record<string, typeof Bell>` shape as today's `updateIcon`, covering `course_assigned | due_soon | overdue | admin_broadcast`. Render title/body/createdAt in place of the old title/description/date fields, and `linkHref` in place of `courseId`-derived links.

- [ ] **Step 4: Delete the mock-data file**

Run: `rm lib/mock-data/updates.ts`, then `grep -r "mock-data/updates" --include="*.ts*" .` to confirm nothing else references it.

- [ ] **Step 5: Manual verification**

Start the dev server, sign in, confirm: the bell shows the current unread count, opening it lists recent notifications, clicking one marks it read and navigates, "mark all read" zeroes the badge, and the dashboard "Updates" card renders real rows (or an empty state) instead of the four hardcoded fake entries. (No automated frontend test exists in this repo for comparable dashboard cards — this mirrors that existing gap, consistent with the spec's Testing section.)

- [ ] **Step 6: Commit**

```bash
git add components/shell/notification-bell.tsx components/shell/app-shell.tsx "app/(app)/page.tsx"
git rm lib/mock-data/updates.ts
git commit -m "feat: add notification bell and wire dashboard Updates card to real data"
```

---

## Task 9: Admin broadcast compose page

**Files:**
- Create: `app/(app)/admin/notifications/page.tsx`
- Modify: `components/shell/app-shell.tsx:41-68` (add a nav entry to `orgAdminNav` and `departmentAdminNav`)

**Interfaces:**
- Consumes: `POST /api/admin/notifications/broadcast` (Task 7).

- [ ] **Step 1: Add the nav entry**

In `components/shell/app-shell.tsx`, add `{ href: "/admin/notifications", label: "Notifications", icon: Bell }` to both `orgAdminNav` and `departmentAdminNav` arrays (import `Bell` from `lucide-react` alongside the other icons already imported there). Placement: after "Reports", before "Department" — matches the existing ordering of admin-capability tabs before people-scoped tabs.

- [ ] **Step 2: Build the compose page**

Create `app/(app)/admin/notifications/page.tsx` as a client component: a form with a title `Input`, a body `Textarea`, a scope `Select` (`components/ui/select.tsx`) offering "All users" / "A department", and — only when "A department" is selected — a department picker. For an OrgAdmin, fetch the full department list (reuse whatever existing endpoint already lists departments for `/admin/org`, e.g. `GET /api/admin/departments` — confirm its exact path and response shape by reading `app/(app)/admin/org/page.tsx` before wiring this up). For a DepartmentAdmin, the picker is restricted to the departments returned by whatever existing endpoint already powers their `/admin/department` page scoping (check that page before adding a new endpoint — do not duplicate `getDepartmentAdminDepartmentIds` behind a second API route if one already exposes it). On submit, `POST /api/admin/notifications/broadcast` with `{ title, body, targetScope, targetDepartmentId }`; show the resulting `recipientCount` on success, or the error message on a `400`/`403`.

- [ ] **Step 3: Manual verification**

As an OrgAdmin test-role: compose a broadcast to "All users", confirm the recipient count matches the active-user count and a test recipient's bell/dashboard shows it. As a DepartmentAdmin test-role: confirm only their own department(s) are selectable, and that submitting without a department selected is blocked client-side.

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/admin/notifications" components/shell/app-shell.tsx
git commit -m "feat: add admin broadcast compose page"
```
