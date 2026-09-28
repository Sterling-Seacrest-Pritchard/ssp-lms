# Real Reporting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every mock reporting number in the app (org-wide reports page, admin home stat cards, org admin's department-completion table) with real numbers computed live from the existing Postgres schema, and add a new real course-breakdown card to the Department Admin page.

**Architecture:** Two `lib/db` modules do all the querying (`department-reporting.ts`, extended, and a new `org-reporting.ts`), following this project's existing pattern (see `getDepartmentCompletionStats`) of a typed async function per metric, tested against the real dev database. Four page components then swap a mock-data import for a call into these modules, with the same try/catch → `<UnavailableState>` fallback every other admin page already uses. No schema changes.

**Tech Stack:** Drizzle ORM / Postgres, Next.js Server Components, Recharts (existing dependency, unchanged), Vitest.

**Spec:** `docs/superpowers/specs/2026-09-28-real-reporting-design.md`

## Global Constraints

- No new tables, columns, or migrations - every number is computed from `users`, `enrollments`, `courses`, `departments` as they exist today.
- Every number is a live, current-moment calculation - no historical snapshots.
- The percentage-bucketing logic must exist in exactly one place and be reused, not duplicated, between the single-department stats function and the all-departments breakdown function.
- Same error-handling convention as every existing admin page: wrap the page-level data fetch in try/catch, render `<UnavailableState>` on failure.
- `tsc --noEmit`, `eslint`, `next build`, and the full `vitest` suite must all stay clean at the end of every task.
- `lib/mock-data/reporting.ts` is deleted once no file imports it.

## Review Focus

- **Zero compliance-course enrollments anywhere → compliance rate is `0`, not `NaN`/`100`/a crash from dividing by zero.** Test in Task 2.
- **Month bucketing must produce a row for every month in the window, including months with zero completions, and label months correctly across a year boundary** (e.g. a window spanning Nov/Dec/Jan must not label two different Novembers the same or drop the year). Test in Task 2.
- **The overdue cutoff is strict: `dueAt` exactly equal to "now" is not yet overdue, only strictly-past is; a `null` `dueAt` never counts as overdue.** Test in Task 2.
- **A department's course breakdown must only count that department's own enrollments' overdue status, even when the same course is also assigned to a different department.** Test in Task 1.
- **Active Learners only counts currently-active users** - a deactivated user's historical enrollment activity must not inflate the count. Test in Task 2.

---

### Task 1: Extend `department-reporting.ts` with a shared percentage helper and course breakdown

**Files:**
- Modify: `lib/db/department-reporting.ts`
- Test: `lib/db/department-reporting.test.ts`

**Interfaces:**
- Produces: `export function bucketStatusesAsPercentages(statuses: string[]): { completed: number; inProgress: number; notStarted: number }` - pure function, no DB access. `completed`/`inProgress` are `Math.round((count / statuses.length) * 100)`; `notStarted` is the count-based complement (`statuses.length - completedCount - inProgressCount`) converted the same way, so the three always sum to the total. Empty input returns `{ completed: 0, inProgress: 0, notStarted: 0 }`.
- Produces: `export interface DepartmentCourseBreakdownRow { courseId: string; courseTitle: string; completed: number; inProgress: number; notStarted: number; overdue: number }`
- Produces: `export async function getDepartmentCourseBreakdown(departmentId: string): Promise<DepartmentCourseBreakdownRow[]>` - counts (not percentages), one row per course this department's members currently have an enrollment for, ordered by `courseTitle`. `overdue` counts only this department's own enrollments in that course whose `dueAt` is strictly in the past and `status !== "completed"`.
- Consumes (Task 2 depends on this): `bucketStatusesAsPercentages` is imported by `lib/db/org-reporting.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
describe("bucketStatusesAsPercentages", () => {
  it("returns zeros for an empty list", () => {
    expect(bucketStatusesAsPercentages([])).toEqual({ completed: 0, inProgress: 0, notStarted: 0 });
  });
});

describe("getDepartmentCourseBreakdown", () => {
  it("returns an empty array for a department with no enrollments", async () => {
    const [dept] = await db.insert(departments).values({ name: `Dept-${randomUUID()}` }).returning();
    try {
      expect(await getDepartmentCourseBreakdown(dept.id)).toEqual([]);
    } finally {
      await db.delete(departments).where(eq(departments.id, dept.id));
    }
  });

  it("counts per course and scopes overdue to this department's own enrollments only", async () => {
    // deptA has one user enrolled in `course`, overdue (dueAt in the past, not completed).
    // deptB has a different user also enrolled in the SAME `course`, also overdue.
    // getDepartmentCourseBreakdown(deptA.id) must report overdue: 1, not 2.
    const [deptA] = await db.insert(departments).values({ name: `Dept-${randomUUID()}` }).returning();
    const [deptB] = await db.insert(departments).values({ name: `Dept-${randomUUID()}` }).returning();
    const [course] = await db.insert(courses).values({ code: `RPT-${randomUUID()}`, title: "Shared Course" }).returning();
    const [userA] = await db.insert(users).values({ email: `${randomUUID()}@example.com`, displayName: "A", departmentId: deptA.id }).returning();
    const [userB] = await db.insert(users).values({ email: `${randomUUID()}@example.com`, displayName: "B", departmentId: deptB.id }).returning();
    const past = new Date(Date.now() - 86_400_000);
    try {
      await db.insert(enrollments).values({ userId: userA.id, courseId: course.id, status: "in_progress", dueAt: past });
      await db.insert(enrollments).values({ userId: userB.id, courseId: course.id, status: "in_progress", dueAt: past });

      const rows = await getDepartmentCourseBreakdown(deptA.id);
      expect(rows).toEqual([
        { courseId: course.id, courseTitle: "Shared Course", completed: 0, inProgress: 1, notStarted: 0, overdue: 1 },
      ]);
    } finally {
      await db.delete(enrollments).where(eq(enrollments.courseId, course.id));
      await db.delete(users).where(eq(users.id, userA.id));
      await db.delete(users).where(eq(users.id, userB.id));
      await db.delete(courses).where(eq(courses.id, course.id));
      await db.delete(departments).where(eq(departments.id, deptA.id));
      await db.delete(departments).where(eq(departments.id, deptB.id));
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/db/department-reporting.test.ts`
Expected: FAIL - `bucketStatusesAsPercentages`/`getDepartmentCourseBreakdown` not defined.

- [ ] **Step 3: Implement in `lib/db/department-reporting.ts`**

Extract the existing inline bucketing logic out of `getDepartmentCompletionStats` into the new exported `bucketStatusesAsPercentages`, then have `getDepartmentCompletionStats` call it (behavior unchanged - its own two existing tests must still pass). Add `getDepartmentCourseBreakdown`:

```ts
export async function getDepartmentCourseBreakdown(departmentId: string): Promise<DepartmentCourseBreakdownRow[]> {
  const rows = await db
    .select({
      courseId: courses.id,
      courseTitle: courses.title,
      status: enrollments.status,
      dueAt: enrollments.dueAt,
    })
    .from(enrollments)
    .innerJoin(users, eq(users.id, enrollments.userId))
    .innerJoin(courses, eq(courses.id, enrollments.courseId))
    .where(eq(users.departmentId, departmentId))
    .orderBy(courses.title);

  const now = new Date();
  const byCourse = new Map<string, DepartmentCourseBreakdownRow>();
  for (const row of rows) {
    const entry = byCourse.get(row.courseId) ?? {
      courseId: row.courseId,
      courseTitle: row.courseTitle,
      completed: 0,
      inProgress: 0,
      notStarted: 0,
      overdue: 0,
    };
    if (row.status === "completed") entry.completed++;
    else if (row.status === "in_progress") entry.inProgress++;
    else entry.notStarted++;
    if (row.dueAt && row.dueAt < now && row.status !== "completed") entry.overdue++;
    byCourse.set(row.courseId, entry);
  }
  return Array.from(byCourse.values());
}
```

The `orderBy(courses.title)` on the query keeps `Map` insertion order matching course-title order, so no extra sort is needed on the returned array.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/db/department-reporting.test.ts`
Expected: PASS (all 4 tests: 2 existing + 2 new)

- [ ] **Step 5: Commit**

```bash
git add lib/db/department-reporting.ts lib/db/department-reporting.test.ts
git commit -m "Extract shared completion-percentage helper, add department course breakdown"
```

---

### Task 2: New `lib/db/org-reporting.ts`

**Files:**
- Create: `lib/db/org-reporting.ts`
- Test: `lib/db/org-reporting.test.ts`

**Interfaces:**
- Consumes: `bucketStatusesAsPercentages` from `./department-reporting` (Task 1).
- Produces: `export function ratePercent(numerator: number, denominator: number): number` - pure, no DB access; `denominator === 0` returns `0` (never `NaN`), otherwise `Math.round((numerator / denominator) * 100)`.
- Produces: `export interface OrgStats { totalEmployees: number; activeLearners: number; complianceRate: number; overdueTraining: number }` and `export async function getOrgStats(): Promise<OrgStats>` - `complianceRate` is computed via `ratePercent`.
- Produces: `export interface DepartmentCompletionRow { departmentId: string; departmentName: string; completed: number; inProgress: number; notStarted: number }` and `export async function getDepartmentCompletionBreakdown(): Promise<DepartmentCompletionRow[]>` - one row per department (ordered by name), including departments with zero enrollments (all-zero row, not omitted).
- Produces: `export interface MonthlyCompletionRow { month: string; completions: number }` and `export async function getMonthlyCompletions(months?: number): Promise<MonthlyCompletionRow[]>` (default `6`) - oldest month first, `month` formatted as `"MMM YYYY"` (e.g. `"Nov 2026"`).

- [ ] **Step 1: Write the failing tests**

```ts
describe("ratePercent", () => {
  it("returns 0 for a zero denominator, never NaN", () => {
    expect(ratePercent(0, 0)).toBe(0);
  });

  it("rounds to the nearest percent", () => {
    expect(ratePercent(1, 3)).toBe(33);
  });
});

describe("getOrgStats", () => {
  it("counts only active users as employees, and only active users' non-not_started enrollments as active learners", async () => {
    const [course] = await db.insert(courses).values({ code: `ORG-${randomUUID()}`, title: "x" }).returning();
    const [active] = await db.insert(users).values({ email: `${randomUUID()}@example.com`, displayName: "Active" }).returning();
    const [inactive] = await db
      .insert(users)
      .values({ email: `${randomUUID()}@example.com`, displayName: "Inactive", isActive: false })
      .returning();
    try {
      const before = await getOrgStats();
      await db.insert(enrollments).values({ userId: active.id, courseId: course.id, status: "in_progress" });
      await db.insert(enrollments).values({ userId: inactive.id, courseId: course.id, status: "in_progress" });

      const after = await getOrgStats();
      expect(after.totalEmployees).toBe(before.totalEmployees + 1); // only the active user counted
      expect(after.activeLearners).toBe(before.activeLearners + 1); // only the active user's enrollment counted
    } finally {
      await db.delete(enrollments).where(eq(enrollments.courseId, course.id));
      await db.delete(users).where(eq(users.id, active.id));
      await db.delete(users).where(eq(users.id, inactive.id));
      await db.delete(courses).where(eq(courses.id, course.id));
    }
  });

  it("a non-compliance course's completion does not move the compliance rate", async () => {
    const [course] = await db.insert(courses).values({ code: `ORG-${randomUUID()}`, title: "x", compliance: false }).returning();
    const [user] = await db.insert(users).values({ email: `${randomUUID()}@example.com`, displayName: "x" }).returning();
    try {
      const before = (await getOrgStats()).complianceRate;
      await db.insert(enrollments).values({ userId: user.id, courseId: course.id, status: "completed" });
      expect((await getOrgStats()).complianceRate).toBe(before);
    } finally {
      await db.delete(enrollments).where(eq(enrollments.courseId, course.id));
      await db.delete(users).where(eq(users.id, user.id));
      await db.delete(courses).where(eq(courses.id, course.id));
    }
  });

  it("only counts an enrollment overdue when dueAt is strictly in the past and not completed", async () => {
    const [course] = await db.insert(courses).values({ code: `ORG-${randomUUID()}`, title: "x" }).returning();
    const [user] = await db.insert(users).values({ email: `${randomUUID()}@example.com`, displayName: "x" }).returning();
    const past = new Date(Date.now() - 1000);
    const future = new Date(Date.now() + 86_400_000);
    try {
      const before = (await getOrgStats()).overdueTraining;
      const [pastEnrollment] = await db
        .insert(enrollments)
        .values({ userId: user.id, courseId: course.id, status: "in_progress", dueAt: past })
        .returning();
      expect((await getOrgStats()).overdueTraining).toBe(before + 1);

      await db.update(enrollments).set({ status: "completed" }).where(eq(enrollments.id, pastEnrollment.id));
      expect((await getOrgStats()).overdueTraining).toBe(before);

      await db.update(enrollments).set({ status: "in_progress", dueAt: future }).where(eq(enrollments.id, pastEnrollment.id));
      expect((await getOrgStats()).overdueTraining).toBe(before);
    } finally {
      await db.delete(enrollments).where(eq(enrollments.courseId, course.id));
      await db.delete(users).where(eq(users.id, user.id));
      await db.delete(courses).where(eq(courses.id, course.id));
    }
  });
});

describe("getDepartmentCompletionBreakdown", () => {
  it("includes a department with zero enrollments as an all-zero row", async () => {
    const [dept] = await db.insert(departments).values({ name: `Dept-${randomUUID()}` }).returning();
    try {
      const rows = await getDepartmentCompletionBreakdown();
      expect(rows).toEqual(
        expect.arrayContaining([{ departmentId: dept.id, departmentName: dept.name, completed: 0, inProgress: 0, notStarted: 0 }])
      );
    } finally {
      await db.delete(departments).where(eq(departments.id, dept.id));
    }
  });
});

describe("getMonthlyCompletions", () => {
  it("returns one row per requested month, oldest first, with year-qualified labels", async () => {
    const rows = await getMonthlyCompletions(3);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => /^[A-Za-z]{3} \d{4}$/.test(r.month))).toBe(true);
    const now = new Date();
    const twoMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 2, 1).toLocaleDateString("en-US", {
      month: "short",
      year: "numeric",
    });
    expect(rows[0].month).toBe(twoMonthsAgo);
  });

  it("counts a real completion in its correct month bucket, zero-filling months without one", async () => {
    const [course] = await db.insert(courses).values({ code: `ORG-${randomUUID()}`, title: "x" }).returning();
    const [user] = await db.insert(users).values({ email: `${randomUUID()}@example.com`, displayName: "x" }).returning();
    try {
      await db.insert(enrollments).values({ userId: user.id, courseId: course.id, status: "completed", completedAt: new Date() });
      const rows = await getMonthlyCompletions(3);
      expect(rows[2].completions).toBeGreaterThanOrEqual(1); // current month is the last (newest) bucket
      expect(rows[0].completions).toBeGreaterThanOrEqual(0); // two months ago - present as a row even if 0
    } finally {
      await db.delete(enrollments).where(eq(enrollments.courseId, course.id));
      await db.delete(users).where(eq(users.id, user.id));
      await db.delete(courses).where(eq(courses.id, course.id));
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/db/org-reporting.test.ts`
Expected: FAIL - module does not exist yet.

- [ ] **Step 3: Implement `lib/db/org-reporting.ts`**

```ts
export function ratePercent(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : Math.round((numerator / denominator) * 100);
}

export async function getOrgStats(): Promise<OrgStats> {
  const [{ totalEmployees }] = await db
    .select({ totalEmployees: sql<number>`count(*)::int` })
    .from(users)
    .where(eq(users.isActive, true));

  const [{ activeLearners }] = await db
    .select({ activeLearners: sql<number>`count(distinct ${users.id})::int` })
    .from(enrollments)
    .innerJoin(users, eq(users.id, enrollments.userId))
    .where(and(eq(users.isActive, true), ne(enrollments.status, "not_started")));

  const complianceRows = await db
    .select({ status: enrollments.status })
    .from(enrollments)
    .innerJoin(courses, eq(courses.id, enrollments.courseId))
    .where(eq(courses.compliance, true));
  const completedCompliance = complianceRows.filter((r) => r.status === "completed").length;
  const complianceRate = ratePercent(completedCompliance, complianceRows.length);

  const [{ overdueTraining }] = await db
    .select({ overdueTraining: sql<number>`count(*)::int` })
    .from(enrollments)
    .where(and(isNotNull(enrollments.dueAt), lt(enrollments.dueAt, new Date()), ne(enrollments.status, "completed")));

  return { totalEmployees, activeLearners, complianceRate, overdueTraining };
}

export async function getDepartmentCompletionBreakdown(): Promise<DepartmentCompletionRow[]> {
  const depts = await db.select({ id: departments.id, name: departments.name }).from(departments).orderBy(departments.name);
  const rows = await db
    .select({ departmentId: users.departmentId, status: enrollments.status })
    .from(enrollments)
    .innerJoin(users, eq(users.id, enrollments.userId))
    .where(isNotNull(users.departmentId));

  const statusesByDept = new Map<string, string[]>();
  for (const row of rows) {
    const list = statusesByDept.get(row.departmentId!) ?? [];
    list.push(row.status);
    statusesByDept.set(row.departmentId!, list);
  }

  return depts.map((dept) => ({
    departmentId: dept.id,
    departmentName: dept.name,
    ...bucketStatusesAsPercentages(statusesByDept.get(dept.id) ?? []),
  }));
}

export async function getMonthlyCompletions(months = 6): Promise<MonthlyCompletionRow[]> {
  const now = new Date();
  const buckets = Array.from({ length: months }, (_, i) => {
    const offset = months - 1 - i;
    const d = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    return {
      key: `${d.getFullYear()}-${d.getMonth()}`,
      label: d.toLocaleDateString("en-US", { month: "short", year: "numeric" }),
      date: d,
    };
  });

  const rows = await db
    .select({ completedAt: enrollments.completedAt })
    .from(enrollments)
    .where(and(isNotNull(enrollments.completedAt), gte(enrollments.completedAt, buckets[0].date)));

  const counts = new Map<string, number>();
  for (const row of rows) {
    const d = row.completedAt!;
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return buckets.map((b) => ({ month: b.label, completions: counts.get(b.key) ?? 0 }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/db/org-reporting.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/db/org-reporting.ts lib/db/org-reporting.test.ts
git commit -m "Add org-wide real reporting queries"
```

---

### Task 3: Rebuild `/admin/reports` on real data

**Files:**
- Modify: `app/(app)/admin/reports/page.tsx`
- Create: `app/(app)/admin/reports/reports-charts.tsx`

**Interfaces:**
- Consumes: `getOrgStats`, `getDepartmentCompletionBreakdown`, `getMonthlyCompletions` from `lib/db/org-reporting` (Task 2). `UnavailableState` from `@/components/ui/unavailable-state` (existing).
- Produces: `ReportsCharts` component, `props: { departmentCompletion: DepartmentCompletionRow[]; monthlyCompletions: MonthlyCompletionRow[] }` - no other file consumes this, it is this page's own child.

- [ ] **Step 1: Implement `app/(app)/admin/reports/reports-charts.tsx`**

`"use client"` component holding exactly the two `<ResponsiveContainer>`/`<BarChart>`/`<LineChart>` blocks the current mock page already has, unchanged except: the `BarChart`'s `dataKey="department"` becomes `dataKey="departmentName"` (matching `DepartmentCompletionRow`'s field name), and both charts read from the `departmentCompletion`/`monthlyCompletions` props instead of the mock imports.

- [ ] **Step 2: Rewrite `app/(app)/admin/reports/page.tsx` as an async server component**

```tsx
export default async function ReportsPage() {
  let stats, departmentCompletion, monthlyCompletions;
  try {
    [stats, departmentCompletion, monthlyCompletions] = await Promise.all([
      getOrgStats(),
      getDepartmentCompletionBreakdown(),
      getMonthlyCompletions(),
    ]);
  } catch {
    return <UnavailableState message="Could not load reports right now. Please try again in a moment." />;
  }

  const statCards = [
    { label: "Total Employees", value: stats.totalEmployees },
    { label: "Active Learners", value: stats.activeLearners },
    { label: "Compliance Rate", value: `${stats.complianceRate}%` },
    { label: "Overdue Training", value: stats.overdueTraining },
  ];

  // ...unchanged heading/stat-card markup from the current page, then:
  return /* ... */ <ReportsCharts departmentCompletion={departmentCompletion} monthlyCompletions={monthlyCompletions} />;
}
```

Keep the page's existing heading text and stat-card grid markup as-is; only the data source and the "mock BigQuery/Looker Studio data" subtitle line change (drop the word "mock").

- [ ] **Step 3: Run the build and manually verify**

Run: `npx tsc --noEmit && npx eslint "app/(app)/admin/reports" && npx next build`
Expected: all clean, `/admin/reports` listed as a dynamic route in the build output.

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/admin/reports/page.tsx" "app/(app)/admin/reports/reports-charts.tsx"
git commit -m "Rebuild /admin/reports on real data"
```

---

### Task 4: Real stat cards on the admin home page

**Files:**
- Modify: `app/(app)/admin/page.tsx`

**Interfaces:**
- Consumes: `getOrgStats` from `lib/db/org-reporting` (Task 2).

- [ ] **Step 1: Replace the `orgStats` mock import and `statCards` construction**

Remove `import { orgStats } from "@/lib/mock-data/reporting"`. Fetch `const stats = await getOrgStats()` inside `AdminHomePage` (already an async function), wrapped in the same try/catch → `<UnavailableState>` pattern as the other pages in this plan; build `statCards` from `stats` instead of `orgStats`, same four labels/order as today.

- [ ] **Step 2: Run the build**

Run: `npx tsc --noEmit && npx eslint "app/(app)/admin/page.tsx" && npx next build`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add "app/(app)/admin/page.tsx"
git commit -m "Show real org stats on the admin home page"
```

---

### Task 5: Real department-completion table on `/admin/org`

**Files:**
- Modify: `app/(app)/admin/org/page.tsx`

**Interfaces:**
- Consumes: `getDepartmentCompletionBreakdown` from `lib/db/org-reporting` (Task 2).

- [ ] **Step 1: Replace the `departmentCompletion` mock import**

Remove `import { departmentCompletion } from "@/lib/mock-data/reporting"`. Fetch `const departmentCompletion = await getDepartmentCompletionBreakdown()` alongside the existing `listDepartmentsWithCounts()` call, inside the same try/catch that already wraps it (so one `<UnavailableState>` covers both). Update the table's `row.department` references to `row.departmentName` and its `key={row.department}` to `key={row.departmentId}`.

- [ ] **Step 2: Run the build**

Run: `npx tsc --noEmit && npx eslint "app/(app)/admin/org/page.tsx" && npx next build`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add "app/(app)/admin/org/page.tsx"
git commit -m "Show real department completion breakdown on /admin/org"
```

---

### Task 6: Real course breakdown on the Department Admin page

**Files:**
- Modify: `app/(app)/admin/department/page.tsx`
- Modify: `app/(app)/admin/department/department-view.tsx`

**Interfaces:**
- Consumes: `getDepartmentCourseBreakdown` from `lib/db/department-reporting` (Task 1).

- [ ] **Step 1: Fetch the breakdown in `page.tsx`**

Add `const courseBreakdown = await getDepartmentCourseBreakdown(selectedDepartmentId)` next to the existing `getDepartmentCompletionStats`/`listUsersNotInDepartment` calls, inside the same try/catch, and pass it as a new `courseBreakdown` prop into `<DepartmentView>`.

- [ ] **Step 2: Render it in `department-view.tsx`**

Add a new `courseBreakdown: DepartmentCourseBreakdownRow[]` prop to `DepartmentView`'s signature, and a new Card titled "Courses" (placed after the existing course-assignment Card) rendering a `<Table>` with columns Course / Completed / In Progress / Not Started / Overdue, one row per `courseBreakdown` entry, and an empty-state row ("No course activity yet.") when the array is empty - same empty-state pattern already used for the Users table on this page.

- [ ] **Step 3: Run the build**

Run: `npx tsc --noEmit && npx eslint "app/(app)/admin/department" && npx next build`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/admin/department/page.tsx" "app/(app)/admin/department/department-view.tsx"
git commit -m "Add real course-completion breakdown to the Department Admin page"
```

---

### Task 7: Delete the mock reporting data and do final whole-repo verification

**Files:**
- Delete: `lib/mock-data/reporting.ts`

**Interfaces:**
- None - this is cleanup and verification only.

- [ ] **Step 1: Confirm nothing still imports the mock file**

Run: `grep -rl "mock-data/reporting" --include="*.ts" --include="*.tsx" .`
Expected: no output (empty).

- [ ] **Step 2: Delete the file**

```bash
git rm lib/mock-data/reporting.ts
```

- [ ] **Step 3: Run the full verification suite**

Run: `npx tsc --noEmit && npx eslint . && npx vitest run && npx next build`
Expected: all four clean/green, matching this project's standing bar.

- [ ] **Step 4: Commit**

```bash
git commit -m "Remove now-unused mock reporting data"
```
