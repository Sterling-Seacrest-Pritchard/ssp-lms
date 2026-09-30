# Shared Reports Page + Member Progress Drill-Down + CSV Export Design

**Status:** Approved by Ian (design discussed and confirmed in chat, 2026-09-30).

## Goal

1. Give Department Admins the same `/admin/reports` page Org Admins already have,
   scoped to their own department(s) instead of company-wide.
2. Add a "Member Progress" view on that page for both tiers: search/pick any
   member in scope (own department for a Department Admin, anyone for an Org
   Admin) and see their per-course status.
3. Add a "Needs Attention" filter (members with any overdue training) on the
   same member list, and a CSV export of every (member, assigned course)
   status row in scope.

Builds on the real reporting work shipped 2026-09-28
(`docs/superpowers/specs/2026-09-28-real-reporting-design.md`,
`lib/db/org-reporting.ts`, `lib/db/department-reporting.ts`).

## Scope decisions (discussed with Ian)

- **Routing:** one shared `/admin/reports` route for both tiers, not a
  separate Department Admin page - matches `/admin/content` and
  `/admin/videos`, which are already open to both tiers. The page branches its
  data source by caller role, the same way `/admin/department/page.tsx`
  already branches `eligibleUsers` by `isOrgAdmin`.
- **Drill-down depth:** course-level only for the selected member (status,
  due date, completed date, overdue, compliance flag per assigned course) -
  not module-level. Module-level SCORM/video/quiz/text detail is out of scope
  for this round.
- **Member picker:** a client-side search-as-you-type filter over an
  already-loaded member list, not a separate search API call. At current
  scale (~640 employees company-wide, single low-double-digit departments)
  the full list for either scope is small enough (id/name/email only) to load
  once with the rest of the reports data.
- **"Needs Attention" is a filter, not a separate query/component:** a
  checkbox over the same Member Progress table, toggling to members with
  `overdueCount > 0`. Avoids a near-duplicate UI surface for data the member
  list already has.
- **CSV export scope:** a Department Admin's export is always their own
  department (or the one they're currently viewing, if they administer more
  than one - same `?dept=` selection already used on `/admin/department`); an
  Org Admin's export is company-wide. No per-course or per-user filtering on
  the export in this round - it is the same rows the page already computed.

## Data layer

### `lib/db/member-progress.ts` (new)

```ts
export interface MemberProgressRow {
  userId: string;
  displayName: string;
  email: string;
  completedCount: number;
  totalAssigned: number;
  overdueCount: number;
}
export async function listMemberProgress(departmentId?: string): Promise<MemberProgressRow[]>;

export interface CourseStatusRow {
  userId: string;
  displayName: string;
  email: string;
  courseId: string;
  courseTitle: string;
  status: string;
  dueAt: string | null;
  completedAt: string | null;
  overdue: boolean;
  compliance: boolean;
}
export async function listCourseStatusRows(scope: { departmentId?: string; userId?: string }): Promise<CourseStatusRow[]>;
```

- `listMemberProgress`: one row per active user in scope (all active users
  when `departmentId` is omitted, that department's active members
  otherwise - `users.isActive = true`, matching the active-user-only
  convention every other real-reporting metric already uses). `totalAssigned`
  counts that user's `enrollments` rows; `completedCount` counts
  `status = 'completed'` among them; `overdueCount` counts
  `dueAt < now() AND status != 'completed'` among them. A user with zero
  enrollments still appears, with `completedCount: 0, totalAssigned: 0,
  overdueCount: 0` - "assigned nothing yet" is meaningful information for an
  admin tracking their team, not a row to hide.
- `listCourseStatusRows`: one row per `enrollments` record joined to its
  `courses` row, for the given scope. `scope.userId` narrows to one member
  (the drill-down); `scope.departmentId` narrows to one department's active
  members (the CSV export and, combined with no `userId`, feeds the same
  data `listMemberProgress` aggregates from - reuse only at the SQL-shape
  level, these stay two functions since their output rows serve different
  callers). Both scope fields may be passed together (department export for
  one specific member, though the UI never composes it that way in this
  round); passing neither returns every active user's rows company-wide (the
  Org Admin CSV export's shape).
- Both functions join `users` and filter `users.isActive = true`, same
  convention as `lib/db/org-reporting.ts`.

## API routes (new)

### `GET /api/admin/reports/members/[userId]/courses`

Returns `{ rows: CourseStatusRow[] }` via `listCourseStatusRows({ userId })`.
Authorization: Org Admin - always allowed. Department Admin - only if the
target user's current `departmentId` is one the caller administers (checked
via `getDepartmentAdminDepartmentIds`, same anti-IDOR "resolve the real owner
first" pattern used throughout this codebase's admin routes) - a Department
Admin passing an arbitrary `userId` for someone outside their department gets
403, not silently-empty data (an empty 200 would leak "this user exists but
has nothing" vs. "you can't see this user" - the same information-disclosure
class of issue fixed on the members route 2026-09-28).

### `GET /api/admin/reports/export`

Query param `dept` (UUID, optional). Returns `text/csv` with
`Content-Disposition: attachment; filename="progress-<scope>.csv"`.
Authorization: Org Admin - `dept` optional, honored if present (must be a
real department, no further ownership check needed since Org Admin can see
any department), omitted means company-wide. Department Admin - `dept` is
**required** and must be one of the caller's own administered departments
(`getDepartmentAdminDepartmentIds`); missing or foreign `dept` is a 403, never
silently downgraded to "your default department" or upgraded to
company-wide.

Both routes sit under the existing `requiresAdminRole` gate (any admin tier,
already covers `/api/admin/*`); neither needs `requiresOrgAdminRole`, since
both tiers use them, scoped by the in-handler check above.

## Page changes

### `app/(app)/admin/reports/page.tsx`

Becomes role-branching, same shape as `/admin/department/page.tsx`:

- Real Org Admin: today's full behavior (`getOrgStats`,
  `getDepartmentCompletionBreakdown`, `getMonthlyCompletions`) plus
  `listMemberProgress()` (no `departmentId` - company-wide).
- Real Department Admin (or an Org Admin previewing that role, matching the
  existing preview-toggle pattern in `components/shell/app-shell.tsx`):
  resolve `departmentId`s via `getDepartmentAdminDepartmentIds`; zero
  departments → the same "not assigned yet" empty state
  `/admin/department/page.tsx` already shows. One or more departments → the
  existing `?dept=` selector pattern, department-scoped stats/breakdown (the
  existing `getDepartmentCompletionStats`/`getDepartmentCourseBreakdown` from
  the 2026-09-28 work, already department-scoped) plus
  `listMemberProgress(selectedDepartmentId)`.
- `getMonthlyCompletions` and the Recharts department-breakdown bar chart stay
  Org-Admin-only content on this shared page - a single department's monthly
  trend and a bar chart with one bar is not useful, and the spec's own
  2026-09-28 Review Focus already treats monthly completions as an org-wide
  metric. A Department Admin sees their stat cards (via
  `getDepartmentCompletionStats`), the Member Progress table, and the CSV
  export button; not the two charts.

### `app/(app)/admin/reports/member-progress.tsx` (new, `"use client"`)

Props: `{ members: MemberProgressRow[]; exportHref: string }`. Renders a text
search input (filters `members` in memory by `displayName`/`email`), an
"Overdue only" checkbox (filters to `overdueCount > 0`), a table of the
filtered rows, and a CSV export link (`<a href={exportHref} download>`, plain
HTML - no client JS needed for the download itself). Clicking a row expands
it in place, lazily fetching
`/api/admin/reports/members/${userId}/courses` on first expand and rendering
the returned `CourseStatusRow[]` as a nested table (course / status / due /
completed / overdue).

### Nav

`components/shell/app-shell.tsx`'s `departmentAdminNav` gains a `Reports`
entry (`/admin/reports`, `BarChart3` icon - same icon `orgAdminNav` already
uses), in the same relative position `orgAdminNav` has it (after Video
Library, before the tier-specific Department/Org Admin link).

### Gating

`lib/auth/admin-gate.ts`'s `requiresOrgAdminRole` drops its
`/admin/reports` line - the page moves to the shared `requiresAdminRole` gate
(already covers all of `/admin/*`) plus its own in-page role branch, the
same pattern `/admin/department` already uses (no `requiresOrgAdminRole`
entry, gated only by the shared admin check, scoped by the page itself).

## Error handling

Same try/catch → `<UnavailableState>` convention as every other page and
route in this codebase. The two new API routes return a JSON `{ error }` body
on failure/authorization denial, matching `app/api/admin/departments/[id]/members/route.ts`.

## Testing

- `lib/db/member-progress.ts` gets `member-progress.test.ts` (real-DB style,
  matching `department-reporting.test.ts`): empty scope (no users) → empty
  array, not a crash; a user with zero enrollments still appears as an
  all-zero row; `overdueCount`/`completedCount` computed correctly across
  mixed statuses; company-wide scope (`departmentId` omitted) vs.
  department-scoped return different, correctly-filtered sets; an inactive
  user is excluded from both scopes; `listCourseStatusRows` returns the same
  row shape for `{userId}` and `{departmentId}` scopes and composes both
  filters when given both.
- The two new API routes get `route.test.ts` files: the anti-IDOR case (a
  Department Admin requesting a `userId`/`dept` outside their own department
  gets 403 with a generic message, not a distinguishing one - same
  information-disclosure lesson as the 2026-09-28 members-route fix); Org
  Admin unrestricted access; missing/malformed `dept`/`userId` params return
  400.
- `tsc --noEmit`, `eslint` (scoped to touched files, given the pre-existing
  repo-wide lint debt already documented in the 2026-09-28 ledger), and
  `next build` stay clean; full `vitest run` (serialized, per
  `vitest.config.ts`'s `fileParallelism: false`) stays green.

## Review Focus

- **Department Admin viewing/exporting a `dept` they don't administer** must
  be a 403 with a generic message, not distinguishing "doesn't exist" from
  "not yours" - the exact class of leak fixed in the 2026-09-28 branch.
- **A user with zero enrollments** must still appear in `listMemberProgress`
  (0/0, not overdue) rather than being silently dropped - an admin scanning
  for "who hasn't been assigned anything yet" needs to see them.
- **CSV export's `Content-Disposition` filename** must not echo an
  unsanitized department name directly (department names are admin-entered
  free text) - build the filename from a fixed prefix plus the department's
  UUID or a slugified/quoted form, never raw interpolation into a header
  value.
- **Company-wide member list performance**: `listMemberProgress()` with no
  `departmentId` must not run one query per user (N+1) for ~640 users - it
  must aggregate in one or two queries, matching the aggregation-in-JS-over-one-query
  pattern `getDepartmentCompletionBreakdown` already uses.
- **A Department Admin previewing via the existing role-preview toggle**
  (`components/shell/app-shell.tsx`) must see the same scoped view a real
  Department Admin does, not company-wide data leaking through because the
  page branched on the wrong role signal (real vs. effective/preview role -
  the existing `/admin/department/page.tsx` pattern this page is modeled on
  already gets this right by resolving `departmentId`s from the caller's own
  `department_admins` rows regardless of tier, not from an `isOrgAdmin` check
  alone).

## Explicitly out of scope

- Module-level drill-down (which specific SCORM/video/quiz/text module a
  member is stuck on) - course-level only, per Ian's decision above.
- A live search API for the member picker - client-side filtering of a
  preloaded list, per Ian's decision above.
- Per-course or per-user filtering on the CSV export - it exports the same
  rows the page's scope already computed.
- Any change to the underlying `enrollments`/`courses`/`users` schema - this
  is a read-only reporting feature, same as the 2026-09-28 work.
