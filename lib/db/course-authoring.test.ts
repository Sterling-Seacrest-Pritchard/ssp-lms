import { describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import AdmZip from "adm-zip";
import { eq, inArray } from "drizzle-orm";
import {
  createDraftCourse,
  updateCourseDetails,
  publishCourse,
  removeModule,
  reorderModules,
} from "./course-authoring";
import { db } from "./client";
import {
  courses,
  departments,
  moduleAttempts,
  modules,
  moduleVersions,
  scormAttemptState,
  scormModuleVersions,
  videoAttemptState,
  videoModuleVersions,
} from "./schema";
import { uploadScormPackage } from "@/lib/scorm/extract-package";
import { gcsStorage as supabaseStorage } from "@/lib/storage/gcs";

/**
 * Test-only replacement for the removed `addVideoPlaceholderModule` (Task 2
 * of the video-hosting-mux plan superseded it with the real Mux
 * upload-creation route) - inserts the same module/version/video rows
 * directly so the other exports in this file still have a video module to
 * exercise against.
 */
async function addVideoModuleForTest(courseId: string): Promise<{ moduleVersionId: string }> {
  const [mod] = await db.insert(modules).values({ courseId, moduleType: "video", title: "Test Video" }).returning();
  const [version] = await db
    .insert(moduleVersions)
    .values({ moduleId: mod.id, versionNumber: 1, status: "published", publishedAt: new Date() })
    .returning();
  await db.insert(videoModuleVersions).values({
    moduleVersionId: version.id,
    muxAssetId: "test-asset-id",
    muxPlaybackId: "test-playback-id",
    status: "ready",
    durationSeconds: 60,
  });
  await db.update(modules).set({ currentVersionId: version.id }).where(eq(modules.id, mod.id));
  return { moduleVersionId: version.id };
}

async function createTestVideoModule(courseId: string, title: string): Promise<{ moduleVersionId: string }> {
  const [courseModule] = await db
    .insert(modules)
    .values({ courseId, moduleType: "video", title })
    .returning();
  const [version] = await db
    .insert(moduleVersions)
    .values({ moduleId: courseModule.id, versionNumber: 1, status: "published", publishedAt: new Date() })
    .returning();
  await db.insert(videoModuleVersions).values({ moduleVersionId: version.id, status: "waiting" });
  await db.update(modules).set({ currentVersionId: version.id }).where(eq(modules.id, courseModule.id));
  return { moduleVersionId: version.id };
}

describe("createDraftCourse", () => {
  it("creates a draft course with a generated title and unique code", async () => {
    const { id } = await createDraftCourse();
    try {
      const [course] = await db.select().from(courses).where(eq(courses.id, id));
      expect(course.status).toBe("draft");
      expect(course.title).toBe("Untitled Course");
      expect(course.code).toBeTruthy();
    } finally {
      await db.delete(courses).where(eq(courses.id, id));
    }
  });
});

describe("updateCourseDetails", () => {
  it("updates only the fields provided", async () => {
    const { id } = await createDraftCourse();
    try {
      const [dept] = await db.select().from(departments).where(eq(departments.name, "IT"));
      await updateCourseDetails(id, { title: "New Title", departmentId: dept.id, compliance: true });
      const [course] = await db.select().from(courses).where(eq(courses.id, id));
      expect(course.title).toBe("New Title");
      expect(course.departmentId).toBe(dept.id);
      expect(course.compliance).toBe(true);
    } finally {
      await db.delete(courses).where(eq(courses.id, id));
    }
  });

  it("clears the due date when given null", async () => {
    const { id } = await createDraftCourse();
    try {
      await updateCourseDetails(id, { dueDate: "2026-12-01" });
      await updateCourseDetails(id, { dueDate: null });
      const [course] = await db.select().from(courses).where(eq(courses.id, id));
      expect(course.dueDate).toBeNull();
    } finally {
      await db.delete(courses).where(eq(courses.id, id));
    }
  });
});

describe("publishCourse", () => {
  it("refuses to publish a course with zero modules", async () => {
    const { id } = await createDraftCourse();
    try {
      const result = await publishCourse(id);
      expect(result).toEqual({ error: "Add at least one module before publishing" });
      const [course] = await db.select().from(courses).where(eq(courses.id, id));
      expect(course.status).toBe("draft");
    } finally {
      await db.delete(courses).where(eq(courses.id, id));
    }
  });

  it("publishes a course with at least one module", async () => {
    const { id } = await createDraftCourse();
    try {
      await createTestVideoModule(id, "A Module");
      const result = await publishCourse(id);
      expect(result).toEqual({ ok: true });
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

describe("removeModule", () => {
  it("deletes a module and its version rows", async () => {
    const { id: courseId } = await createDraftCourse();
    try {
      const { moduleVersionId } = await createTestVideoModule(courseId, "To Remove");
      const [mod] = await db.select().from(modules).where(eq(modules.courseId, courseId));

      await removeModule(courseId, mod.id);

      const remainingModules = await db.select().from(modules).where(eq(modules.courseId, courseId));
      expect(remainingModules).toHaveLength(0);
      const remainingVersions = await db
        .select()
        .from(videoModuleVersions)
        .where(eq(videoModuleVersions.moduleVersionId, moduleVersionId));
      expect(remainingVersions).toHaveLength(0);
    } finally {
      await db.delete(courses).where(eq(courses.id, courseId));
    }
  });

  it("removes a module a learner has already started, deleting its attempt rows", async () => {
    const { id: courseId } = await createDraftCourse();
    const userId = `remove-module-test-${randomUUID()}@example.com`;
    try {
      const { moduleVersionId } = await createTestVideoModule(courseId, "Started");
      const [mod] = await db.select().from(modules).where(eq(modules.courseId, courseId));
      const [attempt] = await db
        .insert(moduleAttempts)
        .values({ moduleVersionId, userId, attemptNumber: 1 })
        .returning();
      await db
        .insert(scormAttemptState)
        .values({ moduleAttemptId: attempt.id, lessonStatus: "incomplete", rawCmi: {} });

      // module_attempts.module_version_id is a NOT NULL FK with no cascade, so
      // before the FK cleanup this threw and aborted the transaction.
      await removeModule(courseId, mod.id);

      expect(await db.select().from(modules).where(eq(modules.courseId, courseId))).toHaveLength(0);
      expect(
        await db.select().from(moduleAttempts).where(eq(moduleAttempts.id, attempt.id))
      ).toHaveLength(0);
      expect(
        await db
          .select()
          .from(scormAttemptState)
          .where(eq(scormAttemptState.moduleAttemptId, attempt.id))
      ).toHaveLength(0);
    } finally {
      await db.delete(courses).where(eq(courses.id, courseId));
    }
  });

  it("removes a video module a learner has already watched, deleting its video attempt state", async () => {
    const { id: courseId } = await createDraftCourse();
    const userId = `remove-video-module-test-${randomUUID()}@example.com`;
    const deleteSpy = vi.fn().mockResolvedValue(undefined);
    try {
      // A real, ready video module (with a Mux asset) plus a real committed
      // learner attempt - the exact shape that used to raise an FK violation
      // on video_attempt_state and abort the whole removal transaction,
      // permanently wedging the module's slot against the Mux free-tier cap.
      const { moduleVersionId } = await addVideoModuleForTest(courseId);
      const [mod] = await db.select().from(modules).where(eq(modules.currentVersionId, moduleVersionId));
      const [attempt] = await db
        .insert(moduleAttempts)
        .values({ moduleVersionId, userId, attemptNumber: 1 })
        .returning();
      await db.insert(videoAttemptState).values({
        moduleAttemptId: attempt.id,
        furthestWatchedSeconds: 42,
        lastPositionSeconds: 42,
        status: "in_progress",
      });

      vi.spyOn(await import("@/lib/video/mux-client"), "getMuxClient").mockReturnValue({
        video: { assets: { delete: deleteSpy } },
      } as unknown as ReturnType<typeof import("@/lib/video/mux-client").getMuxClient>);

      await removeModule(courseId, mod.id);

      expect(await db.select().from(modules).where(eq(modules.courseId, courseId))).toHaveLength(0);
      expect(
        await db
          .select()
          .from(videoAttemptState)
          .where(eq(videoAttemptState.moduleAttemptId, attempt.id))
      ).toHaveLength(0);
      expect(
        await db.select().from(moduleAttempts).where(eq(moduleAttempts.id, attempt.id))
      ).toHaveLength(0);
      expect(
        await db
          .select()
          .from(videoModuleVersions)
          .where(eq(videoModuleVersions.moduleVersionId, moduleVersionId))
      ).toHaveLength(0);
    } finally {
      vi.restoreAllMocks();
      await db.delete(courses).where(eq(courses.id, courseId));
    }
  });

  it("deletes the SCORM package from Storage instead of orphaning it", async () => {
    const { id: courseId } = await createDraftCourse();
    const prefix = `remove-module-test/${randomUUID()}`;
    try {
      const zip = new AdmZip();
      zip.addFile("imsmanifest.xml", Buffer.from("<manifest/>"));
      zip.addFile("index.html", Buffer.from("<html></html>"));
      // A nested file, to prove the delete walks subdirectories: Storage's
      // list() is not recursive.
      zip.addFile("assets/app.js", Buffer.from("console.log(1);"));
      await uploadScormPackage(zip.toBuffer(), prefix);

      const [mod] = await db
        .insert(modules)
        .values({ courseId, moduleType: "scorm", title: "Scorm To Remove" })
        .returning();
      const [version] = await db
        .insert(moduleVersions)
        .values({ moduleId: mod.id, versionNumber: 1, status: "published" })
        .returning();
      await db.insert(scormModuleVersions).values({
        moduleVersionId: version.id,
        gcsPrefix: prefix,
        manifestIdentifier: "x",
        scormVersion: "1.2",
        launchUrl: "index.html",
        rawManifestXml: "<manifest/>",
      });
      await db.update(modules).set({ currentVersionId: version.id }).where(eq(modules.id, mod.id));

      await removeModule(courseId, mod.id);

      const { data: rootEntries } = await supabaseStorage.from("ssp-lms-scorm-packages").list(prefix);
      expect(rootEntries ?? []).toHaveLength(0);
      const { data: assetEntries } = await supabaseStorage
        .from("ssp-lms-scorm-packages")
        .list(`${prefix}/assets`);
      expect(assetEntries ?? []).toHaveLength(0);
    } finally {
      const { data } = await supabaseStorage.from("ssp-lms-scorm-packages").list(prefix);
      const paths = (data ?? []).map((f) => `${prefix}/${f.name}`);
      if (paths.length) await supabaseStorage.from("ssp-lms-scorm-packages").remove(paths);
      await db.delete(courses).where(eq(courses.id, courseId));
    }
  });

  it("does nothing for a non-UUID id", async () => {
    await expect(removeModule("not-a-uuid", randomUUID())).resolves.toBeUndefined();
    await expect(removeModule(randomUUID(), "not-a-uuid")).resolves.toBeUndefined();
  });

  it("removes a video module and deletes its Mux asset", async () => {
    const { id: courseId } = await createDraftCourse();
    const { moduleVersionId } = await addVideoModuleForTest(courseId);
    const [videoRow] = await db.select().from(videoModuleVersions).where(eq(videoModuleVersions.moduleVersionId, moduleVersionId));
    const [mod] = await db.select().from(modules).where(eq(modules.currentVersionId, moduleVersionId));

    const deleteSpy = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(await import("@/lib/video/mux-client"), "getMuxClient").mockReturnValue({
      video: { assets: { delete: deleteSpy } },
    } as unknown as ReturnType<typeof import("@/lib/video/mux-client").getMuxClient>);

    await removeModule(courseId, mod.id);

    expect(deleteSpy).toHaveBeenCalledWith(videoRow.muxAssetId);
    const remaining = await db.select().from(videoModuleVersions).where(eq(videoModuleVersions.moduleVersionId, moduleVersionId));
    expect(remaining).toHaveLength(0);

    await db.delete(courses).where(eq(courses.id, courseId));
  });

  it("does nothing if the module belongs to a different course", async () => {
    const { id: courseId } = await createDraftCourse();
    const { id: otherCourseId } = await createDraftCourse();
    try {
      await createTestVideoModule(courseId, "Belongs Here");
      const [mod] = await db.select().from(modules).where(eq(modules.courseId, courseId));

      await removeModule(otherCourseId, mod.id);

      const stillThere = await db.select().from(modules).where(eq(modules.id, mod.id));
      expect(stillThere).toHaveLength(1);
    } finally {
      const mods = await db.select().from(modules).where(eq(modules.courseId, courseId));
      const moduleIds = mods.map((m) => m.id);
      await db.update(modules).set({ currentVersionId: null }).where(inArray(modules.id, moduleIds));
      const versions = await db.select().from(moduleVersions).where(inArray(moduleVersions.moduleId, moduleIds));
      const versionIds = versions.map((v) => v.id);
      await db.delete(videoModuleVersions).where(inArray(videoModuleVersions.moduleVersionId, versionIds));
      await db.delete(moduleVersions).where(inArray(moduleVersions.id, versionIds));
      await db.delete(modules).where(inArray(modules.id, moduleIds));
      await db.delete(courses).where(inArray(courses.id, [courseId, otherCourseId]));
    }
  });
});

describe("reorderModules", () => {
  it("updates sortOrder to match the given order", async () => {
    const { id: courseId } = await createDraftCourse();
    try {
      await createTestVideoModule(courseId, "First");
      await createTestVideoModule(courseId, "Second");
      const mods = await db
        .select()
        .from(modules)
        .where(eq(modules.courseId, courseId))
        .orderBy(modules.createdAt);
      const [first, second] = mods;

      await reorderModules(courseId, [second.id, first.id]);

      const reordered = await db
        .select()
        .from(modules)
        .where(eq(modules.courseId, courseId))
        .orderBy(modules.sortOrder);
      expect(reordered[0].id).toBe(second.id);
      expect(reordered[1].id).toBe(first.id);
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
