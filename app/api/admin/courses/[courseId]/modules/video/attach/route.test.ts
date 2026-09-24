import { describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { POST } from "./route";
import { db } from "@/lib/db/client";
import { courses, modules, moduleVersions, videoModuleVersions, videoAssets, departments, departmentAdmins, users } from "@/lib/db/schema";
import { auth } from "@/auth";

vi.mock("@/auth", () => ({
  auth: vi.fn().mockResolvedValue({ user: { email: "org-admin@example.com", roles: ["OrgAdmin"] } }),
}));

describe("POST /api/admin/courses/[courseId]/modules/video/attach", () => {
  it("attaches an existing video asset to the course for an Org Admin", async () => {
    const [course] = await db.insert(courses).values({ code: `ADMIN-ATTACH-${randomUUID()}`, title: "x" }).returning();
    const [asset] = await db.insert(videoAssets).values({ title: "Reusable Video" }).returning();
    let moduleId: string | undefined;
    try {
      const request = new NextRequest("http://localhost/x", {
        method: "POST",
        body: JSON.stringify({ videoAssetId: asset.id, title: "Attached Video" }),
      });
      const response = await POST(request, { params: Promise.resolve({ courseId: course.id }) });
      expect(response.status).toBe(200);
      const body = await response.json();
      moduleId = body.moduleId;
      expect(moduleId).toBeTruthy();
    } finally {
      if (moduleId) {
        await db.update(modules).set({ currentVersionId: null }).where(eq(modules.id, moduleId));
        await db.delete(videoModuleVersions).where(eq(videoModuleVersions.videoAssetId, asset.id));
        await db.delete(moduleVersions).where(eq(moduleVersions.moduleId, moduleId));
        await db.delete(modules).where(eq(modules.id, moduleId));
      }
      await db.delete(videoAssets).where(eq(videoAssets.id, asset.id));
      await db.delete(courses).where(eq(courses.id, course.id));
    }
  });

  it("404s a Department Admin from a different department, attaching nothing", async () => {
    const [course] = await db.insert(courses).values({ code: `ADMIN-ATTACH-${randomUUID()}`, title: "x" }).returning();
    const [asset] = await db.insert(videoAssets).values({ title: "Reusable Video" }).returning();
    const [otherDept] = await db.insert(departments).values({ name: `Dept-${randomUUID()}` }).returning();
    await db.update(courses).set({ departmentId: otherDept.id }).where(eq(courses.id, course.id));
    const email = `dept-admin-attach-${randomUUID()}@example.com`;
    const [dept] = await db.insert(departments).values({ name: `Dept-${randomUUID()}` }).returning();
    const [user] = await db
      .insert(users)
      .values({ email, displayName: "Dept Admin", entraRole: "Department Admin" })
      .returning();
    await db.insert(departmentAdmins).values({ userId: user.id, departmentId: dept.id });
    vi.mocked(auth).mockResolvedValueOnce({ user: { email, roles: ["DepartmentAdmin"] } } as never);
    try {
      const request = new NextRequest("http://localhost/x", {
        method: "POST",
        body: JSON.stringify({ videoAssetId: asset.id, title: "Attached Video" }),
      });
      const response = await POST(request, { params: Promise.resolve({ courseId: course.id }) });
      expect(response.status).toBe(404);

      const remaining = await db.select().from(modules).where(eq(modules.courseId, course.id));
      expect(remaining).toHaveLength(0);
    } finally {
      await db.delete(videoAssets).where(eq(videoAssets.id, asset.id));
      await db.delete(courses).where(eq(courses.id, course.id));
      await db.delete(departmentAdmins).where(eq(departmentAdmins.userId, user.id));
      await db.delete(users).where(eq(users.id, user.id));
      await db.delete(departments).where(eq(departments.id, dept.id));
      await db.delete(departments).where(eq(departments.id, otherDept.id));
    }
  });
});
