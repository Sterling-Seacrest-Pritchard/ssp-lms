# Department Admin / Org Admin RBAC — Design

**Status:** Draft, pending user review
**Author:** Claude (with Ian Harrison)
**Date:** 2026-09-24

## Problem

Today the app recognizes exactly two effective roles: `Learner` and `Admin`. But Entra already carries three real app roles — `Learner`, `DepartmentAdmin`, `OrgAdmin` — and the sync (`lib/entra/graph-client.ts`) already resolves all three correctly. `lib/roles.ts` collapses `DepartmentAdmin` and `OrgAdmin` into one generic `"Admin"`, so a Department Admin today gets full Org Admin access: every user, every department, every course, every report, company-wide. There is also no database link recording *which* department a Department Admin actually administers.

Org Admins will always be a small handful of people; Department Admins will be numerous. The distinction needs to be real and enforced, not cosmetic.

## Goals

1. Restore the real three-tier role: `Learner`, `DepartmentAdmin`, `OrgAdmin`.
2. A new `department_admins` link table: which department(s) a given Department-Admin-role person actually administers (many admins per department, many departments per admin). Only Org Admins can create this link, from the existing Org Admin page.
3. The current Org Admin page (`/admin/org` — department creation, department-admin assignment, company-wide user list) becomes **Org-Admin-only**.
4. A new **Department** page/tab, **Department-Admin-only**, scoped to the users, metrics, reports, and courses of whichever department(s) that person administers.
5. A new **Courses** tab on both the Org Admin and Department Admin nav — the admin's own personally-assigned learner courses, so an admin who is also assigned training doesn't have to leave the admin shell.
6. Department-scoped course ownership: a course created by a Department Admin is owned by their department and only shows up in their Content Authoring view; an Org Admin sees and can manage every course regardless of department, with an owning-department shown/filterable.

## Non-goals (out of scope for this pass)

- Changing how Entra assigns the `DepartmentAdmin` app role itself — that's Entra-side, unchanged.
- Retroactively re-scoping the existing `department_course_assignments` feature (department → learners) — that stays as-is; it's a different relationship (who gets *enrolled*) from `department_admins` (who gets to *administer*).
- Video Library: stays a shared, unscoped resource visible to both tiers — videos aren't department-owned, only the courses that reference them are.
- Any UI for an Org Admin to browse "as" a specific department (a debugging/impersonation view) — not requested.

## Role model

```ts
// lib/roles.ts
export type Role = "Learner" | "DepartmentAdmin" | "OrgAdmin";

export function roleFromClaims(roles: string[] | undefined): { role: Role; label: string } {
  if (roles?.includes("OrgAdmin")) return { role: "OrgAdmin", label: "Org Admin" };
  if (roles?.includes("DepartmentAdmin")) return { role: "DepartmentAdmin", label: "Department Admin" };
  return { role: "Learner", label: "Learner" };
}

export function isAdminRole(roles: string[] | undefined): boolean {
  const role = roleFromClaims(roles).role;
  return role === "DepartmentAdmin" || role === "OrgAdmin";
}

export function isOrgAdmin(roles: string[] | undefined): boolean {
  return roleFromClaims(roles).role === "OrgAdmin";
}
```

`isAdminRole` keeps its current meaning ("can reach the admin shell at all") so every existing enrollment-bypass check (`!isAdminRole(...)`) scattered across the learner module pages keeps working unchanged for both admin tiers. `isOrgAdmin` is new, used only where a page/action must be Org-Admin-exclusive.

## Data model

### New table: `department_admins`

```ts
export const departmentAdmins = pgTable(
  "department_admins",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id),
    departmentId: uuid("department_id").notNull().references(() => departments.id),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
    assignedBy: text("assigned_by"),
  },
  (table) => [unique().on(table.userId, table.departmentId)]
);
```

Same shape as `course_assignments`/`department_course_assignments` — plain link table, `assignedBy` as a free-text email (not a FK) for the same reason those already do: the record outlives the assigner's own row being renamed.

Migration: `0017_department_admins.sql`, following the established hand-written-SQL + `generateDrizzleJson` snapshot workflow used for every migration this session.

### `courses.departmentId` — reused, now enforced

The column already exists and is currently cosmetic (a label shown in the course list, set from a dropdown in the builder). It becomes the course's real owning department:

- `null` → a global course. Only visible/manageable in an Org Admin's Content Authoring view.
- set → owned by that department. Visible/manageable in that department's Content Authoring view (for any of that department's admins) **and** in the Org Admin's (unscoped) view.

No schema change needed here — just enforcement added at the query/route layer (see below). This is a distinct concept from `department_course_assignments` (which departments a course is *assigned to* for enrollment) — a global course can still be assigned to any department's learners; a department-owned course is just one whose *authoring* is scoped to that department.

## Permission enforcement

### Route gating (`lib/auth/admin-gate.ts`)

Today `requiresAdminRole(pathname)` is a single coarse check: does this path need *any* admin role. That stays — every `/admin/*` and `/api/admin/*` path still requires `isAdminRole`. What's new is a second, narrower check for Org-Admin-only surfaces:

```ts
export function requiresOrgAdminRole(pathname: string): boolean {
  return isAtOrUnder(pathname, "/admin/org") || isAtOrUnder(pathname, "/api/admin/departments");
}
```

The proxy (wherever it currently calls `requiresAdminRole` + `isAdminRole`) adds one more branch: if `requiresOrgAdminRole(pathname)` and the caller isn't `isOrgAdmin`, return the same 403/redirect `adminForbiddenResponse` already returns for a non-admin hitting an admin path. `/api/admin/departments/[id]/course-assignments` (department→learner course assignment, built earlier this session) is **not** included here — an Org Admin does that today, but there's no reason a Department Admin administering that department shouldn't be able to assign courses to their own department's learners too; it's scoped data access, not an Org-Admin-exclusive action. `/api/admin/departments/[id]/members` (who belongs to the department) similarly stays open to a scoped Department Admin — see the scoping table below.

### Data scoping (per-route, not gated centrally)

Unlike the binary admin-gate, "show me only my department's data" can't be a single central check — it has to filter each query. Every currently-global admin data source gets a Department-Admin-aware variant:

| Surface | Org Admin sees | Department Admin sees | Change needed |
|---|---|---|---|
| Users list (`/admin/org`, `listUsersWithStatus`) | everyone | *(not shown at all — Org-Admin-only page)* | none (page is now gated out) |
| New Department page — users | n/a | only users in their department(s) | new query, new page |
| New Department page — metrics/reports | n/a | only their department(s)' completion stats | reuse existing per-department report query, scoped to their dept(s) instead of all depts |
| Content Authoring course list | all courses, any `departmentId` | only courses where `departmentId` ∈ their department(s) | `listRealCourses` gets an optional `departmentIds` filter; the page passes it when the caller is a Department Admin |
| Course creation | can set any department or leave global | auto-set to their department (if they administer exactly one) or a picker restricted to their departments (if more than one); never global | `createDraftCourse`/the create-course API route |
| Department creation/admin-assignment (`/admin/org`) | yes | n/a (page gated out) | none, already Org-Admin page |
| Video Library | everyone | everyone (unscoped, shared resource) | none |

`getDepartmentAdminDepartmentIds(userId)` (new, in `lib/db/department-admins.ts`) is the one shared lookup every scoped query/page calls to get "which department id(s) does this signed-in person administer."

## New pages

### `/admin/department` (Department-Admin-only; Org Admin also gated out — this is the Dept Admin's own page, symmetric with `/admin/org` being Org-Admin-only)

- If the signed-in Department Admin administers exactly one department: shows that department directly.
- If they administer more than one: a department switcher (same pattern as the existing "Viewing as" role switcher already in `app-shell.tsx`), then the same scoped view for whichever is selected.
- Content: department name, member roster (reusing `RosterClient`'s pattern, scoped), completion metrics for that department (reusing the existing per-department report calculation), and the department's owned courses (reusing `DepartmentCoursesClient`'s pattern for department→learner assignment, which already exists and needs no change — it's already department-scoped by URL param).

### Nav changes (`components/shell/app-shell.tsx`)

`adminNav` becomes role-conditional instead of a flat array:

```ts
const orgAdminNav = [
  { href: "/admin", label: "Home", icon: Home },
  { href: "/admin/content", label: "Content Authoring", icon: BookOpen },
  { href: "/admin/videos", label: "Video Library", icon: Video },
  { href: "/admin/reports", label: "Reports", icon: BarChart3 },
  { href: "/admin/org", label: "Org Admin", icon: Users },
  { href: "/courses", label: "Courses", icon: GraduationCap },
];

const departmentAdminNav = [
  { href: "/admin", label: "Home", icon: Home },
  { href: "/admin/content", label: "Content Authoring", icon: BookOpen },
  { href: "/admin/videos", label: "Video Library", icon: Video },
  { href: "/admin/department", label: "Department", icon: Users },
  { href: "/courses", label: "Courses", icon: GraduationCap },
];
```

(Reports folds into the Department page for a Department Admin rather than staying a separate global tab, since the global `/admin/reports` page is Org-Admin-scale company-wide reporting.)

## Course-ownership enforcement, precisely

- `updateCourseDetails`'s `departmentId` field: a Department Admin's course-builder UI either hides the department picker entirely (auto-owned, non-editable) or, if they administer multiple departments, restricts the picker's options to just their departments — never `null`/global and never another department they don't administer.
- The admin course-list API (`/api/admin/courses/list`) accepts the caller's scoping the same way the department page does: Org Admin gets everything, Department Admin gets a `departmentId IN (...)` filter server-side (never trust a client-supplied filter for this — always derive from the signed-in session).

## Testing approach

- `lib/roles.test.ts` (new): the three-way split, `isOrgAdmin` true only for OrgAdmin.
- `lib/db/department-admins.test.ts` (new): assign/list/remove, `getDepartmentAdminDepartmentIds`.
- `lib/auth/admin-gate.test.ts`: extend with `requiresOrgAdminRole` cases (mirrors the existing `requiresAdminRole` test shape).
- `lib/db/queries.test.ts`: extend `listRealCourses`-equivalent scoping test (Department Admin sees only their department's courses).
- Route tests for the new `/api/admin/department-admins` assignment endpoint, mirroring `departments/[id]/course-assignments/route.test.ts`'s shape.
- Live browser verification, same as every feature this session: sign in as a real synced Department Admin (or admin-preview), confirm the Org Admin page is unreachable, confirm the Department page shows only their data, confirm course creation locks to their department.

## Open items I'm deciding now, flag if wrong

1. Department Admin's course-creation department picker, if they administer 2+ departments: I'm defaulting to "must pick one of their own departments, no global option." If you'd rather it default silently to their *first* department with no picker, say so.
2. `/api/admin/departments/[id]/members` and `.../course-assignments` stay reachable by a Department Admin *for their own department only* (not Org-Admin-exclusive) — i.e., a Department Admin can add/remove their own department's roster and assign courses to their own department, same actions Org Admin already has, just scoped. Flag if you wanted those Org-Admin-only too.
3. `/admin/reports` (global company-wide reporting) stays Org-Admin-only; a Department Admin's reporting need is served by their Department page instead, not a scoped version of the same global page.

## Migration numbering

Next migration is `0017_department_admins.sql`, continuing the sequence already in `drizzle/migrations/`.
