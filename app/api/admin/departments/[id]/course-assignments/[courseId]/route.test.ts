import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { DELETE } from "./route";
import { db } from "@/lib/db/client";
import { departments, users, courses, departmentAdmins, departmentCourseAssignments } from "@/lib/db/schema";
import { assignCourseToDepartment } from "@/lib/db/department-course-assignments";
import { auth } from "@/auth";

vi.mock("@/auth", () => ({
  auth: vi.fn().mockResolvedValue({ user: { email: "org-admin@example.com", roles: ["OrgAdmin"] } }),
}));

async function makeDeptAdminOf(departmentId: string) {
  const [admin] = await db
    .insert(users)
    .values({ email: `${randomUUID()}@example.com`, displayName: "Dept Admin", entraRole: "Department Admin" })
    .returning();
  await db.insert(departmentAdmins).values({ userId: admin.id, departmentId });
  return admin;
}

describe("DELETE /api/admin/departments/[id]/course-assignments/[courseId]", () => {
  it("returns 403 when a Department Admin passes a department id they don't administer", async () => {
    const [deptA] = await db.insert(departments).values({ name: `Dept-${randomUUID()}` }).returning();
    const [deptB] = await db.insert(departments).values({ name: `Dept-${randomUUID()}` }).returning();
    const [course] = await db.insert(courses).values({ code: `CD-${randomUUID()}`, title: "x" }).returning();
    await assignCourseToDepartment(course.id, deptB.id, "admin@example.com");
    const admin = await makeDeptAdminOf(deptA.id);
    vi.mocked(auth).mockResolvedValueOnce({
      user: { email: admin.email, roles: ["DepartmentAdmin"] },
    } as never);
    try {
      const request = new NextRequest(
        `http://localhost/api/admin/departments/${deptB.id}/course-assignments/${course.id}`,
        { method: "DELETE" }
      );
      const response = await DELETE(request, { params: Promise.resolve({ id: deptB.id, courseId: course.id }) });
      expect(response.status).toBe(403);

      expect(
        await db.select().from(departmentCourseAssignments).where(eq(departmentCourseAssignments.departmentId, deptB.id))
      ).toHaveLength(1);
    } finally {
      await db.delete(departmentCourseAssignments).where(eq(departmentCourseAssignments.departmentId, deptB.id));
      await db.delete(departmentAdmins).where(eq(departmentAdmins.userId, admin.id));
      await db.delete(users).where(eq(users.id, admin.id));
      await db.delete(courses).where(eq(courses.id, course.id));
      await db.delete(departments).where(eq(departments.id, deptA.id));
      await db.delete(departments).where(eq(departments.id, deptB.id));
    }
  });

  it("succeeds when a Department Admin passes their own department id", async () => {
    const [dept] = await db.insert(departments).values({ name: `Dept-${randomUUID()}` }).returning();
    const [course] = await db.insert(courses).values({ code: `CD-${randomUUID()}`, title: "x" }).returning();
    await assignCourseToDepartment(course.id, dept.id, "admin@example.com");
    const admin = await makeDeptAdminOf(dept.id);
    vi.mocked(auth).mockResolvedValueOnce({
      user: { email: admin.email, roles: ["DepartmentAdmin"] },
    } as never);
    try {
      const request = new NextRequest(
        `http://localhost/api/admin/departments/${dept.id}/course-assignments/${course.id}`,
        { method: "DELETE" }
      );
      const response = await DELETE(request, { params: Promise.resolve({ id: dept.id, courseId: course.id }) });
      expect(response.status).toBe(200);

      expect(
        await db.select().from(departmentCourseAssignments).where(eq(departmentCourseAssignments.departmentId, dept.id))
      ).toHaveLength(0);
    } finally {
      await db.delete(departmentAdmins).where(eq(departmentAdmins.userId, admin.id));
      await db.delete(users).where(eq(users.id, admin.id));
      await db.delete(courses).where(eq(courses.id, course.id));
      await db.delete(departments).where(eq(departments.id, dept.id));
    }
  });
});
