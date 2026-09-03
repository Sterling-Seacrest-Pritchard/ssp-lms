import { describe, it, expect, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { POST } from "./route";
import { db } from "@/lib/db/client";
import { courses, modules, moduleVersions, videoModuleVersions } from "@/lib/db/schema";

describe("POST /api/admin/courses/[courseId]/modules/video", () => {
  let createdCourseId: string | undefined;

  afterEach(async () => {
    if (!createdCourseId) return;
    const courseModules = await db.select().from(modules).where(eq(modules.courseId, createdCourseId));
    for (const m of courseModules) {
      await db.update(modules).set({ currentVersionId: null }).where(eq(modules.id, m.id));
      const versions = await db.select().from(moduleVersions).where(eq(moduleVersions.moduleId, m.id));
      for (const v of versions) {
        await db.delete(videoModuleVersions).where(eq(videoModuleVersions.moduleVersionId, v.id));
      }
      await db.delete(moduleVersions).where(eq(moduleVersions.moduleId, m.id));
    }
    await db.delete(modules).where(eq(modules.courseId, createdCourseId));
    await db.delete(courses).where(eq(courses.id, createdCourseId));
    createdCourseId = undefined;
  });

  it("creates a waiting video module and returns a Mux upload URL", async () => {
    const [course] = await db.insert(courses).values({ code: `VIDTEST-${Date.now()}`, title: "Video Test" }).returning();
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

    const [row] = await db
      .select()
      .from(videoModuleVersions)
      .where(eq(videoModuleVersions.moduleVersionId, body.moduleVersionId));
    expect(row.status).toBe("waiting");
    expect(row.muxUploadId).toBeTruthy();
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
    const [course] = await db.insert(courses).values({ code: `VIDTEST-${Date.now()}`, title: "Video Test" }).returning();
    createdCourseId = course.id;
    const request = new NextRequest(`http://localhost/api/admin/courses/${course.id}/modules/video`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    const response = await POST(request, { params: Promise.resolve({ courseId: course.id }) });
    expect(response.status).toBe(400);
  });
});
