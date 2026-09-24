import { describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { canCallerAccessCourse, assertCourseAccess } from "./course-access";
import { createDraftCourse } from "@/lib/db/course-authoring";
import { db } from "@/lib/db/client";
import { courses, departments, departmentAdmins, users } from "@/lib/db/schema";
import { auth } from "@/auth";

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

async function createDepartmentAdmin(): Promise<{ userId: string; email: string; departmentId: string }> {
  const email = `dept-admin-course-access-${randomUUID()}@example.com`;
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

describe("canCallerAccessCourse", () => {
  it("allows an Org Admin to access any course, including a global one", async () => {
    vi.mocked(auth).mockResolvedValueOnce({
      user: { email: "org-admin@example.com", roles: ["OrgAdmin"] },
    } as never);
    const { id } = await createDraftCourse();
    try {
      expect(await canCallerAccessCourse(id)).toBe(true);
    } finally {
      await db.delete(courses).where(eq(courses.id, id));
    }
  });

  it("allows a Department Admin to access a course in a department they administer", async () => {
    const admin = await createDepartmentAdmin();
    const { id } = await createDraftCourse("Owned Course", admin.departmentId);
    vi.mocked(auth).mockResolvedValueOnce({
      user: { email: admin.email, roles: ["DepartmentAdmin"] },
    } as never);
    try {
      expect(await canCallerAccessCourse(id)).toBe(true);
    } finally {
      await db.delete(courses).where(eq(courses.id, id));
      await cleanupDepartmentAdmin(admin);
    }
  });

  it("denies a Department Admin access to a course in a department they don't administer", async () => {
    const admin = await createDepartmentAdmin();
    const [otherDept] = await db.insert(departments).values({ name: `Dept-${randomUUID()}` }).returning();
    const { id } = await createDraftCourse("Other Dept Course", otherDept.id);
    vi.mocked(auth).mockResolvedValueOnce({
      user: { email: admin.email, roles: ["DepartmentAdmin"] },
    } as never);
    try {
      expect(await canCallerAccessCourse(id)).toBe(false);
    } finally {
      await db.delete(courses).where(eq(courses.id, id));
      await db.delete(departments).where(eq(departments.id, otherDept.id));
      await cleanupDepartmentAdmin(admin);
    }
  });

  it("denies a Department Admin access to a global (departmentId-null) course", async () => {
    const admin = await createDepartmentAdmin();
    const { id } = await createDraftCourse();
    vi.mocked(auth).mockResolvedValueOnce({
      user: { email: admin.email, roles: ["DepartmentAdmin"] },
    } as never);
    try {
      expect(await canCallerAccessCourse(id)).toBe(false);
    } finally {
      await db.delete(courses).where(eq(courses.id, id));
      await cleanupDepartmentAdmin(admin);
    }
  });
});

describe("assertCourseAccess", () => {
  it("returns null when the caller has access", async () => {
    vi.mocked(auth).mockResolvedValueOnce({
      user: { email: "org-admin@example.com", roles: ["OrgAdmin"] },
    } as never);
    const { id } = await createDraftCourse();
    try {
      expect(await assertCourseAccess(id)).toBeNull();
    } finally {
      await db.delete(courses).where(eq(courses.id, id));
    }
  });

  it("returns a 404 response when the caller lacks access", async () => {
    const admin = await createDepartmentAdmin();
    const { id } = await createDraftCourse();
    vi.mocked(auth).mockResolvedValueOnce({
      user: { email: admin.email, roles: ["DepartmentAdmin"] },
    } as never);
    try {
      const response = await assertCourseAccess(id);
      expect(response).not.toBeNull();
      expect(response?.status).toBe(404);
    } finally {
      await db.delete(courses).where(eq(courses.id, id));
      await cleanupDepartmentAdmin(admin);
    }
  });
});
