# Shared Reports + Member Progress + CSV Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/admin/reports` a shared page for both admin tiers (scoped by role), add a searchable Member Progress table with a per-member course drill-down and an "overdue only" filter, and a CSV export of every (member, assigned course) row in scope.

**Architecture:** One new data module (`lib/db/member-progress.ts`) supplies both the member-list aggregate and the per-course detail rows used by the drill-down and the CSV export. Two new API routes serve the drill-down and the export, each independently authorized (Org Admin unrestricted, Department Admin scoped to their own administered department(s), verified server-side). The existing `/admin/reports/page.tsx` is rewritten to branch by role, following the exact pattern `/admin/department/page.tsx` already uses.

**Tech Stack:** Drizzle ORM / Postgres, Next.js Server Components + Route Handlers, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-30-shared-reports-member-progress-design.md`

## Global Constraints

- No schema changes - every row is computed from `users`, `enrollments`, `courses` as they exist today.
- `users.isActive = true` filters every query, matching the existing real-reporting convention (`lib/db/org-reporting.ts`).
- A Department Admin's access to any user or department is always verified server-side against their real `department_admins` rows (`getDepartmentAdminDepartmentIds`) - never a client-supplied claim.
- An authorization denial returns a generic message, never one that distinguishes "doesn't exist" from "not yours."
- `tsc --noEmit`, `eslint` (scoped to touched files - this repo has pre-existing unrelated lint debt, documented in the 2026-09-28 real-reporting ledger), `next build`, and the full `vitest run` (serialized, per `vitest.config.ts`) must all stay clean at the end of every task.

## Review Focus

- **Department Admin requesting a `userId`/`dept` outside their own department** must get a generic 403, not a distinguishing message and not a silently-empty 200. Tests in Task 2 and Task 3.
- **A user with zero enrollments** must still appear in `listMemberProgress` as an all-zero row, not be dropped. Test in Task 1.
- **CSV filename must never raw-interpolate a department's free-text name** - department UUID or a fixed "company-wide" token only. Test in Task 3.
- **Company-wide `listMemberProgress()` (no `departmentId`) must not run one query per user** - one or two aggregate queries for the whole company. Verified by reading the implementation in Task 1's review, not a runtime-timing test (this scale doesn't need a perf test, but an accidental N+1 loop-with-await-inside is a correctness/architecture smell worth a deliberate check).
- **An Org Admin previewing the Department Admin role** (existing `components/shell/app-shell.tsx` toggle) must see the same scoped view a real Department Admin sees, not company-wide data leaking through. Covered by Task 4's page logic mirroring `/admin/department/page.tsx`'s existing real-role-only resolution (`getDepartmentAdminDepartmentIds` keyed off the caller's own id, never off `isOrgAdmin`).

---

### Task 1: `lib/db/member-progress.ts` - data layer

**Files:**
- Create: `lib/db/member-progress.ts`
- Test: `lib/db/member-progress.test.ts`

**Interfaces:**
- Produces: `export interface MemberProgressRow { userId: string; displayName: string; email: string; completedCount: number; totalAssigned: number; overdueCount: number }` and `export async function listMemberProgress(departmentId?: string): Promise<MemberProgressRow[]>`.
- Produces: `export interface CourseStatusRow { userId: string; displayName: string; email: string; courseId: string; courseTitle: string; status: string; dueAt: string | null; completedAt: string | null; overdue: boolean; compliance: boolean }` and `export async function listCourseStatusRows(scope: { departmentId?: string; userId?: string }): Promise<CourseStatusRow[]>`.
- Consumed by: Task 2 (`listCourseStatusRows({userId})`), Task 3 (`listCourseStatusRows({departmentId})`), Task 5 (`listMemberProgress`).

- [ ] **Step 1: Write the failing tests**

```ts
describe("listMemberProgress", () => {
  it("returns an empty array for a department with no users", async () => {
    const [dept] = await db.insert(departments).values({ name: `Dept-${randomUUID()}` }).returning();
    try {
      expect(await listMemberProgress(dept.id)).toEqual([]);
    } finally {
      await db.delete(departments).where(eq(departments.id, dept.id));
    }
  });

  it("includes a user with zero enrollments as an all-zero row, and computes counts for mixed statuses", async () => {
    const [dept] = await db.insert(departments).values({ name: `Dept-${randomUUID()}` }).returning();
    const [courseA] = await db.insert(courses).values({ code: `MP-${randomUUID()}`, title: "a" }).returning();
    const [courseB] = await db.insert(courses).values({ code: `MP-${randomUUID()}`, title: "b" }).returning();
    const [idle] = await db.insert(users).values({ email: `${randomUUID()}@example.com`, displayName: "Idle", departmentId: dept.id }).returning();
    const [busy] = await db.insert(users).values({ email: `${randomUUID()}@example.com`, displayName: "Busy", departmentId: dept.id }).returning();
    const past = new Date(Date.now() - 86_400_000);
    try {
      await db.insert(enrollments).values({ userId: busy.id, courseId: courseA.id, status: "completed" });
      await db.insert(enrollments).values({ userId: busy.id, courseId: courseB.id, status: "in_progress", dueAt: past });

      const rows = await listMemberProgress(dept.id);
      expect(rows).toEqual(
        expect.arrayContaining([
          { userId: idle.id, displayName: "Idle", email: idle.email, completedCount: 0, totalAssigned: 0, overdueCount: 0 },
          { userId: busy.id, displayName: "Busy", email: busy.email, completedCount: 1, totalAssigned: 2, overdueCount: 1 },
        ])
      );
    } finally {
      await db.delete(enrollments).where(eq(enrollments.userId, busy.id));
      await db.delete(courses).where(eq(courses.id, courseA.id));
      await db.delete(courses).where(eq(courses.id, courseB.id));
      await db.delete(users).where(eq(users.id, idle.id));
      await db.delete(users).where(eq(users.id, busy.id));
      await db.delete(departments).where(eq(departments.id, dept.id));
    }
  });

  it("excludes an inactive user", async () => {
    const [dept] = await db.insert(departments).values({ name: `Dept-${randomUUID()}` }).returning();
    const [inactive] = await db
      .insert(users)
      .values({ email: `${randomUUID()}@example.com`, displayName: "Leaver", departmentId: dept.id, isActive: false })
      .returning();
    try {
      expect(await listMemberProgress(dept.id)).toEqual([]);
    } finally {
      await db.delete(users).where(eq(users.id, inactive.id));
      await db.delete(departments).where(eq(departments.id, dept.id));
    }
  });

  it("with no departmentId, returns active users company-wide", async () => {
    const [user] = await db.insert(users).values({ email: `${randomUUID()}@example.com`, displayName: "NoDept" }).returning();
    try {
      const rows = await listMemberProgress();
      expect(rows).toEqual(
        expect.arrayContaining([{ userId: user.id, displayName: "NoDept", email: user.email, completedCount: 0, totalAssigned: 0, overdueCount: 0 }])
      );
    } finally {
      await db.delete(users).where(eq(users.id, user.id));
    }
  });
});

describe("listCourseStatusRows", () => {
  it("scoped by userId returns only that user's rows, with overdue/compliance flags", async () => {
    const [course] = await db.insert(courses).values({ code: `MP-${randomUUID()}`, title: "Compliance Course", compliance: true }).returning();
    const [user] = await db.insert(users).values({ email: `${randomUUID()}@example.com`, displayName: "x" }).returning();
    const past = new Date(Date.now() - 86_400_000);
    try {
      await db.insert(enrollments).values({ userId: user.id, courseId: course.id, status: "in_progress", dueAt: past });
      const rows = await listCourseStatusRows({ userId: user.id });
      expect(rows).toEqual([
        expect.objectContaining({
          userId: user.id,
          courseId: course.id,
          courseTitle: "Compliance Course",
          status: "in_progress",
          overdue: true,
          compliance: true,
        }),
      ]);
    } finally {
      await db.delete(enrollments).where(eq(enrollments.userId, user.id));
      await db.delete(users).where(eq(users.id, user.id));
      await db.delete(courses).where(eq(courses.id, course.id));
    }
  });

  it("scoped by departmentId returns only that department's active members' rows", async () => {
    const [deptA] = await db.insert(departments).values({ name: `Dept-${randomUUID()}` }).returning();
    const [deptB] = await db.insert(departments).values({ name: `Dept-${randomUUID()}` }).returning();
    const [course] = await db.insert(courses).values({ code: `MP-${randomUUID()}`, title: "x" }).returning();
    const [userA] = await db.insert(users).values({ email: `${randomUUID()}@example.com`, displayName: "A", departmentId: deptA.id }).returning();
    const [userB] = await db.insert(users).values({ email: `${randomUUID()}@example.com`, displayName: "B", departmentId: deptB.id }).returning();
    try {
      await db.insert(enrollments).values({ userId: userA.id, courseId: course.id, status: "not_started" });
      await db.insert(enrollments).values({ userId: userB.id, courseId: course.id, status: "not_started" });
      const rows = await listCourseStatusRows({ departmentId: deptA.id });
      expect(rows.map((r) => r.userId)).toEqual([userA.id]);
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

Run: `npx vitest run lib/db/member-progress.test.ts`
Expected: FAIL - module does not exist.

- [ ] **Step 3: Implement `lib/db/member-progress.ts`**

`listMemberProgress`: one query joining `users` (filtered `isActive = true`, and `departmentId` equality when given) `leftJoin` `enrollments`, selecting `userId, displayName, email, status, dueAt`; aggregate per user in JS (one pass, `Map<userId, {...}>`) rather than per-user queries - this is the N+1 the Review Focus calls out. Users with no enrollment rows still appear (the `leftJoin` preserves them with `status: null`, skip counting for those rows). `overdueCount` increments when `dueAt !== null && dueAt < new Date() && status !== "completed"`.

`listCourseStatusRows`: one query joining `enrollments` → `users` (filtered `isActive = true`, plus `departmentId` equality when given, plus `userId` equality when given - both filters `and`-combined when both are present) → `courses`, selecting the full `CourseStatusRow` shape directly (no further JS aggregation needed - it's already one row per enrollment). `overdue` is computed the same way as above; `compliance` is `courses.compliance` verbatim; `dueAt`/`completedAt` are `.toISOString()` or `null`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/db/member-progress.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/db/member-progress.ts lib/db/member-progress.test.ts
git commit -m "Add member progress and course status query layer"
```

---

### Task 2: `GET /api/admin/reports/members/[userId]/courses`

**Files:**
- Create: `app/api/admin/reports/members/[userId]/courses/route.ts`
- Test: `app/api/admin/reports/members/[userId]/courses/route.test.ts`

**Interfaces:**
- Consumes: `listCourseStatusRows` from `lib/db/member-progress` (Task 1); `getDepartmentAdminDepartmentIds` from `lib/db/department-admins`; `isOrgAdmin` from `lib/roles`.
- Produces: `GET` handler returning `{ rows: CourseStatusRow[] }` (200), or `{ error: string }` (400 for a non-UUID `userId`, 403 for an unauthorized Department Admin, 404 if the user doesn't exist). Not consumed by any other task - the client component (Task 6) calls this route by URL, not by import.
- New export needed from an existing module: `lib/db/users.ts` gains `export async function getUserDepartmentId(userId: string): Promise<string | null | undefined>` - `undefined` means no such user exists, `null` means the user exists but has no department, a `string` is the department id.

- [ ] **Step 1: Write the failing tests**

```ts
describe("GET /api/admin/reports/members/[userId]/courses", () => {
  it("returns 400 for a non-UUID userId", async () => {
    const request = new NextRequest("http://localhost/api/admin/reports/members/not-a-uuid/courses");
    const response = await GET(request, { params: Promise.resolve({ userId: "not-a-uuid" }) });
    expect(response.status).toBe(400);
  });

  it("returns 404 for a userId that doesn't exist", async () => {
    vi.mocked(auth).mockResolvedValueOnce({ user: { email: "org-admin@example.com", roles: ["OrgAdmin"] } } as never);
    const missingId = randomUUID();
    const request = new NextRequest(`http://localhost/api/admin/reports/members/${missingId}/courses`);
    const response = await GET(request, { params: Promise.resolve({ userId: missingId }) });
    expect(response.status).toBe(404);
  });

  it("allows an Org Admin to view any user's courses", async () => {
    const [user] = await db.insert(users).values({ email: `${randomUUID()}@example.com`, displayName: "x" }).returning();
    vi.mocked(auth).mockResolvedValueOnce({ user: { email: "org-admin@example.com", roles: ["OrgAdmin"] } } as never);
    try {
      const request = new NextRequest(`http://localhost/api/admin/reports/members/${user.id}/courses`);
      const response = await GET(request, { params: Promise.resolve({ userId: user.id }) });
      expect(response.status).toBe(200);
      expect((await response.json()).rows).toEqual([]);
    } finally {
      await db.delete(users).where(eq(users.id, user.id));
    }
  });

  it("returns 403 (generic) when a Department Admin requests a user outside their department", async () => {
    const [dept] = await db.insert(departments).values({ name: `Dept-${randomUUID()}` }).returning();
    const [otherDept] = await db.insert(departments).values({ name: `Dept-${randomUUID()}` }).returning();
    const [target] = await db.insert(users).values({ email: `${randomUUID()}@example.com`, displayName: "x", departmentId: otherDept.id }).returning();
    const [admin] = await db.insert(users).values({ email: `${randomUUID()}@example.com`, displayName: "Admin" }).returning();
    await assignDepartmentAdmin(admin.id, dept.id, null);
    vi.mocked(auth).mockResolvedValueOnce({ user: { email: admin.email, roles: ["DepartmentAdmin"] } } as never);
    try {
      const request = new NextRequest(`http://localhost/api/admin/reports/members/${target.id}/courses`);
      const response = await GET(request, { params: Promise.resolve({ userId: target.id }) });
      expect(response.status).toBe(403);
      expect((await response.json()).error).not.toMatch(/exist|found/i);
    } finally {
      await db.delete(departmentAdmins).where(eq(departmentAdmins.userId, admin.id));
      await db.delete(users).where(eq(users.id, target.id));
      await db.delete(users).where(eq(users.id, admin.id));
      await db.delete(departments).where(eq(departments.id, dept.id));
      await db.delete(departments).where(eq(departments.id, otherDept.id));
    }
  });

  it("allows a Department Admin to view a user inside their own department", async () => {
    const [dept] = await db.insert(departments).values({ name: `Dept-${randomUUID()}` }).returning();
    const [target] = await db.insert(users).values({ email: `${randomUUID()}@example.com`, displayName: "x", departmentId: dept.id }).returning();
    const [admin] = await db.insert(users).values({ email: `${randomUUID()}@example.com`, displayName: "Admin" }).returning();
    await assignDepartmentAdmin(admin.id, dept.id, null);
    vi.mocked(auth).mockResolvedValueOnce({ user: { email: admin.email, roles: ["DepartmentAdmin"] } } as never);
    try {
      const request = new NextRequest(`http://localhost/api/admin/reports/members/${target.id}/courses`);
      const response = await GET(request, { params: Promise.resolve({ userId: target.id }) });
      expect(response.status).toBe(200);
    } finally {
      await db.delete(departmentAdmins).where(eq(departmentAdmins.userId, admin.id));
      await db.delete(users).where(eq(users.id, target.id));
      await db.delete(users).where(eq(users.id, admin.id));
      await db.delete(departments).where(eq(departments.id, dept.id));
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run app/api/admin/reports/members/[userId]/courses/route.test.ts`
Expected: FAIL - route module does not exist.

- [ ] **Step 3: Implement the route and `getUserDepartmentId`**

Add `getUserDepartmentId` to `lib/db/users.ts`: select
`{ departmentId: users.departmentId }` where `users.id = userId`; return
`undefined` if no row, else `rows[0].departmentId` (which is itself
`string | null`).

Route handler: validate `userId` is a UUID (400 via `isUuid`/`badRequest`
from `lib/api/errors` if not). Call `getUserDepartmentId(userId)`; if
`undefined`, return 404. If the caller is not an Org Admin: resolve the
caller's own `userId` (via `getUserIdByEmail`), call
`getDepartmentAdminDepartmentIds`, and return a generic 403 unless the
target's department id is non-null and in that list. Otherwise call
`listCourseStatusRows({ userId })` and return `{ rows }`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run app/api/admin/reports/members/[userId]/courses/route.test.ts lib/db/users.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/reports/members lib/db/users.ts
git commit -m "Add member course-status drill-down API route"
```

---

### Task 3: `GET /api/admin/reports/export`

**Files:**
- Create: `app/api/admin/reports/export/route.ts`
- Test: `app/api/admin/reports/export/route.test.ts`

**Interfaces:**
- Consumes: `listCourseStatusRows` (Task 1), `getDepartmentAdminDepartmentIds`, `isOrgAdmin`, `listDepartments` (from `lib/db/departments`, to validate a supplied `dept` is real), `getUserIdByEmail`.
- Produces: `GET` handler returning `text/csv` (200) with header
  `Content-Disposition: attachment; filename="progress-<scope>.csv"` where
  `<scope>` is the department's UUID or the literal `company-wide` - never
  the department's free-text name. Not consumed by any other task - the CSV
  export link (Task 6) references this route by URL.

- [ ] **Step 1: Write the failing tests**

```ts
describe("GET /api/admin/reports/export", () => {
  it("returns 403 when a Department Admin omits dept", async () => {
    const [admin] = await db.insert(users).values({ email: `${randomUUID()}@example.com`, displayName: "Admin" }).returning();
    vi.mocked(auth).mockResolvedValueOnce({ user: { email: admin.email, roles: ["DepartmentAdmin"] } } as never);
    try {
      const response = await GET(new NextRequest("http://localhost/api/admin/reports/export"));
      expect(response.status).toBe(403);
    } finally {
      await db.delete(users).where(eq(users.id, admin.id));
    }
  });

  it("returns 403 when a Department Admin requests a dept they don't administer", async () => {
    const [dept] = await db.insert(departments).values({ name: `Dept-${randomUUID()}` }).returning();
    const [otherDept] = await db.insert(departments).values({ name: `Dept-${randomUUID()}` }).returning();
    const [admin] = await db.insert(users).values({ email: `${randomUUID()}@example.com`, displayName: "Admin" }).returning();
    await assignDepartmentAdmin(admin.id, dept.id, null);
    vi.mocked(auth).mockResolvedValueOnce({ user: { email: admin.email, roles: ["DepartmentAdmin"] } } as never);
    try {
      const response = await GET(new NextRequest(`http://localhost/api/admin/reports/export?dept=${otherDept.id}`));
      expect(response.status).toBe(403);
    } finally {
      await db.delete(departmentAdmins).where(eq(departmentAdmins.userId, admin.id));
      await db.delete(users).where(eq(users.id, admin.id));
      await db.delete(departments).where(eq(departments.id, dept.id));
      await db.delete(departments).where(eq(departments.id, otherDept.id));
    }
  });

  it("returns a CSV with a UUID-based filename, never the department's raw name", async () => {
    const [dept] = await db.insert(departments).values({ name: `Dept, "quoted"! ${randomUUID()}` }).returning();
    const [admin] = await db.insert(users).values({ email: `${randomUUID()}@example.com`, displayName: "Admin" }).returning();
    await assignDepartmentAdmin(admin.id, dept.id, null);
    vi.mocked(auth).mockResolvedValueOnce({ user: { email: admin.email, roles: ["DepartmentAdmin"] } } as never);
    try {
      const response = await GET(new NextRequest(`http://localhost/api/admin/reports/export?dept=${dept.id}`));
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/csv");
      const disposition = response.headers.get("content-disposition") ?? "";
      expect(disposition).toContain(`progress-${dept.id}.csv`);
      expect(disposition).not.toContain("quoted");
    } finally {
      await db.delete(departmentAdmins).where(eq(departmentAdmins.userId, admin.id));
      await db.delete(users).where(eq(users.id, admin.id));
      await db.delete(departments).where(eq(departments.id, dept.id));
    }
  });

  it("returns a header row plus one row per (user, course) for an Org Admin's company-wide export", async () => {
    const [course] = await db.insert(courses).values({ code: `MP-${randomUUID()}`, title: "x" }).returning();
    const [user] = await db.insert(users).values({ email: `${randomUUID()}@example.com`, displayName: "x" }).returning();
    vi.mocked(auth).mockResolvedValueOnce({ user: { email: "org-admin@example.com", roles: ["OrgAdmin"] } } as never);
    try {
      await db.insert(enrollments).values({ userId: user.id, courseId: course.id, status: "not_started" });
      const response = await GET(new NextRequest("http://localhost/api/admin/reports/export"));
      expect(response.status).toBe(200);
      const text = await response.text();
      const lines = text.trim().split("\n");
      expect(lines[0]).toBe("Name,Email,Course,Status,Due,Completed,Overdue,Compliance");
      expect(lines.some((l) => l.includes(user.email))).toBe(true);
    } finally {
      await db.delete(enrollments).where(eq(enrollments.userId, user.id));
      await db.delete(users).where(eq(users.id, user.id));
      await db.delete(courses).where(eq(courses.id, course.id));
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run app/api/admin/reports/export/route.test.ts`
Expected: FAIL - route module does not exist.

- [ ] **Step 3: Implement the route**

Parse `dept` from the query string. If present, validate it's a UUID (400 if
not) and that it matches a real department from `listDepartments()` (400 if
not found - a malformed/nonexistent id is a bad request, not an
authorization question). If the caller is not an Org Admin (resolve their
own `userId` via `getUserIdByEmail`, then check `isOrgAdmin` against their
real session roles): `dept` is required (403 if missing) and must be in
`getDepartmentAdminDepartmentIds(callerId)` (403 if not). Call
`listCourseStatusRows({ departmentId: dept })`, or for an Org Admin with no
`dept`, `listCourseStatusRows({})`.

Build the CSV body: header row
`Name,Email,Course,Status,Due,Completed,Overdue,Compliance`, then one line
per row using a small local `csvField(value: string): string` helper
(RFC4180: wrap in quotes and double any internal quotes whenever the value
contains a comma, quote, or newline - course titles and display names are
free text and may contain commas). Boolean fields render as `true`/`false`;
null dates render as an empty field.

Return `new NextResponse(csv, { headers: { "Content-Type": "text/csv", "Content-Disposition": \`attachment; filename="progress-${dept ?? "company-wide"}.csv"\` } })`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run app/api/admin/reports/export/route.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/reports/export
git commit -m "Add CSV export API route for member course status"
```

---

### Task 4: Gating and nav

**Files:**
- Modify: `lib/auth/admin-gate.ts`
- Modify: `lib/auth/admin-gate.test.ts`
- Modify: `components/shell/app-shell.tsx`

**Interfaces:**
- None new - this task only removes a line from `requiresOrgAdminRole` and adds a nav entry.

- [ ] **Step 1: Update `lib/auth/admin-gate.test.ts`**

Change the existing assertion (from the 2026-09-28 branch) that
`requiresOrgAdminRole("/admin/reports")` is `true` to expect `false`, with a
new `it` alongside the existing members-route one:

```ts
it("leaves /admin/reports open to any admin tier at the gate level (role-scoped in the page itself)", () => {
  expect(requiresOrgAdminRole("/admin/reports")).toBe(false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/auth/admin-gate.test.ts`
Expected: FAIL - `requiresOrgAdminRole("/admin/reports")` still returns `true`.

- [ ] **Step 3: Remove the `/admin/reports` line from `requiresOrgAdminRole`**

Delete `if (isAtOrUnder(pathname, "/admin/reports")) return true;` from
`lib/auth/admin-gate.ts`. Update the function's docstring to drop "and the
reports page" from its list of Org-Admin-exclusive paths.

- [ ] **Step 4: Add `Reports` to `departmentAdminNav` in `components/shell/app-shell.tsx`**

```ts
const departmentAdminNav = [
  { href: "/admin", label: "Home", icon: Home },
  { href: "/courses", label: "Courses", icon: GraduationCap },
  { href: "/admin/content", label: "Content Authoring", icon: BookOpen },
  { href: "/admin/videos", label: "Video Library", icon: Video },
  { href: "/admin/reports", label: "Reports", icon: BarChart3 },
  { href: "/admin/department", label: "Department", icon: Users },
];
```

(`BarChart3` is already imported for `orgAdminNav`'s identical entry.)

- [ ] **Step 5: Run tests and build to verify**

Run: `npx vitest run lib/auth/admin-gate.test.ts && npx tsc --noEmit && npx eslint components/shell/app-shell.tsx lib/auth/admin-gate.ts`
Expected: tests PASS, typecheck and lint clean.

- [ ] **Step 6: Commit**

```bash
git add lib/auth/admin-gate.ts lib/auth/admin-gate.test.ts components/shell/app-shell.tsx
git commit -m "Open /admin/reports to both admin tiers at the gate level"
```

---

### Task 5: Rewrite `/admin/reports/page.tsx` to branch by role

**Files:**
- Modify: `app/(app)/admin/reports/page.tsx`

**Interfaces:**
- Consumes: `listMemberProgress` (Task 1); `getDepartmentAdminDepartmentIds` (existing); `getDepartmentCompletionStats`, `getDepartmentCourseBreakdown` (existing, from `lib/db/department-reporting`); `getOrgStats`, `getDepartmentCompletionBreakdown`, `getMonthlyCompletions` (existing, from `lib/db/org-reporting`); `getUserIdByEmail` (existing).
- Produces: passes a `members: MemberProgressRow[]` prop and an `exportHref: string` prop, ready for Task 6's `MemberProgress` component to consume (Task 6 reads this exact prop shape).

- [ ] **Step 1: Implement the role branch**

Resolve the caller's `userId` via `getUserIdByEmail` (redirect/`notFound()` if
unauthenticated, matching `/admin/department/page.tsx`'s existing pattern).
Resolve `departmentIds` via `getDepartmentAdminDepartmentIds(userId)`
regardless of Entra tier (same reasoning as `/admin/department/page.tsx`'s
comment: this is what makes an Org Admin previewing the Department Admin
role - or one who is also a real Department Admin somewhere - see the scoped
view instead of company-wide data).

- If the caller is a real Org Admin (`isOrgAdmin(session.user?.roles)`,
  checked against the **real** session role, not the effective/preview
  role - `session.user.roles` is never affected by the client-side preview
  toggle): render the existing charts/stat-cards path (`getOrgStats`,
  `getDepartmentCompletionBreakdown`, `getMonthlyCompletions`) plus
  `listMemberProgress()` and `exportHref = "/api/admin/reports/export"`.
- Else (a real Department Admin, or an Org Admin currently previewing that
  role - the page must render the SAME scoped content in both cases, since
  the preview toggle exists specifically to show what a Department Admin
  sees): if `departmentIds.length === 0`, render the existing
  "not assigned yet" empty state copied from `/admin/department/page.tsx`.
  Otherwise resolve `selectedDepartmentId` from `?dept=` the same way
  `/admin/department/page.tsx` does, and render `getDepartmentCompletionStats`
  + `getDepartmentCourseBreakdown` (as stat cards / a table, no Recharts) +
  `listMemberProgress(selectedDepartmentId)` +
  `exportHref = \`/api/admin/reports/export?dept=${selectedDepartmentId}\``.
  No charts in this branch (per spec: monthly trend and the department bar
  chart are Org-Admin-only content on this page).

Wrap each branch's data fetch in try/catch → `<UnavailableState>`, matching
every other page in this codebase. For this task alone (before Task 6
lands), render a `<p>Member Progress coming up</p>` placeholder wherever
`<MemberProgress>` will eventually go, so the page compiles standalone; Task
6 replaces it.

- [ ] **Step 2: Run the build**

Run: `npx tsc --noEmit && npx eslint "app/(app)/admin/reports/page.tsx" && npx next build`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add "app/(app)/admin/reports/page.tsx"
git commit -m "Branch /admin/reports by role, scoped for Department Admins"
```

---

### Task 6: `MemberProgress` client component

**Files:**
- Create: `app/(app)/admin/reports/member-progress.tsx`
- Modify: `app/(app)/admin/reports/page.tsx`

**Interfaces:**
- Consumes: `MemberProgressRow`, `CourseStatusRow` types from `lib/db/member-progress` (Task 1); `members`/`exportHref` props as produced by Task 5's page.
- Produces: `export function MemberProgress({ members, exportHref }: { members: MemberProgressRow[]; exportHref: string })`.

- [ ] **Step 1: Implement the component**

`"use client"`. Local state: a search string and an "overdue only" boolean.
Filtered list = `members` where `displayName`/`email` includes the search
string (case-insensitive) AND (`!overdueOnly || overdueCount > 0`). Render:
a text `<input>` bound to the search state, a checkbox bound to `overdueOnly`
labeled "Needs attention (overdue only)", an `<a href={exportHref} download>
Export CSV</a>`, and a `<Table>` of the filtered rows (Name, Email,
Completed/Total, Overdue). Each row is a `<button>`/clickable element that
toggles an `expandedUserId` state; when a row is expanded and its course
rows haven't been fetched yet, `fetch(\`/api/admin/reports/members/${userId}/courses\`)`
on click, store the result keyed by `userId`, and render a nested `<Table>`
of `CourseStatusRow`s (Course, Status, Due, Completed, Overdue) beneath that
row while loading/loaded/error states are shown inline (a "Loading…" row,
then either the nested table or an inline error message - no
`<UnavailableState>` here, this is a small in-place widget, not a whole
page).

- [ ] **Step 2: Wire it into `app/(app)/admin/reports/page.tsx`**

Replace Task 5's placeholder with
`import { MemberProgress } from "./member-progress";` and
`<MemberProgress members={members} exportHref={exportHref} />` in both
branches.

- [ ] **Step 3: Run the build**

Run: `npx tsc --noEmit && npx eslint "app/(app)/admin/reports" && npx next build`
Expected: clean.

- [ ] **Step 4: Run the full test suite**

Run: `npx vitest run`
Expected: all green (serialized per `vitest.config.ts`; takes a few minutes).

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/admin/reports/member-progress.tsx" "app/(app)/admin/reports/page.tsx"
git commit -m "Add searchable Member Progress table with per-member drill-down"
```
