import { describe, it, expect, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { POST } from "./route";
import { db } from "@/lib/db/client";
import { courses, modules, moduleVersions, videoAssets, videoModuleVersions, departments, departmentAdmins, users } from "@/lib/db/schema";
import { auth } from "@/auth";

vi.mock("@/auth", () => ({
  auth: vi.fn().mockResolvedValue({ user: { email: "org-admin@example.com", roles: ["OrgAdmin"] } }),
}));

describe("POST /api/admin/courses/[courseId]/modules/video", () => {
  let createdCourseId: string | undefined;

  afterEach(async () => {
    if (!createdCourseId) return;
    const courseModules = await db.select().from(modules).where(eq(modules.courseId, createdCourseId));
    for (const m of courseModules) {
      await db.update(modules).set({ currentVersionId: null }).where(eq(modules.id, m.id));
      const versions = await db.select().from(moduleVersions).where(eq(moduleVersions.moduleId, m.id));
      for (const v of versions) {
        const [link] = await db
          .select()
          .from(videoModuleVersions)
          .where(eq(videoModuleVersions.moduleVersionId, v.id));
        await db.delete(videoModuleVersions).where(eq(videoModuleVersions.moduleVersionId, v.id));
        if (link?.videoAssetId) {
          await db.delete(videoAssets).where(eq(videoAssets.id, link.videoAssetId));
        }
      }
      await db.delete(moduleVersions).where(eq(moduleVersions.moduleId, m.id));
    }
    await db.delete(modules).where(eq(modules.courseId, createdCourseId));
    await db.delete(courses).where(eq(courses.id, createdCourseId));
    createdCourseId = undefined;
  });

  it("creates a waiting video module and returns a Mux upload URL", async () => {
    const [course] = await db.insert(courses).values({ code: `VIDTEST-${randomUUID()}`, title: "Video Test" }).returning();
    createdCourseId = course.id;

    const request = new NextRequest(`http://localhost/api/admin/courses/${course.id}/modules/video`, {
      method: "POST",
      body: JSON.stringify({ title: "Intro Video" }),
    });
    const response = await POST(request, { params: Promise.resolve({ courseId: course.id }) });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.uploadUrl).toMatch(/^https:\/\//);
    expect(body.moduleVersionId).toBeTruthy();

    const [link] = await db
      .select()
      .from(videoModuleVersions)
      .where(eq(videoModuleVersions.moduleVersionId, body.moduleVersionId));
    expect(link.videoAssetId).toBe(body.videoAssetId);
    const [asset] = await db.select().from(videoAssets).where(eq(videoAssets.id, link.videoAssetId!));
    expect(asset.status).toBe("waiting");
    expect(asset.muxUploadId).toBeTruthy();
  });

  it("rejects a non-UUID courseId", async () => {
    const request = new NextRequest("http://localhost/api/admin/courses/not-a-uuid/modules/video", {
      method: "POST",
      body: JSON.stringify({ title: "x" }),
    });
    const response = await POST(request, { params: Promise.resolve({ courseId: "not-a-uuid" }) });
    expect(response.status).toBe(400);
  });

  it("rejects a request with no title", async () => {
    const [course] = await db.insert(courses).values({ code: `VIDTEST-${randomUUID()}`, title: "Video Test" }).returning();
    createdCourseId = course.id;
    const request = new NextRequest(`http://localhost/api/admin/courses/${course.id}/modules/video`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    const response = await POST(request, { params: Promise.resolve({ courseId: course.id }) });
    expect(response.status).toBe(400);
  });

  it("404s a Department Admin from a different department, creating no module", async () => {
    const [course] = await db
      .insert(courses)
      .values({ code: `VIDTEST-${randomUUID()}`, title: "Video Test" })
      .returning();
    const [otherDept] = await db.insert(departments).values({ name: `Dept-${randomUUID()}` }).returning();
    await db.update(courses).set({ departmentId: otherDept.id }).where(eq(courses.id, course.id));
    const email = `dept-admin-video-${randomUUID()}@example.com`;
    const [dept] = await db.insert(departments).values({ name: `Dept-${randomUUID()}` }).returning();
    const [user] = await db
      .insert(users)
      .values({ email, displayName: "Dept Admin", entraRole: "Department Admin" })
      .returning();
    await db.insert(departmentAdmins).values({ userId: user.id, departmentId: dept.id });
    vi.mocked(auth).mockResolvedValueOnce({ user: { email, roles: ["DepartmentAdmin"] } } as never);
    try {
      const request = new NextRequest(`http://localhost/api/admin/courses/${course.id}/modules/video`, {
        method: "POST",
        body: JSON.stringify({ title: "Intro Video" }),
      });
      const response = await POST(request, { params: Promise.resolve({ courseId: course.id }) });
      expect(response.status).toBe(404);

      const remaining = await db.select().from(modules).where(eq(modules.courseId, course.id));
      expect(remaining).toHaveLength(0);
    } finally {
      await db.delete(courses).where(eq(courses.id, course.id));
      await db.delete(departmentAdmins).where(eq(departmentAdmins.userId, user.id));
      await db.delete(users).where(eq(users.id, user.id));
      await db.delete(departments).where(eq(departments.id, dept.id));
      await db.delete(departments).where(eq(departments.id, otherDept.id));
    }
  });
});
