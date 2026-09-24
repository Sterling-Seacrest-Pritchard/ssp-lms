import { describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { DELETE } from "./route";
import { db } from "@/lib/db/client";
import { courses, modules, departments, departmentAdmins, users } from "@/lib/db/schema";
import { auth } from "@/auth";

vi.mock("@/auth", () => ({
  auth: vi.fn().mockResolvedValue({ user: { email: "org-admin@example.com", roles: ["OrgAdmin"] } }),
}));

describe("DELETE /api/admin/courses/[courseId]/modules/[moduleId]", () => {
  it("removes the module for an Org Admin", async () => {
    const [course] = await db.insert(courses).values({ code: `ADMIN-MOD-${randomUUID()}`, title: "x" }).returning();
    const [mod] = await db.insert(modules).values({ courseId: course.id, moduleType: "text", title: "x" }).returning();
    try {
      const response = await DELETE(
        new NextRequest("http://localhost/x", { method: "DELETE" }),
        { params: Promise.resolve({ courseId: course.id, moduleId: mod.id }) }
      );
      expect(response.status).toBe(200);

      const remaining = await db.select().from(modules).where(eq(modules.id, mod.id));
      expect(remaining).toHaveLength(0);
    } finally {
      await db.delete(modules).where(eq(modules.id, mod.id));
      await db.delete(courses).where(eq(courses.id, course.id));
    }
  });

  it("404s a Department Admin from a different department, leaving the module intact", async () => {
    const [course] = await db.insert(courses).values({ code: `ADMIN-MOD-${randomUUID()}`, title: "x" }).returning();
    const [mod] = await db.insert(modules).values({ courseId: course.id, moduleType: "text", title: "x" }).returning();
    const [otherDept] = await db.insert(departments).values({ name: `Dept-${randomUUID()}` }).returning();
    await db.update(courses).set({ departmentId: otherDept.id }).where(eq(courses.id, course.id));
    const email = `dept-admin-remove-module-${randomUUID()}@example.com`;
    const [dept] = await db.insert(departments).values({ name: `Dept-${randomUUID()}` }).returning();
    const [user] = await db
      .insert(users)
      .values({ email, displayName: "Dept Admin", entraRole: "Department Admin" })
      .returning();
    await db.insert(departmentAdmins).values({ userId: user.id, departmentId: dept.id });
    vi.mocked(auth).mockResolvedValueOnce({ user: { email, roles: ["DepartmentAdmin"] } } as never);
    try {
      const response = await DELETE(
        new NextRequest("http://localhost/x", { method: "DELETE" }),
        { params: Promise.resolve({ courseId: course.id, moduleId: mod.id }) }
      );
      expect(response.status).toBe(404);

      const remaining = await db.select().from(modules).where(eq(modules.id, mod.id));
      expect(remaining).toHaveLength(1);
    } finally {
      await db.delete(modules).where(eq(modules.id, mod.id));
      await db.delete(courses).where(eq(courses.id, course.id));
      await db.delete(departmentAdmins).where(eq(departmentAdmins.userId, user.id));
      await db.delete(users).where(eq(users.id, user.id));
      await db.delete(departments).where(eq(departments.id, dept.id));
      await db.delete(departments).where(eq(departments.id, otherDept.id));
    }
  });
});
