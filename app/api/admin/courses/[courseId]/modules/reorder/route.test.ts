import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { PATCH } from "./route";
import { createDraftCourse } from "@/lib/db/course-authoring";
import { db } from "@/lib/db/client";
import { courses, modules, moduleVersions, videoModuleVersions } from "@/lib/db/schema";

/**
 * Test-only replacement for the removed `addVideoPlaceholderModule` (Task 2
 * of the video-hosting-mux plan superseded it with the real Mux
 * upload-creation route) - inserts the same module/version/video rows
 * directly so this test still has modules to reorder.
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

describe("PATCH /api/admin/courses/[courseId]/modules/reorder", () => {
  it("reorders modules to match the given array", async () => {
    const { id: courseId } = await createDraftCourse();
    await createTestVideoModule(courseId, "First");
    await createTestVideoModule(courseId, "Second");
    try {
      const mods = await db
        .select()
        .from(modules)
        .where(eq(modules.courseId, courseId))
        .orderBy(modules.createdAt);
      const [first, second] = mods;

      const request = new NextRequest(
        `http://localhost/api/admin/courses/${courseId}/modules/reorder`,
        { method: "PATCH", body: JSON.stringify({ moduleIds: [second.id, first.id] }) }
      );
      const response = await PATCH(request, { params: Promise.resolve({ courseId }) });
      expect(response.status).toBe(200);

      const reordered = await db
        .select()
        .from(modules)
        .where(eq(modules.courseId, courseId))
        .orderBy(modules.sortOrder);
      expect(reordered[0].id).toBe(second.id);
    } finally {
      const mods = await db.select().from(modules).where(eq(modules.courseId, courseId));
      const moduleIds = mods.map((m) => m.id);
      await db.update(modules).set({ currentVersionId: null }).where(inArray(modules.id, moduleIds));
      const versions = await db.select().from(moduleVersions).where(inArray(moduleVersions.moduleId, moduleIds));
      const versionIds = versions.map((v) => v.id);
      await db.delete(videoModuleVersions).where(inArray(videoModuleVersions.moduleVersionId, versionIds));
      await db.delete(moduleVersions).where(inArray(moduleVersions.id, versionIds));
      await db.delete(modules).where(inArray(modules.id, moduleIds));
      await db.delete(courses).where(eq(courses.id, courseId));
    }
  });
});
