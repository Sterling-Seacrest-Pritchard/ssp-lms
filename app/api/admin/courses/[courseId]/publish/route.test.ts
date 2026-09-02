import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { POST } from "./route";
import { createDraftCourse, addVideoPlaceholderModule } from "@/lib/db/course-authoring";
import { db } from "@/lib/db/client";
import { courses, modules, moduleVersions, videoModuleVersions } from "@/lib/db/schema";

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
    await addVideoPlaceholderModule(id, "A Module", 5);
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
});
