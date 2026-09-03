import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import AdmZip from "adm-zip";
import { eq, inArray } from "drizzle-orm";
import {
  createDraftCourse,
  updateCourseDetails,
  publishCourse,
  removeModule,
  reorderModules,
  addVideoPlaceholderModule,
} from "./course-authoring";
import { db } from "./client";
import {
  courses,
  moduleAttempts,
  modules,
  moduleVersions,
  scormAttemptState,
  scormModuleVersions,
  videoModuleVersions,
} from "./schema";
import { uploadScormPackage } from "@/lib/scorm/extract-package";
import { supabaseStorage } from "@/lib/storage/supabase";

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
      await updateCourseDetails(id, { title: "New Title", department: "IT", compliance: true });
      const [course] = await db.select().from(courses).where(eq(courses.id, id));
      expect(course.title).toBe("New Title");
      expect(course.department).toBe("IT");
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
      await addVideoPlaceholderModule(id, "A Module", 5);
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

describe("addVideoPlaceholderModule", () => {
  it("creates a module, version, and video_module_versions row, and sets currentVersionId", async () => {
    const { id: courseId } = await createDraftCourse();
    try {
      const { moduleVersionId } = await addVideoPlaceholderModule(courseId, "Intro Video", 12);

      const [video] = await db
        .select()
        .from(videoModuleVersions)
        .where(eq(videoModuleVersions.moduleVersionId, moduleVersionId));
      expect(video.durationMinutes).toBe(12);

      const [mod] = await db.select().from(modules).where(eq(modules.courseId, courseId));
      expect(mod.moduleType).toBe("video");
      expect(mod.currentVersionId).toBe(moduleVersionId);
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

describe("removeModule", () => {
  it("deletes a module and its version rows", async () => {
    const { id: courseId } = await createDraftCourse();
    try {
      const { moduleVersionId } = await addVideoPlaceholderModule(courseId, "To Remove", 3);
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
      const { moduleVersionId } = await addVideoPlaceholderModule(courseId, "Started", 3);
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

      const { data: rootEntries } = await supabaseStorage.from("scorm-packages").list(prefix);
      expect(rootEntries ?? []).toHaveLength(0);
      const { data: assetEntries } = await supabaseStorage
        .from("scorm-packages")
        .list(`${prefix}/assets`);
      expect(assetEntries ?? []).toHaveLength(0);
    } finally {
      const { data } = await supabaseStorage.from("scorm-packages").list(prefix);
      const paths = (data ?? []).map((f) => `${prefix}/${f.name}`);
      if (paths.length) await supabaseStorage.from("scorm-packages").remove(paths);
      await db.delete(courses).where(eq(courses.id, courseId));
    }
  });

  it("does nothing for a non-UUID id", async () => {
    await expect(removeModule("not-a-uuid", randomUUID())).resolves.toBeUndefined();
    await expect(removeModule(randomUUID(), "not-a-uuid")).resolves.toBeUndefined();
  });

  it("does nothing if the module belongs to a different course", async () => {
    const { id: courseId } = await createDraftCourse();
    const { id: otherCourseId } = await createDraftCourse();
    try {
      await addVideoPlaceholderModule(courseId, "Belongs Here", 3);
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
      await addVideoPlaceholderModule(courseId, "First", 1);
      await addVideoPlaceholderModule(courseId, "Second", 1);
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
