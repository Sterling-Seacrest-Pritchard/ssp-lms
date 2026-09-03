import { describe, it, expect, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { GET } from "./route";
import { db } from "@/lib/db/client";
import { courses, modules, moduleVersions, videoModuleVersions } from "@/lib/db/schema";

describe("GET .../[moduleId]/video-status", () => {
  let createdCourseId: string | undefined;
  let moduleId: string | undefined;

  afterEach(async () => {
    if (!createdCourseId) return;
    if (moduleId) {
      await db.update(modules).set({ currentVersionId: null }).where(eq(modules.id, moduleId));
      const versions = await db.select().from(moduleVersions).where(eq(moduleVersions.moduleId, moduleId));
      for (const v of versions) {
        await db.delete(videoModuleVersions).where(eq(videoModuleVersions.moduleVersionId, v.id));
      }
      await db.delete(moduleVersions).where(eq(moduleVersions.moduleId, moduleId));
      await db.delete(modules).where(eq(modules.id, moduleId));
    }
    await db.delete(courses).where(eq(courses.id, createdCourseId));
    createdCourseId = undefined;
    moduleId = undefined;
  });

  it("returns the current status for a still-waiting upload", async () => {
    const [course] = await db.insert(courses).values({ code: `VIDSTATUS-${Date.now()}`, title: "x" }).returning();
    createdCourseId = course.id;
    const [mod] = await db.insert(modules).values({ courseId: course.id, moduleType: "video", title: "x" }).returning();
    moduleId = mod.id;
    const [version] = await db
      .insert(moduleVersions)
      .values({ moduleId: mod.id, versionNumber: 1, status: "published", publishedAt: new Date() })
      .returning();
    await db.update(modules).set({ currentVersionId: version.id }).where(eq(modules.id, mod.id));
    await db.insert(videoModuleVersions).values({
      moduleVersionId: version.id,
      muxUploadId: "does-not-exist-in-mux",
      status: "waiting",
    });

    const request = new NextRequest(`http://localhost/api/admin/courses/${course.id}/modules/${mod.id}/video-status`);
    const response = await GET(request, { params: Promise.resolve({ courseId: course.id, moduleId: mod.id }) });
    // A fake muxUploadId means the Mux API call itself will fail or return
    // not-found - the route must not 500 on that, it must report the DB's
    // current status rather than crash.
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("waiting");
  });

  it("rejects a non-UUID moduleId", async () => {
    const request = new NextRequest("http://localhost/api/admin/courses/00000000-0000-0000-0000-000000000000/modules/not-a-uuid/video-status");
    const response = await GET(request, {
      params: Promise.resolve({ courseId: "00000000-0000-0000-0000-000000000000", moduleId: "not-a-uuid" }),
    });
    expect(response.status).toBe(400);
  });
});
