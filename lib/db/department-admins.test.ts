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
