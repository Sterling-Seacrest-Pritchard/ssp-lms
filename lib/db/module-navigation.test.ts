import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { getAdjacentModules } from "./module-navigation";
import { db } from "./client";
import { courses, modules, moduleVersions, videoAssets, videoModuleVersions } from "./schema";

async function seedCourse() {
  const [course] = await db.insert(courses).values({ code: `NAV-${randomUUID()}`, title: "Nav Test Course" }).returning();
  return course;
}

async function seedScormModule(courseId: string, sortOrder: number, title: string) {
  const [mod] = await db.insert(modules).values({ courseId, moduleType: "scorm", title, sortOrder }).returning();
  const [version] = await db
    .insert(moduleVersions)
    .values({ moduleId: mod.id, versionNumber: 1, status: "published" })
    .returning();
  await db.update(modules).set({ currentVersionId: version.id }).where(eq(modules.id, mod.id));
  return { moduleId: mod.id, moduleVersionId: version.id };
}

async function seedVideoModule(courseId: string, sortOrder: number, title: string, videoStatus: string) {
  const [mod] = await db.insert(modules).values({ courseId, moduleType: "video", title, sortOrder }).returning();
  const [version] = await db
    .insert(moduleVersions)
    .values({ moduleId: mod.id, versionNumber: 1, status: "published" })
    .returning();
  const [asset] = await db.insert(videoAssets).values({ title, status: videoStatus }).returning();
  await db.insert(videoModuleVersions).values({ moduleVersionId: version.id, videoAssetId: asset.id });
  await db.update(modules).set({ currentVersionId: version.id }).where(eq(modules.id, mod.id));
  return { moduleId: mod.id, moduleVersionId: version.id, assetId: asset.id };
}

async function cleanup(courseId: string, moduleIds: string[], assetIds: string[]) {
  const versionIds = (
    await db.select({ id: moduleVersions.id }).from(moduleVersions).where(inArray(moduleVersions.moduleId, moduleIds))
  ).map((v) => v.id);
  if (versionIds.length) {
    await db.update(modules).set({ currentVersionId: null }).where(inArray(modules.id, moduleIds));
    await db.delete(videoModuleVersions).where(inArray(videoModuleVersions.moduleVersionId, versionIds));
    await db.delete(moduleVersions).where(inArray(moduleVersions.id, versionIds));
  }
  await db.delete(modules).where(inArray(modules.id, moduleIds));
  if (assetIds.length) {
    await db.delete(videoAssets).where(inArray(videoAssets.id, assetIds));
  }
  await db.delete(courses).where(eq(courses.id, courseId));
}

describe("getAdjacentModules", () => {
  it("returns the prev/next modules in sortOrder for a module in the middle", async () => {
    const course = await seedCourse();
    const a = await seedScormModule(course.id, 0, "Module A");
    const b = await seedScormModule(course.id, 1, "Module B");
    const c = await seedScormModule(course.id, 2, "Module C");

    try {
      const result = await getAdjacentModules(course.id, b.moduleVersionId);
      expect(result.prev?.moduleVersionId).toBe(a.moduleVersionId);
      expect(result.next?.moduleVersionId).toBe(c.moduleVersionId);
    } finally {
      await cleanup(course.id, [a.moduleId, b.moduleId, c.moduleId], []);
    }
  });

  it("returns null prev for the first module and null next for the last", async () => {
    const course = await seedCourse();
    const a = await seedScormModule(course.id, 0, "Module A");
    const b = await seedScormModule(course.id, 1, "Module B");

    try {
      const first = await getAdjacentModules(course.id, a.moduleVersionId);
      expect(first.prev).toBeNull();
      expect(first.next?.moduleVersionId).toBe(b.moduleVersionId);

      const last = await getAdjacentModules(course.id, b.moduleVersionId);
      expect(last.next).toBeNull();
      expect(last.prev?.moduleVersionId).toBe(a.moduleVersionId);
    } finally {
      await cleanup(course.id, [a.moduleId, b.moduleId], []);
    }
  });

  it("skips a video module that isn't ready yet", async () => {
    const course = await seedCourse();
    const a = await seedScormModule(course.id, 0, "Module A");
    const notReadyVideo = await seedVideoModule(course.id, 1, "Not Ready Video", "waiting");
    const c = await seedScormModule(course.id, 2, "Module C");

    try {
      const result = await getAdjacentModules(course.id, a.moduleVersionId);
      expect(result.next?.moduleVersionId).toBe(c.moduleVersionId);
    } finally {
      await cleanup(
        course.id,
        [a.moduleId, notReadyVideo.moduleId, c.moduleId],
        [notReadyVideo.assetId]
      );
    }
  });

  it("returns null/null when the module id isn't among the course's launchable modules", async () => {
    const course = await seedCourse();
    const a = await seedScormModule(course.id, 0, "Module A");
    try {
      const result = await getAdjacentModules(course.id, randomUUID());
      expect(result).toEqual({ prev: null, next: null });
    } finally {
      await cleanup(course.id, [a.moduleId], []);
    }
  });
});
