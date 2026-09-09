import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  listDepartments,
  listDepartmentsWithCounts,
  createDepartment,
  getDepartmentWithMembers,
  listUsersNotInDepartment,
  setUserDepartment,
} from "./departments";
import { db } from "./client";
import { departments, users } from "./schema";

async function makeUser(departmentId: string | null = null) {
  const [user] = await db
    .insert(users)
    .values({
      entraObjectId: randomUUID(),
      email: `${randomUUID()}@example.com`,
      displayName: "Test User",
      departmentId,
    })
    .returning();
  return user;
}

describe("createDepartment", () => {
  it("creates a department with the given name", async () => {
    const name = `Dept-${randomUUID()}`;
    const dept = await createDepartment(name);
    try {
      expect(dept.name).toBe(name);
      const [row] = await db.select().from(departments).where(eq(departments.id, dept.id));
      expect(row.name).toBe(name);
    } finally {
      await db.delete(departments).where(eq(departments.id, dept.id));
    }
  });

  it("rejects a duplicate name", async () => {
    const name = `Dept-${randomUUID()}`;
    const dept = await createDepartment(name);
    try {
      await expect(createDepartment(name)).rejects.toThrow();
    } finally {
      await db.delete(departments).where(eq(departments.id, dept.id));
    }
  });
});

describe("listDepartments / listDepartmentsWithCounts", () => {
  it("lists departments and reports accurate member counts", async () => {
    const dept = await createDepartment(`Dept-${randomUUID()}`);
    const userA = await makeUser(dept.id);
    const userB = await makeUser(dept.id);
    const unrelatedUser = await makeUser(null);
    try {
      const plain = await listDepartments();
      expect(plain.find((d) => d.id === dept.id)).toEqual({ id: dept.id, name: dept.name });

      const withCounts = await listDepartmentsWithCounts();
      const found = withCounts.find((d) => d.id === dept.id);
      expect(found?.memberCount).toBe(2);
      void unrelatedUser;
    } finally {
      await db.delete(users).where(eq(users.id, userA.id));
      await db.delete(users).where(eq(users.id, userB.id));
      await db.delete(users).where(eq(users.id, unrelatedUser.id));
      await db.delete(departments).where(eq(departments.id, dept.id));
    }
  });
});

describe("getDepartmentWithMembers / listUsersNotInDepartment / setUserDepartment", () => {
  it("returns null for an unknown department id", async () => {
    const result = await getDepartmentWithMembers(randomUUID());
    expect(result).toBeNull();
  });

  it("returns null for a malformed department id", async () => {
    const result = await getDepartmentWithMembers("not-a-uuid");
    expect(result).toBeNull();
  });

  it("moves a user in and out of a department", async () => {
    const dept = await createDepartment(`Dept-${randomUUID()}`);
    const user = await makeUser(null);
    try {
      const beforeAdd = await getDepartmentWithMembers(dept.id);
      expect(beforeAdd?.members).toHaveLength(0);
      const eligible = await listUsersNotInDepartment(dept.id);
      expect(eligible.find((u) => u.id === user.id)).toBeDefined();

      await setUserDepartment(user.id, dept.id);

      const afterAdd = await getDepartmentWithMembers(dept.id);
      expect(afterAdd?.members.map((m) => m.id)).toEqual([user.id]);
      const eligibleAfterAdd = await listUsersNotInDepartment(dept.id);
      expect(eligibleAfterAdd.find((u) => u.id === user.id)).toBeUndefined();

      await setUserDepartment(user.id, null);

      const afterRemove = await getDepartmentWithMembers(dept.id);
      expect(afterRemove?.members).toHaveLength(0);
    } finally {
      await db.delete(users).where(eq(users.id, user.id));
      await db.delete(departments).where(eq(departments.id, dept.id));
    }
  });
});
