# Department Management — Design

**Status:** Approved 2026-09-08, not yet implemented.

## Goal

Give Org Admin a real Departments feature: a list of departments, create new ones, and manage which signed-in users belong to which department. Replace the free-text `department` field on the course builder with a dropdown sourced from real departments.

## Context

`Database Design.md` §1 (Identity/RBAC) already designed `users`/`departments`/`user_roles` back on 2026-08-31, but none of it has been built — the app has no local `users` table at all today. Role checking (`lib/roles.ts`) reads only the Entra `roles` claim per-request (`Learner`/`DepartmentAdmin`/`OrgAdmin` → generic `Learner`/`Admin`), with no department scoping anywhere.

`courses.department` (added in the course-authoring work, 2026-09-02) is free text — the same six names (`Compliance`, `HR`, `Underwriting`, `Claims`, `IT`, `Engineering`) already appear consistently across `lib/mock-data/courses.ts` and `lib/mock-data/reporting.ts`, so a real, constrained department list has an obvious seed set.

`/admin/org` is currently 100% mock: a hardcoded `admins` array and the mock `departmentCompletion` reporting table, no DB reads at all.

## Non-Goals (explicitly deferred)

- **`user_roles` per-department admin scoping.** Confirmed with Ian: this pass builds `departments` + `users.department_id` (roster/reporting membership) only. Any `DepartmentAdmin`/`OrgAdmin` can manage any department — real per-department lockdown (a dept admin restricted to only their own department) is a later slice.
- **Manual user pre-provisioning.** Users only exist in the local `users` table after their first real sign-in (upserted from the Entra session). No "invite by email before they've logged in" flow.
- **Entra group sync.** `departments.entra_group_id` exists as a column (matches the original vault design) but nothing reads or writes it yet — purely reserved for a future sync.
- **Department Completion Summary reporting.** Stays on mock data (`departmentCompletion`) — that's enrollment/progress reporting, a separate, larger integration than roster CRUD.
- **Deleting a department.** Only create is in scope. Deleting raises reassignment questions (what happens to its users/courses) that don't need answering to ship the roster/dropdown feature.

## Design

### 1. Data model

Two new tables, plus one column swap on `courses`:

```ts
export const departments = pgTable("departments", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  entraGroupId: text("entra_group_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  entraObjectId: text("entra_object_id").notNull().unique(),
  email: text("email").notNull().unique(),
  displayName: text("display_name").notNull(),
  departmentId: uuid("department_id").references(() => departments.id, { onDelete: "set null" }),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
```

`courses.department` (text) becomes `courses.departmentId`:

```ts
department: text("department"), // removed
departmentId: uuid("department_id").references(() => departments.id, { onDelete: "set null" }), // added
```

**Migration sequence** (one Drizzle migration):
1. Create `departments`, seed it with the six existing mock names (`Compliance`, `HR`, `Underwriting`, `Claims`, `IT`, `Engineering`).
2. Create `users` (empty — populated by sign-in upsert going forward).
3. Add `courses.department_id` nullable.
4. Backfill: for each existing course, case-insensitively match its `department` text against the new `departments.name` and set `department_id` accordingly; leave `department_id` null if there's no match (an admin re-picks it from the dropdown).
5. Drop `courses.department` (text column). No dual-column fallback — hard cutover, matching this codebase's existing no-back-compat-shim posture.

Same versioning/hardening posture as the rest of `lib/db/schema.ts` — no RLS, no Cloud SQL-specific changes here (still Supabase free tier per current hosting plan).

### 2. Sign-in upsert

`auth.ts`'s existing `jwt` callback gains a DB upsert, keyed on `entra_object_id` (the Entra `oid` claim, already the callback's real join key per the original vault design):

```ts
async jwt({ token, profile }) {
  if (profile?.roles) {
    token.roles = profile.roles as string[];
  }
  if (profile?.oid) {
    await upsertUser({
      entraObjectId: profile.oid as string,
      email: profile.email as string,
      displayName: profile.name as string,
    });
  }
  return token;
},
```

`upsertUser` (new, in `lib/db/users.ts`): insert-or-update on `entra_object_id` conflict, refreshing `email`/`display_name`/`updated_at` every login. **Never touches `department_id`** on an existing row — that's admin-owned state, not something a login should reset.

A DB failure here must not block sign-in — wrap in try/catch, log, let the session proceed. (Matches the existing "DB blip must not crash a request" posture from the 2026-09-03 resilience fix in `lib/db/client.ts`.)

### 3. Org Admin UI

**`/admin/org`** (replacing the current fully-mock page):
- Real departments list (name, member count) queried via a new `listDepartmentsWithCounts()` in `lib/db/departments.ts`, replacing the hardcoded `admins` array
- "New Department" — a dialog, name only, `POST /api/admin/departments`
- Each row links to its detail page
- Department Completion Summary card is untouched (stays on `departmentCompletion` mock data — see Non-Goals)

**`/admin/org/departments/[id]`** (new page):
- Member roster: users where `department_id` = this department (name, email)
- "Add user" — a searchable select of users NOT currently in this department (any `users` row with a different or null `department_id`), `PATCH /api/admin/departments/[id]/members` moving a user in
- Remove (per row) — sets that user's `department_id` to null, same PATCH endpoint or a sibling DELETE
- Department name shown, no rename in this pass (not asked for, YAGNI)

Both new API routes gated by the existing `lib/auth/admin-gate.ts` (the same module `proxy.ts` already applies to every other `/api/admin/*` route since the 2026-09-03 Critical fix — new routes must not repeat that gap).

### 4. Content upload / course builder

`components/shell` unaffected. In `app/(app)/admin/content/builder/[courseId]/builder-client.tsx`, the free-text department `Input` (lines ~334-340 today) becomes a `Select` populated from `listDepartments()` (id + name), storing `departmentId` instead of a free string. `updateField`/`patchDetails` calls follow the same on-blur/on-change autosave pattern already in place, just swapping the field name and value type.

`lib/db/course-authoring.ts`: `CourseDetailsUpdate.department?: string | null` becomes `departmentId?: string | null`; `updateCourseDetails` swaps the corresponding column write.

`lib/db/queries.ts` (course list for `/admin/content` and `/courses`): joins `departments` to resolve `departmentId` → display name, replacing the current raw `course.department ?? "General"` read. "General" stays as the fallback label when `departmentId` is null.

## Testing

Matches this repo's existing Vitest conventions (`*.test.ts` beside the module, real-behavior tests over mocks where DB access is involved, per the course-authoring and video pipeline slices):
- `lib/db/departments.ts` — create, list-with-counts, add/remove member, uniqueness-on-name constraint
- `lib/db/users.ts` — upsert insert path, upsert update path (email/display_name change, department_id preserved)
- `lib/auth/admin-gate.ts` reuse on the two new routes — no new gate logic, but a route-level test confirming a non-admin gets 403 (same pattern as the existing course-authoring admin-gate tests)
- Migration backfill: a test seeding a pre-migration-shaped course row and asserting correct `department_id` resolution (exact-name match, case-insensitive match, no-match-leaves-null)

## Open follow-ups (not blockers for this slice)

- [ ] `user_roles` junction + real per-department admin scoping (deferred, see Non-Goals)
- [ ] Manual user pre-provisioning / invite flow (deferred, see Non-Goals)
- [ ] Department rename / delete
- [ ] Wire `departmentCompletion` reporting to real enrollment/progress data instead of mock
- [ ] `entra_group_id` sync, if SSP ever wants Entra security groups to drive department membership automatically

## Related

- `Database Design.md` §1 (Identity/RBAC) in the Obsidian vault — original table shapes this spec builds a scoped-down first slice of
- `docs/superpowers/specs/2026-09-02-course-authoring-design.md` — established the admin-gate-on-API-routes precedent this spec reuses
