# Department Admin / Org Admin RBAC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the collapsed generic `"Admin"` role back into real `Learner` / `DepartmentAdmin` / `OrgAdmin` tiers, add a `department_admins` link table recording which department(s) each Department Admin actually administers, gate the existing Org Admin page to Org Admins only, add a new Department-Admin-only "Department" page, add a "Courses" nav tab for both admin tiers, and scope Content Authoring / course creation to the caller's department.

**Architecture:** Next.js App Router + Drizzle ORM + Postgres (Cloud SQL), following every existing pattern in this codebase: a coarse path-based admin gate in `proxy.ts` for "can this person reach `/admin` at all," per-query scoping (never a second coarse gate) for "which rows can they see," and plain join tables (`course_assignments`, `department_course_assignments`) as the precedent for the new `department_admins` table.

**Tech Stack:** TypeScript, Next.js 16 App Router, Drizzle ORM, Postgres (Cloud SQL, no separate test DB — every test must clean up everything it inserts, in FK-safe order, in `try/finally`), Vitest, NextAuth v5 + Microsoft Entra ID.

**Spec:** [docs/superpowers/specs/2026-09-24-department-org-admin-rbac-design.md](../specs/2026-09-24-department-org-admin-rbac-design.md)

## Global Constraints

- No separate test database — `DATABASE_URL` in `.env.local` points at live production Cloud SQL. Every test that inserts a row (`users`, `departments`, `courses`, `department_admins`, etc.) MUST delete everything it inserted, in FK-safe order, inside `try/finally`.
- Never run a migration against production without asking the user for explicit confirmation first, every time — no exceptions, even for a "small" `CREATE TABLE`.
- New migrations follow the established hand-written-SQL workflow (never `drizzle-kit generate --custom`'s interactive diff): write the `.sql` file by hand, generate the paired `meta/NNNN_snapshot.json` via a throwaway script calling `generateDrizzleJson` from `drizzle-kit/api`, append the journal entry, then delete the throwaway script.
- `isAdminRole(roles)` must keep meaning "can reach the admin shell at all" (true for both `DepartmentAdmin` and `OrgAdmin`) — every existing `!isAdminRole(...)` enrollment-bypass check across the learner module pages depends on this and must not regress.
- Department scoping is enforced with per-query filters derived from the signed-in session, never from a client-supplied parameter.
- `npx tsc --noEmit` clean and the full `npx vitest run` suite green after every task, not just at the end.
- Follow this repo's Windows/PowerShell + Bash tool conventions already established (dotenv-cli for `.env.local`-scoped scripts, `--` separators, etc.) — nothing new here, just don't invent a different pattern.

## Review Focus

- **A Department Admin who administers zero departments (assigned the Entra role but not yet tied to any department by an Org Admin) hits `/admin/department`.** A reasonable person expects a clear "you haven't been assigned to a department yet" state, not a crash or an empty page that looks broken. Task 6's page must handle this explicitly.
- **A Department Admin edits the URL to open another department's course builder directly** (`/admin/content/builder/<some-other-departments-course-id>`). Without an explicit ownership check this is a real IDOR, not just a UI omission — Task 8 must 404/403 it server-side, the same anti-IDOR pattern already used throughout the learner module pages.
- **A Department Admin who administers two-plus departments creates a course.** The spec resolves this as "must pick one of their own departments, no global option" — Task 8's tests must actually prove a 2-department admin gets a picker restricted to exactly those two, not silently defaulted or given every department.
- **Someone assigned as a department admin loses the Entra `DepartmentAdmin` role later (demoted to Learner in Entra) but their `department_admins` row is never cleaned up.** Task 3/6 must derive access from `isAdminRole`/`roleFromClaims` on every request (already true for every other role check in this app) — a stale `department_admins` row must never grant access on its own once the person's real role claim no longer says `DepartmentAdmin` or `OrgAdmin`.
- **Removing a department that still has admins or courses tied to it.** Not a feature this plan adds (department deletion doesn't exist today), but Task 2's schema must not leave an orphaned FK story — `department_admins.departmentId` references `departments.id` with no cascade, matching every other FK in this schema, so a future delete path will need the same explicit-cleanup treatment `removeModule`/`deleteCourse` already established. No code to write here, just don't contradict it.

---

## Task 1: Split the role type

**Files:**
- Modify: `lib/roles.ts`
- Test: `lib/roles.test.ts` (new)

**Interfaces:**
- Consumes: nothing new.
- Produces: `export type Role = "Learner" | "DepartmentAdmin" | "OrgAdmin"`, `roleFromClaims(roles): { role: Role; label: string }`, `isAdminRole(roles): boolean` (unchanged meaning), `isOrgAdmin(roles): boolean` (new).

- [ ] **Step 1: Write the failing tests**

```ts
// lib/roles.test.ts
import { describe, it, expect } from "vitest";
import { roleFromClaims, isAdminRole, isOrgAdmin } from "./roles";

describe("roleFromClaims", () => {
  it("resolves OrgAdmin", () => {
    expect(roleFromClaims(["OrgAdmin"])).toEqual({ role: "OrgAdmin", label: "Org Admin" });
  });
  it("resolves DepartmentAdmin", () => {
    expect(roleFromClaims(["DepartmentAdmin"])).toEqual({ role: "DepartmentAdmin", label: "Department Admin" });
  });
  it("defaults to Learner", () => {
    expect(roleFromClaims([])).toEqual({ role: "Learner", label: "Learner" });
    expect(roleFromClaims(undefined)).toEqual({ role: "Learner", label: "Learner" });
  });
  it("prefers OrgAdmin over DepartmentAdmin when both claims are present", () => {
    expect(roleFromClaims(["DepartmentAdmin", "OrgAdmin"])).toEqual({ role: "OrgAdmin", label: "Org Admin" });
  });
});

describe("isAdminRole", () => {
  it("is true for both admin tiers and false for Learner", () => {
    expect(isAdminRole(["OrgAdmin"])).toBe(true);
    expect(isAdminRole(["DepartmentAdmin"])).toBe(true);
    expect(isAdminRole([])).toBe(false);
    expect(isAdminRole(undefined)).toBe(false);
  });
});

describe("isOrgAdmin", () => {
  it("is true only for OrgAdmin", () => {
    expect(isOrgAdmin(["OrgAdmin"])).toBe(true);
    expect(isOrgAdmin(["DepartmentAdmin"])).toBe(false);
    expect(isOrgAdmin([])).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/roles.test.ts`
Expected: FAIL — `isOrgAdmin` is not exported, and `roleFromClaims(["DepartmentAdmin"])` currently returns `{ role: "Admin", label: "Department Admin" }`, not `{ role: "DepartmentAdmin", ... }`.

- [ ] **Step 3: Rewrite `lib/roles.ts`**

```ts
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

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/roles.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors in every file that pattern-matches `role === "Admin"` (this is expected and intentional — Task 4 fixes `components/shell/app-shell.tsx`, the only such file). Confirm the error list is exactly that file before moving on; if anything else errors, stop and investigate rather than proceeding into Task 2 with a broader break.

- [ ] **Step 6: Commit**

```bash
git add lib/roles.ts lib/roles.test.ts
git commit -m "feat: split the collapsed Admin role into DepartmentAdmin/OrgAdmin"
```

---

## Task 2: `department_admins` table + data-access module

**Files:**
- Modify: `lib/db/schema.ts` (add table, right after the existing `courseAssignments`/`departmentCourseAssignments` block)
- Create: `drizzle/migrations/0017_department_admins.sql`
- Create: `drizzle/migrations/meta/0017_snapshot.json` (generated, not hand-written — see Step 4)
- Modify: `drizzle/migrations/meta/_journal.json`
- Create: `lib/db/department-admins.ts`
- Test: `lib/db/department-admins.test.ts` (new)

**Interfaces:**
- Consumes: `db` from `lib/db/client`, `departments`/`users` tables from `lib/db/schema`, `DuplicateAssignmentError` from `lib/db/course-assignments` (reusing the same error class `department_course_assignments.ts` already reuses for its own unique-constraint collisions — same pattern, not a new class).
- Produces:
  - `assignDepartmentAdmin(userId: string, departmentId: string, assignedBy: string | null): Promise<void>` — throws `DuplicateAssignmentError` on a repeat assignment.
  - `removeDepartmentAdmin(userId: string, departmentId: string): Promise<void>`
  - `listAdminsForDepartment(departmentId: string): Promise<{ userId: string; displayName: string; email: string; assignedAt: string }[]>`
  - `getDepartmentAdminDepartmentIds(userId: string): Promise<string[]>` — every task from here on that needs "which department(s) does this signed-in Department Admin administer" calls this.
  - `listDepartmentAdminEligibleUsers(departmentId: string): Promise<{ id: string; email: string; displayName: string }[]>` — users whose synced `entraRole` is exactly `"Department Admin"` and who are not already an admin of this department.

- [ ] **Step 1: Add the table to `lib/db/schema.ts`**

Insert immediately after the existing `departmentCourseAssignments` table definition:

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

- [ ] **Step 2: Hand-write the migration SQL**

```sql
-- drizzle/migrations/0017_department_admins.sql
CREATE TABLE "department_admins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"department_id" uuid NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"assigned_by" text,
	CONSTRAINT "department_admins_user_id_department_id_unique" UNIQUE("user_id","department_id")
);
--> statement-breakpoint
ALTER TABLE "department_admins" ADD CONSTRAINT "department_admins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "department_admins" ADD CONSTRAINT "department_admins_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE no action ON UPDATE no action;
```

- [ ] **Step 3: Append the journal entry**

Read `drizzle/migrations/meta/_journal.json`'s last entry (currently `idx: 15, tag: "0016_department_course_assignments"`) and append:

```json
{
  "idx": 16,
  "version": "7",
  "when": 1789900000000,
  "tag": "0017_department_admins",
  "breakpoints": true
}
```

- [ ] **Step 4: Generate the snapshot**

Read `drizzle/migrations/meta/0016_snapshot.json`'s `"id"` field for the `prevId`. Write a throwaway script:

```ts
// gen-snapshot-0017.ts (delete after running)
import { generateDrizzleJson } from "drizzle-kit/api";
import * as schema from "./lib/db/schema";
import { writeFileSync } from "node:fs";

async function main() {
  const json = await generateDrizzleJson(schema, "<0016's id, read from the file>");
  writeFileSync("drizzle/migrations/meta/0017_snapshot.json", JSON.stringify(json, null, 2) + "\n");
  console.log("wrote snapshot", json.id);
}
main();
```

Run: `npx tsx gen-snapshot-0017.ts`, confirm `drizzle/migrations/meta/0017_snapshot.json` was written, then `rm gen-snapshot-0017.ts`.

- [ ] **Step 5: Ask the user, then apply the migration to production**

Ask: "Applying migration 0017 to production Cloud SQL — creates `department_admins(id, user_id, department_id, assigned_at, assigned_by)` with a unique `(user_id, department_id)` constraint. OK to run it?" Wait for explicit yes.

Then, as three separate small `node -e`/`tsx` scripts against the `postgres` superuser connection (same pattern as every prior migration this session): `CREATE TABLE`, the two `ALTER TABLE ... ADD CONSTRAINT` statements, then `GRANT ALL PRIVILEGES ON department_admins TO ssp_lms_app`.

- [ ] **Step 6: Write the failing tests**

```ts
// lib/db/department-admins.test.ts
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  assignDepartmentAdmin,
  removeDepartmentAdmin,
  listAdminsForDepartment,
  getDepartmentAdminDepartmentIds,
  listDepartmentAdminEligibleUsers,
} from "./department-admins";
import { DuplicateAssignmentError } from "./course-assignments";
import { db } from "./client";
import { departments, users, departmentAdmins } from "./schema";

async function seedDepartment() {
  const [d] = await db.insert(departments).values({ name: `Dept-${randomUUID()}` }).returning();
  return d;
}
async function seedUser(entraRole: string | null) {
  const [u] = await db
    .insert(users)
    .values({ email: `test-${randomUUID()}@example.com`, displayName: "Test User", entraRole })
    .returning();
  return u;
}
async function cleanup(userIds: string[], departmentIds: string[]) {
  await db.delete(departmentAdmins).where(eq(departmentAdmins.userId, userIds[0]));
  for (const id of userIds) await db.delete(users).where(eq(users.id, id));
  for (const id of departmentIds) await db.delete(departments).where(eq(departments.id, id));
}

describe("assignDepartmentAdmin / listAdminsForDepartment / removeDepartmentAdmin", () => {
  it("assigns, lists, then removes", async () => {
    const dept = await seedDepartment();
    const user = await seedUser("Department Admin");
    try {
      await assignDepartmentAdmin(user.id, dept.id, "org-admin@example.com");
      const admins = await listAdminsForDepartment(dept.id);
      expect(admins).toHaveLength(1);
      expect(admins[0].userId).toBe(user.id);

      await removeDepartmentAdmin(user.id, dept.id);
      expect(await listAdminsForDepartment(dept.id)).toHaveLength(0);
    } finally {
      await cleanup([user.id], [dept.id]);
    }
  });

  it("rejects assigning the same user to the same department twice", async () => {
    const dept = await seedDepartment();
    const user = await seedUser("Department Admin");
    try {
      await assignDepartmentAdmin(user.id, dept.id, "org-admin@example.com");
      await expect(assignDepartmentAdmin(user.id, dept.id, "org-admin@example.com")).rejects.toThrow(
        DuplicateAssignmentError
      );
    } finally {
      await cleanup([user.id], [dept.id]);
    }
  });
});

describe("getDepartmentAdminDepartmentIds", () => {
  it("returns every department a user administers", async () => {
    const deptA = await seedDepartment();
    const deptB = await seedDepartment();
    const user = await seedUser("Department Admin");
    try {
      await assignDepartmentAdmin(user.id, deptA.id, "org-admin@example.com");
      await assignDepartmentAdmin(user.id, deptB.id, "org-admin@example.com");
      const ids = await getDepartmentAdminDepartmentIds(user.id);
      expect(ids.sort()).toEqual([deptA.id, deptB.id].sort());
    } finally {
      await cleanup([user.id], [deptA.id, deptB.id]);
    }
  });

  it("returns an empty array for a user who administers no departments", async () => {
    const user = await seedUser("Department Admin");
    try {
      expect(await getDepartmentAdminDepartmentIds(user.id)).toEqual([]);
    } finally {
      await db.delete(users).where(eq(users.id, user.id));
    }
  });
});

describe("listDepartmentAdminEligibleUsers", () => {
  it("only returns users synced with the Department Admin Entra role, excluding existing admins of this department", async () => {
    const dept = await seedDepartment();
    const eligible = await seedUser("Department Admin");
    const alreadyAdmin = await seedUser("Department Admin");
    const learner = await seedUser("Learner");
    try {
      await assignDepartmentAdmin(alreadyAdmin.id, dept.id, "org-admin@example.com");
      const result = await listDepartmentAdminEligibleUsers(dept.id);
      const ids = result.map((u) => u.id);
      expect(ids).toContain(eligible.id);
      expect(ids).not.toContain(alreadyAdmin.id);
      expect(ids).not.toContain(learner.id);
    } finally {
      await cleanup([alreadyAdmin.id], [dept.id]);
      await db.delete(users).where(eq(users.id, eligible.id));
      await db.delete(users).where(eq(users.id, learner.id));
    }
  });
});
```

- [ ] **Step 7: Run tests to verify they fail**

Run: `npx vitest run lib/db/department-admins.test.ts`
Expected: FAIL — `./department-admins` doesn't exist yet.

- [ ] **Step 8: Write `lib/db/department-admins.ts`**

```ts
import { and, eq, notInArray } from "drizzle-orm";
import { db } from "./client";
import { departmentAdmins, users } from "./schema";
import { DuplicateAssignmentError } from "./course-assignments";

export async function assignDepartmentAdmin(
  userId: string,
  departmentId: string,
  assignedBy: string | null
): Promise<void> {
  try {
    await db.insert(departmentAdmins).values({ userId, departmentId, assignedBy });
  } catch (error) {
    const pgCode = (error as { cause?: { code?: string } })?.cause?.code;
    if (pgCode === "23505") {
      throw new DuplicateAssignmentError("This user already administers this department");
    }
    throw error;
  }
}

export async function removeDepartmentAdmin(userId: string, departmentId: string): Promise<void> {
  await db
    .delete(departmentAdmins)
    .where(and(eq(departmentAdmins.userId, userId), eq(departmentAdmins.departmentId, departmentId)));
}

export async function listAdminsForDepartment(
  departmentId: string
): Promise<{ userId: string; displayName: string; email: string; assignedAt: string }[]> {
  const rows = await db
    .select({
      userId: users.id,
      displayName: users.displayName,
      email: users.email,
      assignedAt: departmentAdmins.assignedAt,
    })
    .from(departmentAdmins)
    .innerJoin(users, eq(users.id, departmentAdmins.userId))
    .where(eq(departmentAdmins.departmentId, departmentId))
    .orderBy(departmentAdmins.assignedAt);
  return rows.map((r) => ({ ...r, assignedAt: r.assignedAt.toISOString() }));
}

export async function getDepartmentAdminDepartmentIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ departmentId: departmentAdmins.departmentId })
    .from(departmentAdmins)
    .where(eq(departmentAdmins.userId, userId));
  return rows.map((r) => r.departmentId);
}

export async function listDepartmentAdminEligibleUsers(
  departmentId: string
): Promise<{ id: string; email: string; displayName: string }[]> {
  const alreadyAdminIds = (
    await db
      .select({ userId: departmentAdmins.userId })
      .from(departmentAdmins)
      .where(eq(departmentAdmins.departmentId, departmentId))
  ).map((r) => r.userId);

  const conditions = [eq(users.entraRole, "Department Admin")];
  if (alreadyAdminIds.length > 0) {
    conditions.push(notInArray(users.id, alreadyAdminIds));
  }

  return db
    .select({ id: users.id, email: users.email, displayName: users.displayName })
    .from(users)
    .where(and(...conditions))
    .orderBy(users.displayName);
}
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `npx vitest run lib/db/department-admins.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 10: Typecheck, then run the full suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean typecheck; only the pre-existing Task-1-caused `app-shell.tsx` errors remain until Task 4.

- [ ] **Step 11: Commit**

```bash
git add lib/db/schema.ts drizzle/migrations/0017_department_admins.sql drizzle/migrations/meta/0017_snapshot.json drizzle/migrations/meta/_journal.json lib/db/department-admins.ts lib/db/department-admins.test.ts
git commit -m "feat: add department_admins link table and data-access module"
```

---

## Task 3: Org-Admin-only route gating

**Files:**
- Modify: `lib/auth/admin-gate.ts`
- Modify: `proxy.ts`
- Test: `lib/auth/admin-gate.test.ts`

**Interfaces:**
- Consumes: `isOrgAdmin` from `lib/roles` (Task 1).
- Produces: `requiresOrgAdminRole(pathname: string): boolean`.

- [ ] **Step 1: Write the failing tests**

Add to `lib/auth/admin-gate.test.ts`:

```ts
import { requiresOrgAdminRole } from "./admin-gate";

describe("requiresOrgAdminRole", () => {
  it("gates the Org Admin page and department management API", () => {
    expect(requiresOrgAdminRole("/admin/org")).toBe(true);
    expect(requiresOrgAdminRole("/admin/org/departments/abc")).toBe(true);
    expect(requiresOrgAdminRole("/api/admin/departments")).toBe(true);
    expect(requiresOrgAdminRole("/api/admin/departments/abc/members")).toBe(true);
  });

  it("does NOT gate department-scoped actions a Department Admin should still reach", () => {
    expect(requiresOrgAdminRole("/api/admin/departments/abc/course-assignments")).toBe(false);
  });

  it("leaves every other admin path ungated by this check", () => {
    expect(requiresOrgAdminRole("/admin")).toBe(false);
    expect(requiresOrgAdminRole("/admin/content")).toBe(false);
    expect(requiresOrgAdminRole("/admin/department")).toBe(false);
    expect(requiresOrgAdminRole("/courses")).toBe(false);
  });

  it("does not treat a path that merely starts with the same letters as Org-Admin-only", () => {
    expect(requiresOrgAdminRole("/admin/organization-chart")).toBe(false);
  });
});
```

Note: the second test above expects `/api/admin/departments/abc/course-assignments` to NOT be gated Org-Admin-only, but the first test expects `/api/admin/departments/abc/members` TO be gated Org-Admin-only — both are sub-paths of `/api/admin/departments/abc`. This means the implementation cannot gate by a prefix on `/api/admin/departments/<id>` as a whole; it must distinguish the `/members` suffix from the `/course-assignments` suffix explicitly. Reflect this precisely in Step 3.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/auth/admin-gate.test.ts`
Expected: FAIL — `requiresOrgAdminRole` is not exported.

- [ ] **Step 3: Implement `requiresOrgAdminRole`**

```ts
// lib/auth/admin-gate.ts — add below the existing requiresAdminRole/adminForbiddenResponse

/**
 * Does this path require the Org Admin tier specifically (not just any
 * admin)? Department creation, the top-level department list, and roster
 * membership changes are Org-Admin-exclusive; a department's OWN
 * course-assignment endpoint stays open to a Department Admin administering
 * that department - `requiresAdminRole` already gates the whole tree to
 * "some admin," and per-route/query scoping (not this function) decides
 * whose department they can act on. Roster membership (`/members`) is
 * listed explicitly here rather than matched by a `/api/admin/departments`
 * prefix, since that prefix would also (wrongly) catch `/course-assignments`.
 */
export function requiresOrgAdminRole(pathname: string): boolean {
  if (isAtOrUnder(pathname, "/admin/org")) return true;
  if (pathname === "/api/admin/departments") return true;
  if (/^\/api\/admin\/departments\/[^/]+\/members$/.test(pathname)) return true;
  return false;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/auth/admin-gate.test.ts`
Expected: PASS (all `requiresAdminRole` tests still pass, plus the new `requiresOrgAdminRole` tests)

- [ ] **Step 5: Wire it into `proxy.ts`**

```ts
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isAdminRole, isOrgAdmin } from "@/lib/roles";
import { requiresAdminRole, requiresOrgAdminRole, adminForbiddenResponse } from "@/lib/auth/admin-gate";

export default auth((req) => {
  if (!req.auth) {
    const signInUrl = new URL("/sign-in", req.url);
    signInUrl.searchParams.set("callbackUrl", req.nextUrl.pathname + req.nextUrl.search);
    return NextResponse.redirect(signInUrl);
  }

  if (requiresAdminRole(req.nextUrl.pathname) && !isAdminRole(req.auth.user?.roles)) {
    return adminForbiddenResponse(req.nextUrl.pathname, req.url);
  }
  if (requiresOrgAdminRole(req.nextUrl.pathname) && !isOrgAdmin(req.auth.user?.roles)) {
    return adminForbiddenResponse(req.nextUrl.pathname, req.url);
  }
});

export const config = {
  matcher: [
    "/((?!sign-in|api/auth|api/admin/entra-sync/cron|_next/static|_next/image|favicon.ico|icon.png|logo-horizontal-blue.png|logo-horizontal-white.png|logo-shield-blue.png|logo-shield-white.png).*)",
  ],
};
```

- [ ] **Step 6: Run the full suite and typecheck**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean, still only the pending `app-shell.tsx` role-string errors until Task 4.

- [ ] **Step 7: Commit**

```bash
git add lib/auth/admin-gate.ts lib/auth/admin-gate.test.ts proxy.ts
git commit -m "feat: gate the Org Admin page and department-management API to Org Admins only"
```

---

## Task 4: Nav split + role switcher fix (`components/shell/app-shell.tsx`)

**Files:**
- Modify: `components/shell/app-shell.tsx`

**Interfaces:**
- Consumes: `Role`, `roleFromClaims` from `lib/roles` (Task 1).
- Produces: no exported interface — this is the leaf UI shell.

This is the file every `role === "Admin"` string comparison broke in Task 1's typecheck. Fix all of them and split the nav.

- [ ] **Step 1: Replace the nav arrays**

```ts
// Add GraduationCap to the lucide-react import list alongside the existing icons.
import {
  Home,
  BookOpen,
  Video,
  BarChart3,
  Users,
  Settings,
  GraduationCap,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";

const learnerNav = [
  { href: "/", label: "Home", icon: Home },
  { href: "/courses", label: "Courses", icon: BookOpen },
];

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

- [ ] **Step 2: Fix `homeFor`**

```ts
function homeFor(role: Role) {
  return role === "Learner" ? "/" : "/admin";
}
```

- [ ] **Step 3: Fix the role-derivation and test-role-switcher logic**

Replace the block from `const canOverrideRole = ...` through `const isTestOverride = ...`:

```ts
  const canOverrideRole = real?.role === "DepartmentAdmin" || real?.role === "OrgAdmin";
  // Even a stale localStorage value from before a role change can't self-escalate a non-admin,
  // and can't hand a Department Admin the Org Admin tier (or vice versa) - the only override
  // this menu ever offers is "preview as Learner" vs "my real admin role."
  const effectiveTestRole = canOverrideRole && testRole === "Learner" ? "Learner" : null;
  const role: Role = effectiveTestRole ?? real?.role ?? "Learner";
  const roleLabel = effectiveTestRole ?? real?.label ?? "Learner";
  const isTestOverride = effectiveTestRole !== null;
```

- [ ] **Step 4: Fix the localStorage restore effect**

```ts
    const storedTestRole = localStorage.getItem("test-role");
    if (storedTestRole === "Learner") {
      setTestRole(storedTestRole);
    }
```

- [ ] **Step 5: Fix `updateTestRole`'s push target and the redirect effect**

```ts
  const updateTestRole = (next: "Learner" | null) => {
    setTestRole(next);
    if (next) {
      localStorage.setItem("test-role", next);
    } else {
      localStorage.removeItem("test-role");
    }
    router.push(homeFor(next ?? real?.role ?? "Learner"));
  };

  useEffect(() => {
    // Landing on "/" as a real admin (either tier) would otherwise show the
    // Learner home page under the admin nav - send them to their own home instead.
    if (pathname === "/" && role !== "Learner") {
      router.replace("/admin");
    }
  }, [pathname, role, router]);
```

- [ ] **Step 6: Fix `navItems` selection and the dropdown menu copy**

```ts
  const navItems = role === "Learner" ? learnerNav : role === "OrgAdmin" ? orgAdminNav : departmentAdminNav;
```

In the JSX, replace the two `DropdownMenuItem`s:

```tsx
                  <DropdownMenuItem onClick={() => updateTestRole("Learner")}>
                    Learner
                  </DropdownMenuItem>
                  {isTestOverride && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => updateTestRole(null)}>
                        Use real role ({real?.label})
                      </DropdownMenuItem>
                    </>
                  )}
```

(Drops the old always-present "Admin" menu item — there is no longer a single generic "Admin" to preview as; the only override this menu offers now is "preview as Learner.")

- [ ] **Step 7: Update `testRole`'s type**

```ts
  const [testRole, setTestRole] = useState<"Learner" | null>(null);
```

- [ ] **Step 8: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean — this was the only file left erroring after Task 1.

- [ ] **Step 9: Run the full suite**

Run: `npx vitest run`
Expected: all still green (no test file covers this client component directly; this step confirms nothing else regressed).

- [ ] **Step 10: Browser-verify**

Start the preview, sign in as the real Org Admin account, confirm the nav shows Home/Content Authoring/Video Library/Reports/Org Admin/Courses. Confirm the "Viewing as" switcher only offers "Learner" now (not a generic "Admin" option). There is no real Department Admin account to sign in as yet (Task 6 note: ask the user whether any real Entra user already holds the Department Admin role for a true end-to-end check, or verify the nav rendering logic via a temporary local render/test instead).

- [ ] **Step 11: Commit**

```bash
git add components/shell/app-shell.tsx
git commit -m "feat: split admin nav into Org Admin / Department Admin variants"
```

---

## Task 5: Department-admin assignment UI

**Files:**
- Create: `app/api/admin/department-admins/route.ts` (POST — assign)
- Create: `app/api/admin/department-admins/[userId]/[departmentId]/route.ts` (DELETE — remove)
- Test: `app/api/admin/department-admins/route.test.ts` (new)
- Create: `app/(app)/admin/org/departments/[id]/department-admins-client.tsx`
- Modify: `app/(app)/admin/org/departments/[id]/page.tsx` (add the new card)

**Interfaces:**
- Consumes: `assignDepartmentAdmin`, `removeDepartmentAdmin`, `listAdminsForDepartment`, `listDepartmentAdminEligibleUsers` from `lib/db/department-admins` (Task 2).
- Produces: nothing further downstream — this is a leaf feature.

This mirrors `app/(app)/admin/org/departments/[id]/roster-client.tsx` and its `PATCH`/`DELETE` route almost exactly; read that file for the pattern before writing this one; the deviation from the spec's original wording ("New Department dialog... gets an Admins picker") is intentional — matching how Roster and Courses already work on this same page (create with just a name, then populate on the detail page), the Admins card lives on the detail page, not the creation dialog.

- [ ] **Step 1: Write the failing route test**

```ts
// app/api/admin/department-admins/route.test.ts
import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { POST } from "./route";
import { DELETE } from "./[userId]/[departmentId]/route";
import { db } from "@/lib/db/client";
import { departments, users, departmentAdmins } from "@/lib/db/schema";

describe("POST /api/admin/department-admins", () => {
  it("assigns a user as an admin of a department", async () => {
    const [dept] = await db.insert(departments).values({ name: `Dept-${randomUUID()}` }).returning();
    const [user] = await db
      .insert(users)
      .values({ email: `${randomUUID()}@example.com`, displayName: "Test", entraRole: "Department Admin" })
      .returning();
    try {
      const request = new NextRequest("http://localhost/api/admin/department-admins", {
        method: "POST",
        body: JSON.stringify({ userId: user.id, departmentId: dept.id }),
      });
      const response = await POST(request);
      expect(response.status).toBe(200);

      const [row] = await db.select().from(departmentAdmins).where(eq(departmentAdmins.userId, user.id));
      expect(row.departmentId).toBe(dept.id);
    } finally {
      await db.delete(departmentAdmins).where(eq(departmentAdmins.userId, user.id));
      await db.delete(users).where(eq(users.id, user.id));
      await db.delete(departments).where(eq(departments.id, dept.id));
    }
  });

  it("returns 409 for a duplicate assignment", async () => {
    const [dept] = await db.insert(departments).values({ name: `Dept-${randomUUID()}` }).returning();
    const [user] = await db
      .insert(users)
      .values({ email: `${randomUUID()}@example.com`, displayName: "Test", entraRole: "Department Admin" })
      .returning();
    try {
      const first = new NextRequest("http://localhost/api/admin/department-admins", {
        method: "POST",
        body: JSON.stringify({ userId: user.id, departmentId: dept.id }),
      });
      await POST(first);
      const second = new NextRequest("http://localhost/api/admin/department-admins", {
        method: "POST",
        body: JSON.stringify({ userId: user.id, departmentId: dept.id }),
      });
      const response = await POST(second);
      expect(response.status).toBe(409);
    } finally {
      await db.delete(departmentAdmins).where(eq(departmentAdmins.userId, user.id));
      await db.delete(users).where(eq(users.id, user.id));
      await db.delete(departments).where(eq(departments.id, dept.id));
    }
  });
});

describe("DELETE /api/admin/department-admins/[userId]/[departmentId]", () => {
  it("removes the assignment", async () => {
    const [dept] = await db.insert(departments).values({ name: `Dept-${randomUUID()}` }).returning();
    const [user] = await db
      .insert(users)
      .values({ email: `${randomUUID()}@example.com`, displayName: "Test", entraRole: "Department Admin" })
      .returning();
    await db.insert(departmentAdmins).values({ userId: user.id, departmentId: dept.id });
    try {
      const request = new NextRequest(
        `http://localhost/api/admin/department-admins/${user.id}/${dept.id}`,
        { method: "DELETE" }
      );
      const response = await DELETE(request, { params: Promise.resolve({ userId: user.id, departmentId: dept.id }) });
      expect(response.status).toBe(200);
      expect(await db.select().from(departmentAdmins).where(eq(departmentAdmins.userId, user.id))).toHaveLength(0);
    } finally {
      await db.delete(users).where(eq(users.id, user.id));
      await db.delete(departments).where(eq(departments.id, dept.id));
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run app/api/admin/department-admins/route.test.ts`
Expected: FAIL — routes don't exist.

- [ ] **Step 3: Write `app/api/admin/department-admins/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { badRequest, isUuid, serverError } from "@/lib/api/errors";
import { assignDepartmentAdmin } from "@/lib/db/department-admins";
import { DuplicateAssignmentError } from "@/lib/db/course-assignments";

export async function POST(request: NextRequest) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return badRequest("Request body must be valid JSON");
    }
    const { userId, departmentId } = (body ?? {}) as { userId?: string; departmentId?: string };
    if (!userId || !isUuid(userId) || !departmentId || !isUuid(departmentId)) {
      return badRequest("userId and departmentId must be UUIDs");
    }

    const session = await auth();
    try {
      await assignDepartmentAdmin(userId, departmentId, session?.user?.email ?? null);
    } catch (error) {
      if (error instanceof DuplicateAssignmentError) {
        return NextResponse.json({ error: error.message }, { status: 409 });
      }
      throw error;
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return serverError(error);
  }
}
```

- [ ] **Step 4: Write `app/api/admin/department-admins/[userId]/[departmentId]/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { badRequest, isUuid, serverError } from "@/lib/api/errors";
import { removeDepartmentAdmin } from "@/lib/db/department-admins";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ userId: string; departmentId: string }> }
) {
  try {
    const { userId, departmentId } = await params;
    if (!isUuid(userId) || !isUuid(departmentId)) {
      return badRequest("userId and departmentId must be UUIDs");
    }
    await removeDepartmentAdmin(userId, departmentId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return serverError(error);
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run app/api/admin/department-admins`
Expected: PASS (3 tests)

- [ ] **Step 6: Build the client component**

```tsx
// app/(app)/admin/org/departments/[id]/department-admins-client.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Admin {
  userId: string;
  displayName: string;
  email: string;
}

interface EligibleUser {
  id: string;
  displayName: string;
  email: string;
}

export function DepartmentAdminsClient({
  departmentId,
  admins,
  eligibleUsers,
}: {
  departmentId: string;
  admins: Admin[];
  eligibleUsers: EligibleUser[];
}) {
  const router = useRouter();
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleAdd() {
    if (!selectedUserId) return;
    setAdding(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/department-admins", {
        method: "POST",
        body: JSON.stringify({ userId: selectedUserId, departmentId }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setError(body?.error ?? "Could not add admin");
        setAdding(false);
        return;
      }
      setSelectedUserId(null);
      setAdding(false);
      router.refresh();
    } catch {
      setError("Could not add admin");
      setAdding(false);
    }
  }

  async function handleRemove(userId: string) {
    setRemovingId(userId);
    setError(null);
    try {
      const response = await fetch(`/api/admin/department-admins/${userId}/${departmentId}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        setError("Could not remove admin");
        setRemovingId(null);
        return;
      }
      setRemovingId(null);
      router.refresh();
    } catch {
      setError("Could not remove admin");
      setRemovingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Select value={selectedUserId} onValueChange={(value) => setSelectedUserId(value as string)}>
          <SelectTrigger className="min-w-56">
            <SelectValue placeholder={eligibleUsers.length === 0 ? "No eligible users" : "Choose a user"} />
          </SelectTrigger>
          <SelectContent>
            {eligibleUsers.map((user) => (
              <SelectItem key={user.id} value={user.id}>
                {user.displayName} ({user.email})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button onClick={handleAdd} disabled={!selectedUserId || adding}>
          {adding ? "Adding…" : "Add"}
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <p className="text-xs text-muted-foreground">
        Only users currently holding the Department Admin role in Entra are eligible.
      </p>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {admins.length === 0 ? (
            <TableRow>
              <TableCell colSpan={3} className="text-center text-sm text-muted-foreground">
                No admins assigned yet.
              </TableCell>
            </TableRow>
          ) : (
            admins.map((admin) => (
              <TableRow key={admin.userId}>
                <TableCell className="font-medium">{admin.displayName}</TableCell>
                <TableCell>{admin.email}</TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Remove as department admin"
                    disabled={removingId === admin.userId}
                    onClick={() => handleRemove(admin.userId)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
```

- [ ] **Step 7: Wire it into the department detail page**

In `app/(app)/admin/org/departments/[id]/page.tsx`, alongside the existing Roster/Courses cards, add:

```tsx
import { listAdminsForDepartment, listDepartmentAdminEligibleUsers } from "@/lib/db/department-admins";
import { DepartmentAdminsClient } from "./department-admins-client";

// inside the page component, alongside the existing department/eligibleUsers loads:
const admins = await listAdminsForDepartment(department.id);
const eligibleAdmins = await listDepartmentAdminEligibleUsers(department.id);

// in the JSX, a new Card before or after the existing Roster card:
<Card>
  <CardHeader>
    <CardTitle className="text-base">Admins</CardTitle>
  </CardHeader>
  <CardContent>
    <DepartmentAdminsClient departmentId={department.id} admins={admins} eligibleUsers={eligibleAdmins} />
  </CardContent>
</Card>
```

- [ ] **Step 8: Typecheck and run the full suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean.

- [ ] **Step 9: Browser-verify**

Sign in as Org Admin, open a department, confirm the new Admins card lists only users with `entraRole = "Department Admin"`, assign one, confirm it appears and the eligible-list drops them, remove them, confirm they're gone.

- [ ] **Step 10: Commit**

```bash
git add app/api/admin/department-admins app/(app)/admin/org/departments/[id]/department-admins-client.tsx "app/(app)/admin/org/departments/[id]/page.tsx"
git commit -m "feat: let Org Admins assign Department Admins to a department"
```

---

## Task 6: `/admin/department` page

**Files:**
- Create: `app/(app)/admin/department/page.tsx`
- Create: `app/(app)/admin/department/department-view.tsx`
- Create: `lib/db/department-reporting.ts`
- Test: `lib/db/department-reporting.test.ts` (new)

**Interfaces:**
- Consumes: `getDepartmentAdminDepartmentIds` (Task 2), `getDepartmentWithMembers` (existing, `lib/db/departments.ts`), `DepartmentCoursesClient` (existing, built earlier this session — already scoped by URL param, needs no change), `isOrgAdmin`/`isAdminRole` (Task 1).
- Produces: `getDepartmentCompletionStats(departmentId: string): Promise<{ completed: number; inProgress: number; notStarted: number }>` (percentages, real data — not the mock `lib/mock-data/reporting` numbers the existing `/admin/org` page still uses for its own summary table, which stays out of scope for this plan).

The spec says "reuse existing per-department report query" but no real one exists yet — `/admin/org`'s "Department Completion Summary" table reads from mock data (`lib/mock-data/reporting`). Building the full real reporting system is explicitly out of scope (tracked separately as Phase 7 in the project roadmap). This task adds one small, real, department-scoped query instead of reusing the mock numbers, since handing a real Department Admin fake percentages for their own department would be actively misleading.

- [ ] **Step 1: Write the failing test**

```ts
// lib/db/department-reporting.test.ts
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDepartmentCompletionStats } from "./department-reporting";
import { db } from "./client";
import { departments, users, courses, enrollments } from "./schema";

describe("getDepartmentCompletionStats", () => {
  it("buckets a department's enrollments by status as percentages", async () => {
    const [dept] = await db.insert(departments).values({ name: `Dept-${randomUUID()}` }).returning();
    const [course] = await db.insert(courses).values({ code: `REPORT-${randomUUID()}`, title: "x" }).returning();
    const userIds: string[] = [];
    const statuses = ["completed", "completed", "in_progress", "not_started"];
    for (const status of statuses) {
      const [user] = await db
        .insert(users)
        .values({ email: `${randomUUID()}@example.com`, displayName: "x", departmentId: dept.id })
        .returning();
      userIds.push(user.id);
      await db.insert(enrollments).values({ userId: user.id, courseId: course.id, status });
    }

    try {
      const stats = await getDepartmentCompletionStats(dept.id);
      expect(stats).toEqual({ completed: 50, inProgress: 25, notStarted: 25 });
    } finally {
      await db.delete(enrollments).where(eq(enrollments.courseId, course.id));
      await db.delete(courses).where(eq(courses.id, course.id));
      for (const id of userIds) await db.delete(users).where(eq(users.id, id));
      await db.delete(departments).where(eq(departments.id, dept.id));
    }
  });

  it("returns all zeros for a department with no enrollments", async () => {
    const [dept] = await db.insert(departments).values({ name: `Dept-${randomUUID()}` }).returning();
    try {
      expect(await getDepartmentCompletionStats(dept.id)).toEqual({ completed: 0, inProgress: 0, notStarted: 0 });
    } finally {
      await db.delete(departments).where(eq(departments.id, dept.id));
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/db/department-reporting.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write `lib/db/department-reporting.ts`**

```ts
import { eq } from "drizzle-orm";
import { db } from "./client";
import { users, enrollments } from "./schema";

export interface DepartmentCompletionStats {
  completed: number;
  inProgress: number;
  notStarted: number;
}

export async function getDepartmentCompletionStats(departmentId: string): Promise<DepartmentCompletionStats> {
  const rows = await db
    .select({ status: enrollments.status })
    .from(enrollments)
    .innerJoin(users, eq(users.id, enrollments.userId))
    .where(eq(users.departmentId, departmentId));

  if (rows.length === 0) {
    return { completed: 0, inProgress: 0, notStarted: 0 };
  }

  const completed = rows.filter((r) => r.status === "completed").length;
  const inProgress = rows.filter((r) => r.status === "in_progress").length;
  const notStarted = rows.length - completed - inProgress;

  return {
    completed: Math.round((completed / rows.length) * 100),
    inProgress: Math.round((inProgress / rows.length) * 100),
    notStarted: Math.round((notStarted / rows.length) * 100),
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/db/department-reporting.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Write the page**

```tsx
// app/(app)/admin/department/page.tsx
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { getUserIdByEmail } from "@/lib/db/users";
import { getDepartmentAdminDepartmentIds } from "@/lib/db/department-admins";
import { isOrgAdmin } from "@/lib/roles";
import { UnavailableState } from "@/components/ui/unavailable-state";
import { DepartmentView } from "./department-view";

export default async function DepartmentAdminPage(props: {
  searchParams: Promise<{ dept?: string }>;
}) {
  const session = await auth();
  const userEmail = session?.user?.email;
  if (!userEmail) notFound();

  // An Org Admin has no personal "my department" - this page is exclusively
  // for the Department Admin tier's own scoped view.
  if (isOrgAdmin(session.user?.roles)) notFound();

  const userId = await getUserIdByEmail(userEmail);
  if (!userId) notFound();

  let departmentIds: string[];
  try {
    departmentIds = await getDepartmentAdminDepartmentIds(userId);
  } catch {
    return <UnavailableState message="Could not load your department right now. Please try again in a moment." />;
  }

  if (departmentIds.length === 0) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col items-center gap-2 py-16 text-center">
        <h1 className="text-xl font-semibold">No department assigned yet</h1>
        <p className="text-sm text-muted-foreground">
          You have Department Admin access, but an Org Admin hasn&apos;t assigned you to a
          department yet. Ask an Org Admin to add you from the Org Admin page.
        </p>
      </div>
    );
  }

  const { dept: selectedFromQuery } = await props.searchParams;
  const selectedDepartmentId =
    selectedFromQuery && departmentIds.includes(selectedFromQuery) ? selectedFromQuery : departmentIds[0];

  return <DepartmentView departmentIds={departmentIds} selectedDepartmentId={selectedDepartmentId} />;
}
```

- [ ] **Step 6: Write the view component**

```tsx
// app/(app)/admin/department/department-view.tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { UnavailableState } from "@/components/ui/unavailable-state";
import { getDepartmentWithMembers } from "@/lib/db/departments";
import { getDepartmentCompletionStats } from "@/lib/db/department-reporting";
import { DepartmentCoursesClient } from "@/app/(app)/admin/org/departments/[id]/department-courses-client";

export async function DepartmentView({
  departmentIds,
  selectedDepartmentId,
}: {
  departmentIds: string[];
  selectedDepartmentId: string;
}) {
  let department, stats;
  try {
    department = await getDepartmentWithMembers(selectedDepartmentId);
    if (!department) notFound();
    stats = await getDepartmentCompletionStats(selectedDepartmentId);
  } catch {
    return <UnavailableState message="Could not load this department right now. Please try again in a moment." />;
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{department.name}</h1>
        {departmentIds.length > 1 && (
          <div className="mt-2 flex gap-2 text-sm">
            {departmentIds.map((id) => (
              <Link
                key={id}
                href={`/admin/department?dept=${id}`}
                className={id === selectedDepartmentId ? "font-medium underline" : "text-muted-foreground hover:underline"}
              >
                {id === selectedDepartmentId ? department.name : id}
              </Link>
            ))}
          </div>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Completion</CardTitle>
        </CardHeader>
        <CardContent className="flex gap-6 text-sm">
          <span>Completed: <span className="font-medium">{stats.completed}%</span></span>
          <span>In progress: <span className="font-medium">{stats.inProgress}%</span></span>
          <span>Not started: <span className="font-medium">{stats.notStarted}%</span></span>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Users</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {department.members.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={2} className="text-center text-sm text-muted-foreground">
                    No members yet.
                  </TableCell>
                </TableRow>
              ) : (
                department.members.map((member) => (
                  <TableRow key={member.id}>
                    <TableCell className="font-medium">{member.displayName}</TableCell>
                    <TableCell>{member.email}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Courses</CardTitle>
        </CardHeader>
        <CardContent>
          <DepartmentCoursesClient departmentId={selectedDepartmentId} />
        </CardContent>
      </Card>
    </div>
  );
}
```

Note the multi-department switcher above is a minimal placeholder (renders raw department ids, not names, for every department except the selected one) — `getDepartmentAdminDepartmentIds` only returns ids. If the user has more than one department in practice, revisit this in a follow-up pass to fetch each department's name for the switcher labels; flagging rather than silently shipping mislabeled links.

**`DepartmentCoursesClient` must already have a named export** from its current file (`app/(app)/admin/org/departments/[id]/department-courses-client.tsx` — built earlier this session; confirm before relying on the import). Confirm importing it cross-route-group like this resolves correctly under the App Router; if the import path causes issues, move the component to a shared location (e.g. `components/admin/department-courses-client.tsx`) and update both this file and the original department detail page to import from there instead of duplicating it.

- [ ] **Step 7: Typecheck and run the full suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean.

- [ ] **Step 8: Browser-verify**

This requires a real signed-in Department Admin. Ask the user: is there a real Entra user already holding the Department Admin role who can sign in for this check? If not, verify as far as possible by temporarily and locally forcing the session role in a scratch script/test, or defer full live verification to right after Task 5 (once an Org Admin has actually assigned someone) — do not skip verification silently, say explicitly which parts were and weren't checked live.

- [ ] **Step 9: Commit**

```bash
git add app/(app)/admin/department lib/db/department-reporting.ts lib/db/department-reporting.test.ts
git commit -m "feat: add the Department Admin's scoped Department page"
```

---

## Task 7: Scope Content Authoring's course list

**Files:**
- Modify: `lib/db/queries.ts` (`listRealCourses`)
- Modify: `app/api/admin/courses/list/route.ts`
- Test: `lib/db/queries.test.ts`

**Interfaces:**
- Consumes: `getDepartmentAdminDepartmentIds` (Task 2), `isOrgAdmin` (Task 1).
- Produces: `listRealCourses(departmentIds?: string[]): Promise<RealCourseSummary[]>` — when provided, filters to courses whose `departmentId` is in the list; when omitted, behaves exactly as today (all courses).

- [ ] **Step 1: Write the failing test**

Add to `lib/db/queries.test.ts`, inside the existing `describe("listRealCourses", ...)` block (confirm `departments` is already imported in this file's top-level import list — it is, used by other tests in the same file):

```ts
  it("filters to the given department ids when provided", async () => {
    const [dept] = await db.insert(departments).values({ name: `Dept-${randomUUID()}` }).returning();
    const [inDept] = await db
      .insert(courses)
      .values({ code: `SCOPE-IN-${randomUUID()}`, title: "In Dept", departmentId: dept.id })
      .returning();
    const [outOfDept] = await db
      .insert(courses)
      .values({ code: `SCOPE-OUT-${randomUUID()}`, title: "Out of Dept" })
      .returning();
    try {
      const scoped = await listRealCourses([dept.id]);
      expect(scoped.map((c) => c.id)).toContain(inDept.id);
      expect(scoped.map((c) => c.id)).not.toContain(outOfDept.id);

      const unscoped = await listRealCourses();
      expect(unscoped.map((c) => c.id)).toContain(inDept.id);
      expect(unscoped.map((c) => c.id)).toContain(outOfDept.id);
    } finally {
      await db.delete(courses).where(eq(courses.id, inDept.id));
      await db.delete(courses).where(eq(courses.id, outOfDept.id));
      await db.delete(departments).where(eq(departments.id, dept.id));
    }
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/db/queries.test.ts`
Expected: FAIL — `listRealCourses` doesn't accept an argument yet, so the "filters to" assertion returns everything.

- [ ] **Step 3: Update `listRealCourses`**

```ts
import { and, eq, inArray, sql } from "drizzle-orm";
// ... existing imports stay, add inArray ...

export async function listRealCourses(departmentIds?: string[]): Promise<RealCourseSummary[]> {
  const base = db
    .select(courseSummaryColumns)
    .from(courses)
    .leftJoin(modules, eq(modules.courseId, courses.id))
    .leftJoin(departments, eq(departments.id, courses.departmentId));

  const rows = await (departmentIds ? base.where(inArray(courses.departmentId, departmentIds)) : base)
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

Branching on whether `.where(...)` is called at all (rather than passing `.where(undefined)`) avoids depending on undocumented Drizzle behavior — verified by running Step 2's test, which fails loudly on either branch if the query shape is wrong.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/db/queries.test.ts`
Expected: PASS

- [ ] **Step 5: Scope the API route**

```ts
// app/api/admin/courses/list/route.ts
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { listRealCourses, getCourseForBuilder } from "@/lib/db/queries";
import { getUserIdByEmail } from "@/lib/db/users";
import { getDepartmentAdminDepartmentIds } from "@/lib/db/department-admins";
import { isOrgAdmin } from "@/lib/roles";
import { serverError } from "@/lib/api/errors";

export async function GET() {
  try {
    const session = await auth();
    let departmentIds: string[] | undefined;
    if (!isOrgAdmin(session?.user?.roles)) {
      const userId = session?.user?.email ? await getUserIdByEmail(session.user.email) : null;
      departmentIds = userId ? await getDepartmentAdminDepartmentIds(userId) : [];
    }

    const summaries = await listRealCourses(departmentIds);
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

- [ ] **Step 6: Confirm `/admin/content` needs no page-level change**

Read `app/(app)/admin/content/page.tsx`: it fetches `/api/admin/courses/list` client-side and renders whatever it gets back, with no independent server-side course query of its own — since the API route now self-scopes from the session, the page component needs no edit. If this reading turns out to be stale (the file has an independent `listRealCourses` call by the time this task runs), scope that call the same way as Step 5 instead.

- [ ] **Step 7: Typecheck and run the full suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean.

- [ ] **Step 8: Browser-verify**

As Org Admin: confirm `/admin/content` still lists every course including the 5 real ones seeded earlier this session. (Full Department-Admin-side verification of this scoping happens in Task 8, once course creation/ownership is wired up — there is no real department-owned course yet to verify against here.)

- [ ] **Step 9: Commit**

```bash
git add lib/db/queries.ts lib/db/queries.test.ts app/api/admin/courses/list/route.ts
git commit -m "feat: scope the admin course list to a Department Admin's own department"
```

---

## Task 8: Department-scoped course creation and builder access lock

**Files:**
- Modify: `app/api/admin/courses/route.ts` (POST — create)
- Modify: `app/(app)/admin/content/builder/[courseId]/page.tsx`
- Modify: `app/(app)/admin/content/builder/[courseId]/builder-client.tsx` (department picker)
- Modify: `lib/db/course-authoring.ts` (`createDraftCourse` signature)
- Test: `app/api/admin/courses/route.test.ts` (new — check first whether one already exists)
- Test: `lib/db/course-authoring.test.ts`

**Interfaces:**
- Consumes: `getDepartmentAdminDepartmentIds`, `isOrgAdmin` (as above).
- Produces: `createDraftCourse(title?: string, departmentId?: string | null): Promise<{ id: string }>`.

- [ ] **Step 1: Write the failing test for `createDraftCourse`**

Add to `lib/db/course-authoring.test.ts`, inside (or near) the existing `describe("createDraftCourse", ...)` block. Confirm `departments` and `courses` are imported in this file already (check the top-level import list; add `departments` if it's missing):

```ts
  it("sets the given departmentId on creation", async () => {
    const [dept] = await db.insert(departments).values({ name: `Dept-${randomUUID()}` }).returning();
    try {
      const { id } = await createDraftCourse("Scoped Course", dept.id);
      const [course] = await db.select().from(courses).where(eq(courses.id, id));
      expect(course.departmentId).toBe(dept.id);
    } finally {
      await db.delete(courses).where(eq(courses.departmentId, dept.id));
      await db.delete(departments).where(eq(departments.id, dept.id));
    }
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/db/course-authoring.test.ts`
Expected: FAIL — `createDraftCourse` doesn't accept a second argument.

- [ ] **Step 3: Update `createDraftCourse`**

```ts
export async function createDraftCourse(title?: string, departmentId?: string | null): Promise<{ id: string }> {
  const [course] = await db
    .insert(courses)
    .values({
      code: `DRAFT-${randomUUID().slice(0, 8)}`,
      title: title ?? "Untitled Course",
      departmentId: departmentId ?? null,
    })
    .returning();
  return { id: course.id };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/db/course-authoring.test.ts`
Expected: PASS

- [ ] **Step 5: Write the failing route test for course creation scoping**

Check first whether `app/api/admin/courses/route.test.ts` already exists from earlier work in this repo; if so, add the `describe` block below to it rather than replacing the file.

```ts
// app/api/admin/courses/route.test.ts
import { describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { db } from "@/lib/db/client";
import { courses, departments, users, departmentAdmins } from "@/lib/db/schema";

const { DEPT_ADMIN_EMAIL } = vi.hoisted(() => ({
  DEPT_ADMIN_EMAIL: `dept-admin-course-create-${require("node:crypto").randomUUID()}@example.com`,
}));
vi.mock("@/auth", () => ({
  auth: vi.fn().mockResolvedValue({ user: { email: DEPT_ADMIN_EMAIL, roles: ["DepartmentAdmin"] } }),
}));

describe("POST /api/admin/courses", () => {
  it("auto-scopes a new course to the caller's single administered department", async () => {
    const { POST } = await import("./route");
    const [dept] = await db.insert(departments).values({ name: `Dept-${randomUUID()}` }).returning();
    const [user] = await db
      .insert(users)
      .values({ email: DEPT_ADMIN_EMAIL, displayName: "Dept Admin", entraRole: "Department Admin" })
      .returning();
    await db.insert(departmentAdmins).values({ userId: user.id, departmentId: dept.id });

    try {
      const request = new NextRequest("http://localhost/api/admin/courses", {
        method: "POST",
        body: JSON.stringify({ title: "New Scoped Course" }),
      });
      const response = await POST(request);
      const body = await response.json();
      const [course] = await db.select().from(courses).where(eq(courses.id, body.courseId));
      expect(course.departmentId).toBe(dept.id);
    } finally {
      await db.delete(courses).where(eq(courses.departmentId, dept.id));
      await db.delete(departmentAdmins).where(eq(departmentAdmins.userId, user.id));
      await db.delete(users).where(eq(users.id, user.id));
      await db.delete(departments).where(eq(departments.id, dept.id));
    }
  });

  it("rejects course creation for a Department Admin who administers no department yet", async () => {
    const { POST } = await import("./route");
    const [user] = await db
      .insert(users)
      .values({ email: DEPT_ADMIN_EMAIL, displayName: "Dept Admin", entraRole: "Department Admin" })
      .returning();
    try {
      const request = new NextRequest("http://localhost/api/admin/courses", {
        method: "POST",
        body: JSON.stringify({ title: "Should Not Be Created" }),
      });
      const response = await POST(request);
      expect(response.status).toBe(400);
    } finally {
      await db.delete(users).where(eq(users.id, user.id));
    }
  });
});
```

This uses the same hoisted-mock-email pattern already established in `app/api/text/complete/route.test.ts` (this repo's existing convention for mocking `@/auth`) rather than the ad-hoc `vi.doMock` shown in the design write-up — follow this version exactly, it's the one that matches the codebase.

- [ ] **Step 6: Run the test to verify it fails**

Run: `npx vitest run app/api/admin/courses/route.test.ts`
Expected: FAIL — the route doesn't scope by caller yet.

- [ ] **Step 7: Update the create-course route**

```ts
// app/api/admin/courses/route.ts
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createDraftCourse } from "@/lib/db/course-authoring";
import { getUserIdByEmail } from "@/lib/db/users";
import { getDepartmentAdminDepartmentIds } from "@/lib/db/department-admins";
import { isOrgAdmin } from "@/lib/roles";
import { badRequest, isUuid, serverError } from "@/lib/api/errors";

export async function POST(request: Request) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return badRequest("Request body must be valid JSON");
    }
    const { title, departmentId: requestedDepartmentId } = (body ?? {}) as {
      title?: string;
      departmentId?: string;
    };
    if (!title || !title.trim()) {
      return badRequest("title is required");
    }

    const session = await auth();
    let departmentId: string | null = null;
    if (!isOrgAdmin(session?.user?.roles)) {
      const userId = session?.user?.email ? await getUserIdByEmail(session.user.email) : null;
      const administeredIds = userId ? await getDepartmentAdminDepartmentIds(userId) : [];
      if (administeredIds.length === 0) {
        return badRequest("You don't administer any department yet");
      }
      if (administeredIds.length === 1) {
        departmentId = administeredIds[0];
      } else {
        if (!requestedDepartmentId || !administeredIds.includes(requestedDepartmentId)) {
          return badRequest("departmentId must be one of the departments you administer");
        }
        departmentId = requestedDepartmentId;
      }
    } else if (requestedDepartmentId) {
      if (!isUuid(requestedDepartmentId)) {
        return badRequest("departmentId must be a UUID");
      }
      departmentId = requestedDepartmentId;
    }

    const { id } = await createDraftCourse(title.trim(), departmentId);
    return NextResponse.json({ courseId: id });
  } catch (error) {
    return serverError(error);
  }
}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run app/api/admin/courses/route.test.ts`
Expected: PASS

- [ ] **Step 9: Add the multi-department picker to the "New Course" dialog, if the caller administers 2+ departments**

Read `app/(app)/admin/content/page.tsx`'s existing "New Course" dialog (built earlier this session — title-only today). Extend it: the server page component fetches the caller's administered department count/names the same way Task 6/8 elsewhere do (`isOrgAdmin` + `getDepartmentAdminDepartmentIds` + `listDepartments` filtered to those ids), and passes that down as a new prop into the existing client dialog component, following the same "fetch on the server page, pass as props to the client component" pattern used everywhere else in this app (e.g. `CourseBuilderPage` → `BuilderClient`). When the prop shows exactly one or zero administered departments (or the caller is Org Admin), no picker renders and the POST body omits `departmentId` exactly as today. When it shows 2+, add a required `<select>` of just those departments, included in the POST body as `departmentId`.

- [ ] **Step 10: Lock the builder's department picker and add the ownership check**

In `app/(app)/admin/content/builder/[courseId]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { getCourseForBuilder } from "@/lib/db/queries";
import { listDepartments } from "@/lib/db/departments";
import { getUserIdByEmail } from "@/lib/db/users";
import { getDepartmentAdminDepartmentIds } from "@/lib/db/department-admins";
import { isOrgAdmin } from "@/lib/roles";
import { UnavailableState } from "@/components/ui/unavailable-state";
import { isNextNotFoundError } from "@/lib/utils";
import { BuilderClient } from "./builder-client";

export default async function CourseBuilderPage(
  props: PageProps<"/admin/content/builder/[courseId]">
) {
  const { courseId } = await props.params;

  const session = await auth();
  let course;
  let departments;
  const callerIsOrgAdmin = isOrgAdmin(session?.user?.roles);
  try {
    course = await getCourseForBuilder(courseId);
    if (!course) {
      notFound();
    }

    if (!callerIsOrgAdmin) {
      const userId = session?.user?.email ? await getUserIdByEmail(session.user.email) : null;
      const administeredIds = userId ? await getDepartmentAdminDepartmentIds(userId) : [];
      // A Department Admin editing a course outside every department they
      // administer (including a global, departmentId-null course) is the
      // same anti-IDOR shape as the learner module pages' courseId
      // cross-check - never trust the URL alone.
      if (!course.departmentId || !administeredIds.includes(course.departmentId)) {
        notFound();
      }
      const allDepartments = await listDepartments();
      departments = allDepartments.filter((d) => administeredIds.includes(d.id));
    } else {
      departments = await listDepartments();
    }
  } catch (err) {
    if (isNextNotFoundError(err)) {
      throw err;
    }
    return <UnavailableState message="Could not load this course right now. Please try again in a moment." />;
  }

  return <BuilderClient initialCourse={course} departments={departments} isOrgAdminCaller={callerIsOrgAdmin} />;
}
```

- [ ] **Step 11: Lock the department `<Select>` in `builder-client.tsx` for a non-Org-Admin caller**

Read the existing Department `<Select>` block in `builder-client.tsx` (set via `onValueChange` calling `updateField("departmentId", ...)` + `patchDetails({ departmentId })`) before editing, to match its current exact shape. Add the new `isOrgAdminCaller: boolean` prop to `BuilderClient`'s props type, and wrap the picker:

```tsx
{isOrgAdminCaller ? (
  <Select
    value={course.departmentId ?? "none"}
    items={[
      { value: "none", label: "General" },
      ...departments.map((dept) => ({ value: dept.id, label: dept.name })),
    ]}
    onValueChange={(value) => {
      const departmentId = value === "none" ? null : (value as string);
      updateField("departmentId", departmentId);
      patchDetails({ departmentId });
    }}
  >
    <SelectTrigger id="department" className="w-full">
      <SelectValue placeholder="General" />
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="none">General</SelectItem>
      {departments.map((dept) => (
        <SelectItem key={dept.id} value={dept.id}>
          {dept.name}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
) : departments.length <= 1 ? (
  <p className="flex h-8 items-center text-sm text-muted-foreground">
    {departments[0]?.name ?? "General"} (locked to your department)
  </p>
) : (
  <Select
    value={course.departmentId ?? departments[0].id}
    items={departments.map((dept) => ({ value: dept.id, label: dept.name }))}
    onValueChange={(value) => {
      updateField("departmentId", value as string);
      patchDetails({ departmentId: value });
    }}
  >
    <SelectTrigger id="department" className="w-full">
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      {departments.map((dept) => (
        <SelectItem key={dept.id} value={dept.id}>
          {dept.name}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
)}
```

A Department Admin with 2+ departments can still only choose among `departments` (already pre-filtered to their own by the page component in Step 10), never `"none"`/global.

- [ ] **Step 12: Typecheck and run the full suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean, every test file green.

- [ ] **Step 13: Browser-verify end to end**

As Org Admin: assign a real Entra Department-Admin-role user (or a test one) to a department (Task 5's UI). Sign in as that person (or use the admin "Viewing as" preview if a true separate sign-in isn't available — note explicitly in the summary if this step is done via preview rather than a real separate sign-in, since the preview switcher after Task 4 only offers "Learner," not a Department Admin preview; a real second Entra account is the only way to fully verify this tier live). Confirm: `/admin/org` 404s/redirects for them, `/admin/department` shows only their department, `/admin/content` lists only their department's courses, creating a new course locks it to their department in the builder, opening a different department's (or a global) course's builder URL directly 404s.

- [ ] **Step 14: Commit**

```bash
git add app/api/admin/courses/route.ts app/api/admin/courses/route.test.ts lib/db/course-authoring.ts lib/db/course-authoring.test.ts "app/(app)/admin/content/builder/[courseId]/page.tsx" "app/(app)/admin/content/builder/[courseId]/builder-client.tsx" "app/(app)/admin/content/page.tsx"
git commit -m "feat: scope course creation and the builder's department picker to the caller"
```

---

## Task 9: Final verification and deploy

**Files:** none (verification only)

- [ ] **Step 1: Full typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 2: Full test suite**

Run: `npx vitest run`
Expected: every test file passes, including every new one added across Tasks 1–8.

- [ ] **Step 3: Re-read the spec's three open items against what was actually built**

Confirm in the summary text: (1) the multi-department course-creation picker requires a real choice, no silent global default — matches spec item 1; (2) a Department Admin can manage their own department's roster and course assignments without Org-Admin escalation — matches spec item 2; (3) `/admin/reports` stayed Org-Admin-only and the Department page's own completion stats are the Department Admin's reporting surface — matches spec item 3.

- [ ] **Step 4: Ask the user before pushing**

Same convention as every prior feature this session: confirm before `git push origin master` + `git push origin master:main`.

- [ ] **Step 5: Push**

```bash
git push origin master
git push origin master:main
```
