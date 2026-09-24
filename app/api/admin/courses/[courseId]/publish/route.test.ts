import { describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { POST } from "./route";
import { createDraftCourse } from "@/lib/db/course-authoring";
import { db } from "@/lib/db/client";
import { courses, modules, moduleVersions, videoModuleVersions, departments, departmentAdmins, users } from "@/lib/db/schema";
import { auth } from "@/auth";

vi.mock("@/auth", () => ({
  auth: vi.fn().mockResolvedValue({ user: { email: "org-admin@example.com", roles: ["OrgAdmin"] } }),
}));

/**
 * Test-only replacement for the removed `addVideoPlaceholderModule` (Task 2
 * of the video-hosting-mux plan superseded it with the real Mux
 * upload-creation route) - inserts the same module/version/video rows
 * directly so this test still has a module to publish against.
 */
async function createTestVideoModule(courseId: string, title: string): Promise<void> {
  const [courseModule] = await db
    .insert(modules)
    .values({ courseId, moduleType: "video", title })
    .returning();
  const [version] = await db
    .insert(moduleVersions)
    .values({ moduleId: courseModule.id, versionNumber: 1, status: "published", publishedAt: new Date() })
    .returning();
  await db.insert(videoModuleVersions).values({ moduleVersionId: version.id });
  await db.update(modules).set({ currentVersionId: version.id }).where(eq(modules.id, courseModule.id));
}

describe("POST /api/admin/courses/[courseId]/publish", () => {
  it("returns 400 when the course has no modules", async () => {
    const { id } = await createDraftCourse();
    try {
      const request = new NextRequest(
        `http://localhost/api/admin/courses/${id}/publish`,
        { method: "POST" }
      );
      const response = await POST(request, { params: Promise.resolve({ courseId: id }) });
      expect(response.status).toBe(400);
    } finally {
      await db.delete(courses).where(eq(courses.id, id));
    }
  });

  it("publishes a course that has at least one module", async () => {
    const { id } = await createDraftCourse();
    await createTestVideoModule(id, "A Module");
    try {
      const request = new NextRequest(
        `http://localhost/api/admin/courses/${id}/publish`,
        { method: "POST" }
      );
      const response = await POST(request, { params: Promise.resolve({ courseId: id }) });
      expect(response.status).toBe(200);

      const [course] = await db.select().from(courses).where(eq(courses.id, id));
      expect(course.status).toBe("published");
    } finally {
      const mods = await db.select().from(modules).where(eq(modules.courseId, id));
      const moduleIds = mods.map((m) => m.id);
      await db.update(modules).set({ currentVersionId: null }).where(inArray(modules.id, moduleIds));
      const versions = await db.select().from(moduleVersions).where(inArray(moduleVersions.moduleId, moduleIds));
      const versionIds = versions.map((v) => v.id);
      await db.delete(videoModuleVersions).where(inArray(videoModuleVersions.moduleVersionId, versionIds));
      await db.delete(moduleVersions).where(inArray(moduleVersions.id, versionIds));
      await db.delete(modules).where(inArray(modules.id, moduleIds));
      await db.delete(courses).where(eq(courses.id, id));
    }
  });

  it("404s a Department Admin from a different department, leaving the course unpublished", async () => {
    const { id } = await createDraftCourse();
    await createTestVideoModule(id, "A Module");
    const [otherDept] = await db.insert(departments).values({ name: `Dept-${randomUUID()}` }).returning();
    await db.update(courses).set({ departmentId: otherDept.id }).where(eq(courses.id, id));
    const email = `dept-admin-publish-${randomUUID()}@example.com`;
    const [dept] = await db.insert(departments).values({ name: `Dept-${randomUUID()}` }).returning();
    const [user] = await db
      .insert(users)
      .values({ email, displayName: "Dept Admin", entraRole: "Department Admin" })
      .returning();
    await db.insert(departmentAdmins).values({ userId: user.id, departmentId: dept.id });
    vi.mocked(auth).mockResolvedValueOnce({ user: { email, roles: ["DepartmentAdmin"] } } as never);
    try {
      const request = new NextRequest(
        `http://localhost/api/admin/courses/${id}/publish`,
        { method: "POST" }
      );
      const response = await POST(request, { params: Promise.resolve({ courseId: id }) });
      expect(response.status).toBe(404);

      const [course] = await db.select().from(courses).where(eq(courses.id, id));
      expect(course.status).not.toBe("published");
    } finally {
      const mods = await db.select().from(modules).where(eq(modules.courseId, id));
      const moduleIds = mods.map((m) => m.id);
      await db.update(modules).set({ currentVersionId: null }).where(inArray(modules.id, moduleIds));
      const versions = await db.select().from(moduleVersions).where(inArray(moduleVersions.moduleId, moduleIds));
      const versionIds = versions.map((v) => v.id);
      await db.delete(videoModuleVersions).where(inArray(videoModuleVersions.moduleVersionId, versionIds));
      await db.delete(moduleVersions).where(inArray(moduleVersions.id, versionIds));
      await db.delete(modules).where(inArray(modules.id, moduleIds));
      await db.delete(courses).where(eq(courses.id, id));
      await db.delete(departmentAdmins).where(eq(departmentAdmins.userId, user.id));
      await db.delete(users).where(eq(users.id, user.id));
      await db.delete(departments).where(eq(departments.id, dept.id));
      await db.delete(departments).where(eq(departments.id, otherDept.id));
    }
  });
});
