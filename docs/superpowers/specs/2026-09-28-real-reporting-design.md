# Real Reporting Design

**Status:** Approved by Ian (design discussed and confirmed in chat, 2026-09-28).

## Goal

Replace every remaining mock reporting number in the app with real numbers computed
directly from the existing Postgres schema. No new tables, no new infrastructure -
this closes Roadmap Phase 7 using data that already exists (`enrollments`,
`course_assignments`, `department_course_assignments`, `courses`, `departments`,
`users`), the same way `lib/db/department-reporting.ts` already computes real
completion stats for the Department Admin page today.

## Scope decision (discussed with Ian)

Two designs were considered:

1. **Query Postgres directly** - real stats computed live from existing tables.
   Fast, no new infra, works today.
2. **Build the originally-envisioned BigQuery/Looker Studio pipeline** (app events
   → Pub/Sub → BigQuery, embedded Looker dashboards) - much larger scope, requires
   an event-logging system that was never built, new GCP infra, ongoing pipeline
   maintenance.

**Chosen: option 1.** Option 2 remains a possible future upgrade if reporting needs
outgrow what Postgres can answer directly, but nothing in the current scale (a few
hundred employees) needs it yet.

**Pages in scope** - all three places currently showing mock reporting data get
real numbers in this pass, so nothing mock is left visible anywhere once this
ships:

- `/admin/reports` (Org Admin, full page rebuild)
- `/admin` (Org Admin home, 4 stat cards)
- `/admin/org` (Org Admin, "Department Completion Summary" table)
- `/admin/department` (Department Admin, new "Courses" breakdown card - net new,
  not a mock-data replacement)

`lib/mock-data/reporting.ts` is deleted once nothing imports it.

## Metric definitions

- **Total Employees** - count of `users` where `isActive = true`.
- **Active Learners** - count of distinct active users who have at least one
  `enrollments` row with `status != 'not_started'`.
- **Compliance Rate** - of `enrollments` rows whose course has `compliance = true`,
  the percentage with `status = 'completed'`. Zero compliance-course enrollments
  anywhere → `0` (not `100`), same "empty means zero" convention already used by
  `getDepartmentCompletionStats`.
- **Overdue Training** - count of `enrollments` where `dueAt` is in the past and
  `status != 'completed'`.
- **Completion by Department** - one row per department, each department's
  completed/in-progress/not-started percentages, computed with the exact same
  logic as `getDepartmentCompletionStats` (already used by the Department Admin
  page) - just called for every department instead of one.
- **Monthly Completions** - count of `enrollments` grouped by the calendar month of
  `completedAt`, for the trailing 6 months (including months with zero
  completions, so the line chart doesn't skip gaps).
- **Department Course Breakdown** (Department Admin page only) - per course
  assigned to the department, completed/in-progress/not-started *counts* (not
  percentages, since per-course cohorts are small) plus how many of that
  department's enrollments in that course are overdue.

## Architecture

### `lib/db/org-reporting.ts` (new)

```ts
export interface OrgStats {
  totalEmployees: number;
  activeLearners: number;
  complianceRate: number; // 0-100, rounded
  overdueTraining: number;
}
export async function getOrgStats(): Promise<OrgStats>;

export interface DepartmentCompletionRow {
  departmentId: string;
  departmentName: string;
  completed: number; // 0-100
  inProgress: number;
  notStarted: number;
}
export async function getDepartmentCompletionBreakdown(): Promise<DepartmentCompletionRow[]>;

export interface MonthlyCompletionRow {
  month: string; // "Mar 2026" - year included, since a 6-month window can cross a year boundary
  completions: number;
}
export async function getMonthlyCompletions(months?: number): Promise<MonthlyCompletionRow[]>; // default 6
```

`getDepartmentCompletionBreakdown` reuses `getDepartmentCompletionStats`'s exact
percentage logic per department (extracted to a shared helper in
`lib/db/department-reporting.ts` so both call sites share one implementation,
never two copies of the same math) rather than duplicating it.

### `lib/db/department-reporting.ts` (extend)

```ts
export interface DepartmentCourseBreakdownRow {
  courseId: string;
  courseTitle: string;
  completed: number; // count, not percentage
  inProgress: number;
  notStarted: number;
  overdue: number;
}
export async function getDepartmentCourseBreakdown(
  departmentId: string
): Promise<DepartmentCourseBreakdownRow[]>;
```

Existing `getDepartmentCompletionStats` signature and behavior are unchanged -
only its percentage-calculation core is factored out for reuse.

### Pages

- `app/(app)/admin/reports/page.tsx` - becomes an async server component. Fetches
  `getOrgStats()`, `getDepartmentCompletionBreakdown()`, `getMonthlyCompletions()`;
  on any failure, renders `<UnavailableState>` (matches every other admin page's
  error-handling convention). Passes the fetched data as props into a new
  `reports-charts.tsx` (`"use client"`, holds the Recharts `BarChart`/`LineChart`
  markup that today's page already has - charts must stay client-side, Recharts
  needs the browser).
- `app/(app)/admin/page.tsx` - swaps the `orgStats` mock import for
  `getOrgStats()`, called unconditionally (matches today's existing behavior -
  `statCards` already renders for every admin tier regardless of Org vs.
  Department Admin; this spec doesn't change who sees the cards, only where the
  numbers come from).
- `app/(app)/admin/org/page.tsx` - swaps `departmentCompletion` mock import for
  `getDepartmentCompletionBreakdown()`.
- `app/(app)/admin/department/department-view.tsx` - new "Courses" card below the
  existing course-assignment card, rendering `getDepartmentCourseBreakdown`'s
  rows in a table (course / completed / in progress / not started / overdue).

## Error handling

Every new DB call is wrapped in try/catch at the page level, falling back to the
existing `<UnavailableState>` component - the same pattern used by every admin
page added so far in this project. No new error-handling pattern introduced.

## Testing

New test files, following the existing real-DB test style (see
`lib/db/department-reporting.test.ts`):

- `lib/db/org-reporting.test.ts` - covers: no data at all (all-zero stats, empty
  arrays, not a crash); mixed enrollment statuses; the overdue cutoff (`dueAt`
  exactly now vs. one second past vs. one second future); compliance-only
  filtering (a non-compliance course's completions must not count toward the
  compliance rate); month-bucketing across a year boundary (e.g. Nov/Dec/Jan);
  months with zero completions still appear in the output.
- `lib/db/department-reporting.test.ts` - add cases for
  `getDepartmentCourseBreakdown`: a department with no course assignments yet
  (empty array, not a crash); multiple courses; the overdue count only counting
  that department's own enrollments, not another department's enrollments in the
  same shared course.

`tsc --noEmit`, `eslint`, and `next build` must all stay clean, matching this
project's standing bar for every change.

## Explicitly out of scope

- The BigQuery/Pub-Sub/Looker Studio pipeline from the original target
  architecture - deferred indefinitely, revisit only if Postgres-direct reporting
  stops being sufficient.
- Any new schema/migration - every number here is computable from tables that
  already exist.
- Historical/point-in-time snapshots (e.g. "compliance rate as of last quarter") -
  every number is a live, current-moment calculation, same as the rest of this
  app's admin pages.
