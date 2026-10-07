# Notifications / Update System — Design

**Status:** Draft, pending user review
**Author:** Claude (with Ian Harrison)
**Date:** 2026-10-07

## Problem

Today the app's only "notification" surface is email, fired from two places: `assignCourse()` on course assignment, and a daily cron for due-soon reminders (both shipped 2026-10-05; see `Database Design.md` in the vault and commit `e91e9e1`). There is no persisted, in-app notification record — nothing a user can read, mark read, or browse historically inside the app itself.

The dashboard's "Updates" card (`app/(app)/page.tsx:173`) is wired to `lib/mock-data/updates.ts`, a hardcoded fake feed. The Settings page has four notification-preference toggles (due reminders, new assignment, weekly digest, quiz results) that are UI-only — they persist nothing and gate nothing.

There is also no way for an admin to send a one-off custom message to users — every existing notification is system-triggered from a fixed set of events.

## Goals

1. A persisted, per-user notification record: `course_assigned`, `due_soon`, `overdue`, `admin_broadcast`, with read/unread state.
2. Fold "overdue" into the existing due-date cron as a second sweep alongside the existing due-soon sweep, using the same dedupe-flag pattern.
3. A custom-broadcast feature: OrgAdmin can message all users or a specific department; DepartmentAdmin can message only department(s) they administer (per the existing `department_admins` link table from the RBAC design). In-app only, no email.
4. Replace the dashboard mock "Updates" feed and add a header bell with unread-count badge, both reading from the same real data.
5. Unify email + in-app writes behind single trigger functions so there's one call site per event type, not two parallel paths to keep in sync.

## Non-goals (out of scope for this pass)

- Wiring the Settings page notification toggles to anything real. That needs a per-user preference table and gating logic on every send path — real scope on its own, deferred as a follow-up once this core system lands.
- Email delivery for admin broadcasts. In-app only; avoids an admin accidentally mass-emailing hundreds of people through a UI meant for quick updates.
- Any multi-tenant / cross-org notion of "org" — this app is single-tenant; "OrgAdmin" already means "admin of the whole company," not scoped to a tenant row.
- Expiry/archival of old notifications. Persisted indefinitely; at this app's scale (single-tenant, modest per-department user counts) a prune job isn't justified yet.
- Individual-user targeting for broadcasts (only "all" or "department" scope). Can be added later without a schema break (broadcast target columns are additive).

## Architecture: fan-out-on-write

Every notification is a row in a single `notifications` table, always keyed by the recipient's `user_id` — including broadcasts, which insert one row per resolved recipient at send time.

The alternative, fan-out-on-read (one row per *event*, with a target-scope column, resolved against department membership at query time), would save writes for large broadcasts but forces every read query — bell dropdown, dashboard feed, unread count — to join against department membership and anti-join against a separate reads table. Given this app's scale (single-tenant, departments realistically in the dozens-to-low-hundreds of users), the extra writes from fan-out-on-write are trivial, and a single uniform table with a plain `WHERE user_id = ? AND read_at IS NULL` query is worth the simplicity.

## Data model

### New table: `notifications`

```ts
export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: varchar("type", { length: 32 }).notNull(), // course_assigned | due_soon | overdue | admin_broadcast
  title: text("title").notNull(),
  body: text("body").notNull(),
  linkHref: text("link_href"),
  readAt: timestamp("read_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  broadcastId: integer("broadcast_id").references(() => notificationBroadcasts.id),
});
```

### New table: `notification_broadcasts`

```ts
export const notificationBroadcasts = pgTable("notification_broadcasts", {
  id: serial("id").primaryKey(),
  authorId: integer("author_id").notNull().references(() => users.id),
  title: text("title").notNull(),
  body: text("body").notNull(),
  targetScope: varchar("target_scope", { length: 16 }).notNull(), // all | department
  targetDepartmentId: integer("target_department_id").references(() => departments.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
```

Each recipient's `notifications` row for a broadcast carries `type: "admin_broadcast"` and `broadcast_id` pointing back to the parent — lets an admin later see "sent to N, M read" without a text-match scan, and keeps `title`/`body` denormalized onto the per-recipient row (consistent with the other three types, simpler reads).

### Schema addition: `enrollments.overdue_notified_at`

```ts
overdueNotifiedAt: timestamp("overdue_notified_at"),
```

Mirrors the existing `due_reminder_sent_at` (added in migration `0018`). Dedupes the new overdue sweep the same way the due-soon sweep is already deduped — set once fired, left unset on failure so the next day's run retries.

## Trigger layer (new `lib/notifications/`)

- **`create.ts`** — `createNotification({ userId, type, title, body, linkHref?, broadcastId? })`. Single insert helper; every other function in this module funnels through it.
- **`course-assigned.ts`** — `notifyCourseAssigned(userId, courseId, assignedBy)`: calls `createNotification(...)`, then the existing `sendCourseAssignedEmail`. Replaces the direct email call inside `assignCourse()` (`lib/db/course-assignments.ts:64`) so the single convergence point for direct/bulk/auto-pickup assignment stays single — it now fires one notification function instead of one email function.
- **`due-date-sweep.ts`** — extends the existing `sendDueDateReminders()` (`lib/mail/due-date-reminders.ts:26`) with a second pass in the same daily cron run:
  - Due-soon pass (existing, 3-day window): now also calls `createNotification(type: "due_soon")` alongside the existing email, still gated by `due_reminder_sent_at`.
  - Overdue pass (new): enrollments where `due_at < now`, status incomplete, still active, `overdue_notified_at` null → `createNotification(type: "overdue")` + email, then stamp `overdue_notified_at`.
- **`broadcast.ts`** — `createBroadcast(authorId, { title, body, targetScope, targetDepartmentId? })`:
  - Permission check: OrgAdmin may use either scope with any department; DepartmentAdmin must pass `targetScope: "department"` with a `targetDepartmentId` they actually administer (checked against `department_admins`), otherwise reject.
  - Resolve recipients: `all` → every active user; `department` → `users.departmentId = targetDepartmentId`, active only.
  - Insert one `notification_broadcasts` row, then bulk-insert one `notifications` row per recipient with `broadcastId` set. No email.

## API routes

- `GET /api/notifications` — current user's rows, paginated, newest first. Backs both the header bell dropdown and the dashboard feed.
- `PATCH /api/notifications/:id/read` — mark one row read. Scoped `WHERE id = ? AND user_id = currentUser`; 0 rows affected is a silent no-op (not an error — avoids leaking whether a given id belongs to someone else).
- `PATCH /api/notifications/read-all` — bulk mark read for current user.
- `POST /api/admin/notifications/broadcast` — compose/send. Gated by `requiresAdminRole()` in `proxy.ts` plus an in-handler `isOrgAdmin`/department-scope recheck, matching the existing defense-in-depth pattern in `app/api/admin/users/route.ts:14`.
- The due-date cron route (`app/api/admin/notifications/due-date-reminders/cron/route.ts`) keeps its location and `CRON_SECRET` bearer-auth pattern; its handler body grows to run both sweeps.

## Frontend

- Header bell icon + unread-count `Badge` in `components/shell/app-shell.tsx` (header block around line 216, alongside the existing role-switcher and avatar). Dropdown lists recent rows; clicking marks read and navigates `link_href`.
- Dashboard "Updates" card (`app/(app)/page.tsx:173`) switches from `lib/mock-data/updates.ts` to a real fetch against `/api/notifications`; the mock-data file is deleted once nothing else references it.
- New admin page for composing a broadcast (title, body, scope picker — department picker only shown/selectable per the composer's own role), added to the existing `orgAdminNav` / `departmentAdminNav` arrays (`components/shell/app-shell.tsx:36-68`) following the current nav-item convention.

## Permissions and edge cases

- DepartmentAdmin broadcast missing `targetDepartmentId`, or naming a department they don't administer: reject with 403.
- Broadcast to a department with zero active users: allowed, inserts zero rows, not an error.
- Mark-read on an id that isn't the caller's: silent no-op (see API section).
- Inactive (`is_active = false`) users: excluded from broadcast fan-out and from both due-date sweep passes, matching the existing due-soon cron's active-user filter.
- Course/enrollment deleted after a notification exists: `link_href` may 404; acceptable — a notification is a historical record, not a live reference, so no cascade cleanup is needed beyond the `user_id` FK's `onDelete: cascade`.
- Cron idempotency: reruns stay safe because both `due_reminder_sent_at` and the new `overdue_notified_at` gate their respective inserts, same mechanism as today.
- `proxy.ts`'s auth-bypass matcher currently excludes `api/admin/entra-sync/cron` but (per repo scan) may not cleanly exclude the due-date cron route — this is a pre-existing condition, not something this change introduces, but worth confirming during implementation since the route's responsibilities are growing.

## Testing

- Unit: `createNotification`; due-date sweep's two passes (due-soon vs overdue) including dedupe-flag behavior; `createBroadcast` permission/scope resolution (OrgAdmin-all, OrgAdmin-department, DepartmentAdmin-own-department, DepartmentAdmin-foreign-department-rejected).
- Integration: `assignCourse()` still produces exactly one notification + one email per assignment across all three call paths (direct, bulk, auto-pickup-on-department-join).
- API route tests: read, read-all, broadcast authorization rejection cases, pagination.
- No new e2e coverage — the repo scan found no existing e2e harness, so this stays consistent with current practice. Manual verification: bell badge count and dashboard feed against real data, replacing the mock-data path.
