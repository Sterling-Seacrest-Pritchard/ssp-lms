import { describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { PATCH, DELETE } from "./route";
import { createDraftCourse } from "@/lib/db/course-authoring";
import { db } from "@/lib/db/client";
import { courses, departments, departmentAdmins, users } from "@/lib/db/schema";
import { auth } from "@/auth";

vi.mock("@/auth", () => ({
  auth: vi.fn().mockResolvedValue({ user: { email: "org-admin@example.com", roles: ["OrgAdmin"] } }),
}));

async function createDepartmentAdmin(): Promise<{ userId: string; email: string; departmentId: string }> {
  const email = `dept-admin-course-detail-${randomUUID()}@example.com`;
  const [dept] = await db.insert(departments).values({ name: `Dept-${randomUUID()}` }).returning();
  const [user] = await db
    .insert(users)
    .values({ email, displayName: "Dept Admin", entraRole: "Department Admin" })
    .returning();
  await db.insert(departmentAdmins).values({ userId: user.id, departmentId: dept.id });
  return { userId: user.id, email, departmentId: dept.id };
}

async function cleanupDepartmentAdmin(admin: { userId: string; departmentId: string }): Promise<void> {
  await db.delete(departmentAdmins).where(eq(departmentAdmins.userId, admin.userId));
  await db.delete(users).where(eq(users.id, admin.userId));
  await db.delete(departments).where(eq(departments.id, admin.departmentId));
}

describe("PATCH /api/admin/courses/[courseId]", () => {
  it("updates the given fields", async () => {
    const { id } = await createDraftCourse();
    try {
      const [dept] = await db.select().from(departments).where(eq(departments.name, "HR"));
      const request = new NextRequest(`http://localhost/api/admin/courses/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ title: "Renamed", departmentId: dept.id, compliance: true }),
      });
      const response = await PATCH(request, { params: Promise.resolve({ courseId: id }) });
      expect(response.status).toBe(200);

      const [course] = await db.select().from(courses).where(eq(courses.id, id));
      expect(course.title).toBe("Renamed");
      expect(course.departmentId).toBe(dept.id);
      expect(course.compliance).toBe(true);
    } finally {
      await db.delete(courses).where(eq(courses.id, id));
    }
  });

  it("returns 400 for a non-UUID courseId", async () => {
    const request = new NextRequest("http://localhost/api/admin/courses/not-a-uuid", {
      method: "PATCH",
      body: JSON.stringify({ title: "X" }),
    });
    const response = await PATCH(request, { params: Promise.resolve({ courseId: "not-a-uuid" }) });
    expect(response.status).toBe(400);
  });

  it("404s a Department Admin who doesn't administer the course's (global) department", async () => {
    const { id } = await createDraftCourse();
    const admin = await createDepartmentAdmin();
    vi.mocked(auth).mockResolvedValueOnce({
      user: { email: admin.email, roles: ["DepartmentAdmin"] },
    } as never);
    try {
      const request = new NextRequest(`http://localhost/api/admin/courses/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ title: "Should Not Apply" }),
      });
      const response = await PATCH(request, { params: Promise.resolve({ courseId: id }) });
      expect(response.status).toBe(404);

      const [course] = await db.select().from(courses).where(eq(courses.id, id));
      expect(course.title).not.toBe("Should Not Apply");
    } finally {
      await db.delete(courses).where(eq(courses.id, id));
      await cleanupDepartmentAdmin(admin);
    }
  });

  it("rejects a Department Admin trying to PATCH their own course's departmentId to null (global)", async () => {
    const admin = await createDepartmentAdmin();
    const { id } = await createDraftCourse("Owned Course", admin.departmentId);
    vi.mocked(auth).mockResolvedValueOnce({
      user: { email: admin.email, roles: ["DepartmentAdmin"] },
    } as never);
    try {
      const request = new NextRequest(`http://localhost/api/admin/courses/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ departmentId: null }),
      });
      const response = await PATCH(request, { params: Promise.resolve({ courseId: id }) });
      expect(response.status).toBe(400);

      const [course] = await db.select().from(courses).where(eq(courses.id, id));
      expect(course.departmentId).toBe(admin.departmentId);
    } finally {
      await db.delete(courses).where(eq(courses.id, id));
      await cleanupDepartmentAdmin(admin);
    }
  });

  it("rejects a Department Admin trying to PATCH their own course's departmentId to a department they don't administer", async () => {
    const admin = await createDepartmentAdmin();
    const { id } = await createDraftCourse("Owned Course", admin.departmentId);
    const [otherDept] = await db.insert(departments).values({ name: `Dept-${randomUUID()}` }).returning();
    vi.mocked(auth).mockResolvedValueOnce({
      user: { email: admin.email, roles: ["DepartmentAdmin"] },
    } as never);
    try {
      const request = new NextRequest(`http://localhost/api/admin/courses/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ departmentId: otherDept.id }),
      });
      const response = await PATCH(request, { params: Promise.resolve({ courseId: id }) });
      expect(response.status).toBe(400);

      const [course] = await db.select().from(courses).where(eq(courses.id, id));
      expect(course.departmentId).toBe(admin.departmentId);
    } finally {
      await db.delete(courses).where(eq(courses.id, id));
      await db.delete(departments).where(eq(departments.id, otherDept.id));
      await cleanupDepartmentAdmin(admin);
    }
  });

  it("allows an Org Admin to PATCH departmentId to null (global) freely", async () => {
    const [dept] = await db.insert(departments).values({ name: `Dept-${randomUUID()}` }).returning();
    const { id } = await createDraftCourse("Org Admin Owned", dept.id);
    try {
      const request = new NextRequest(`http://localhost/api/admin/courses/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ departmentId: null }),
      });
      const response = await PATCH(request, { params: Promise.resolve({ courseId: id }) });
      expect(response.status).toBe(200);

      const [course] = await db.select().from(courses).where(eq(courses.id, id));
      expect(course.departmentId).toBeNull();
    } finally {
      await db.delete(courses).where(eq(courses.id, id));
      await db.delete(departments).where(eq(departments.id, dept.id));
    }
  });
});

describe("DELETE /api/admin/courses/[courseId]", () => {
  it("404s a Department Admin from a different department, leaving the course intact", async () => {
    const { id } = await createDraftCourse();
    const [otherDept] = await db.insert(departments).values({ name: `Dept-${randomUUID()}` }).returning();
    await db.update(courses).set({ departmentId: otherDept.id }).where(eq(courses.id, id));
    const admin = await createDepartmentAdmin();
    vi.mocked(auth).mockResolvedValueOnce({
      user: { email: admin.email, roles: ["DepartmentAdmin"] },
    } as never);
    try {
      const request = new NextRequest(`http://localhost/api/admin/courses/${id}`, { method: "DELETE" });
      const response = await DELETE(request, { params: Promise.resolve({ courseId: id }) });
      expect(response.status).toBe(404);

      const [course] = await db.select().from(courses).where(eq(courses.id, id));
      expect(course).toBeTruthy();
    } finally {
      await db.delete(courses).where(eq(courses.id, id));
      await db.delete(departments).where(eq(departments.id, otherDept.id));
      await cleanupDepartmentAdmin(admin);
    }
  });
});
