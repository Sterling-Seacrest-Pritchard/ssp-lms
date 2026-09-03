import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { getCourseProgressForLearner } from "./course-progress";
import { db } from "@/lib/db/client";
import {
  courses,
  modules,
  moduleVersions,
  moduleAttempts,
  scormAttemptState,
} from "@/lib/db/schema";

describe("getCourseProgressForLearner", () => {
  const courseCode = `COURSE-PROGRESS-TEST-${randomUUID()}`;
  const userId = "course-progress-test@example.com";

  afterAll(async () => {
    const [course] = await db.select().from(courses).where(eq(courses.code, courseCode));
    if (course) {
      const mods = await db.select().from(modules).where(eq(modules.courseId, course.id));
      const moduleIds = mods.map((m) => m.id);
      const attempts = await db
        .select()
        .from(moduleAttempts)
        .where(eq(moduleAttempts.userId, userId));
      const attemptIds = attempts.map((a) => a.id);
      if (attemptIds.length) {
        await db
          .delete(scormAttemptState)
          .where(inArray(scormAttemptState.moduleAttemptId, attemptIds));
        await db.delete(moduleAttempts).where(inArray(moduleAttempts.id, attemptIds));
      }
      if (moduleIds.length) {
        for (const moduleId of moduleIds) {
          await db.update(modules).set({ currentVersionId: null }).where(eq(modules.id, moduleId));
        }
        const versions = await db
          .select()
          .from(moduleVersions)
          .where(inArray(moduleVersions.moduleId, moduleIds));
        if (versions.length) {
          await db.delete(moduleVersions).where(inArray(moduleVersions.id, versions.map((v) => v.id)));
        }
        await db.delete(modules).where(inArray(modules.id, moduleIds));
      }
      await db.delete(courses).where(eq(courses.id, course.id));
    }
  });

  it("returns not-started with 0 progress when the learner has no attempts", async () => {
    const [course] = await db
      .insert(courses)
      .values({ code: courseCode, title: "Course Progress Test", status: "published" })
      .returning();
    const [mod] = await db
      .insert(modules)
      .values({ courseId: course.id, moduleType: "scorm", title: "Module 1" })
      .returning();
    const [version] = await db
      .insert(moduleVersions)
      .values({ moduleId: mod.id, versionNumber: 1, status: "published" })
      .returning();
    await db.update(modules).set({ currentVersionId: version.id }).where(eq(modules.id, mod.id));

    const result = await getCourseProgressForLearner(course.id, userId);

    expect(result).toEqual({ status: "not-started", progress: 0 });
  });

  it("returns completed with 100 progress when every module is completed", async () => {
    const [course] = await db
      .insert(courses)
      .values({ code: `${courseCode}-done`, title: "Course Progress Done Test", status: "published" })
      .returning();
    const [mod] = await db
      .insert(modules)
      .values({ courseId: course.id, moduleType: "scorm", title: "Module 1" })
      .returning();
    const [version] = await db
      .insert(moduleVersions)
      .values({ moduleId: mod.id, versionNumber: 1, status: "published" })
      .returning();
    await db.update(modules).set({ currentVersionId: version.id }).where(eq(modules.id, mod.id));
    const [attempt] = await db
      .insert(moduleAttempts)
      .values({ moduleVersionId: version.id, userId, attemptNumber: 1 })
      .returning();
    await db
      .insert(scormAttemptState)
      .values({ moduleAttemptId: attempt.id, lessonStatus: "completed", rawCmi: {} });

    try {
      const result = await getCourseProgressForLearner(course.id, userId);

      expect(result).toEqual({ status: "completed", progress: 100 });
    } finally {
      await db.delete(scormAttemptState).where(eq(scormAttemptState.moduleAttemptId, attempt.id));
      await db.delete(moduleAttempts).where(eq(moduleAttempts.id, attempt.id));
      await db.update(modules).set({ currentVersionId: null }).where(eq(modules.id, mod.id));
      await db.delete(moduleVersions).where(eq(moduleVersions.id, version.id));
      await db.delete(modules).where(eq(modules.id, mod.id));
      await db.delete(courses).where(eq(courses.id, course.id));
    }
  });

  it("reaches completed when every SCORM module is done, ignoring untracked video placeholders", async () => {
    const [course] = await db
      .insert(courses)
      .values({
        code: `${courseCode}-video`,
        title: "Course Progress Video Test",
        status: "published",
      })
      .returning();
    const [scormModule] = await db
      .insert(modules)
      .values({ courseId: course.id, moduleType: "scorm", title: "Scorm Module" })
      .returning();
    const [videoModule] = await db
      .insert(modules)
      .values({ courseId: course.id, moduleType: "video", title: "Video Placeholder" })
      .returning();
    const [scormVersion] = await db
      .insert(moduleVersions)
      .values({ moduleId: scormModule.id, versionNumber: 1, status: "published" })
      .returning();
    const [videoVersion] = await db
      .insert(moduleVersions)
      .values({ moduleId: videoModule.id, versionNumber: 1, status: "published" })
      .returning();
    await db
      .update(modules)
      .set({ currentVersionId: scormVersion.id })
      .where(eq(modules.id, scormModule.id));
    await db
      .update(modules)
      .set({ currentVersionId: videoVersion.id })
      .where(eq(modules.id, videoModule.id));
    const [attempt] = await db
      .insert(moduleAttempts)
      .values({ moduleVersionId: scormVersion.id, userId, attemptNumber: 1 })
      .returning();
    await db
      .insert(scormAttemptState)
      .values({ moduleAttemptId: attempt.id, lessonStatus: "completed", rawCmi: {} });

    try {
      const result = await getCourseProgressForLearner(course.id, userId);

      expect(result).toEqual({ status: "completed", progress: 100 });
    } finally {
      await db.delete(scormAttemptState).where(eq(scormAttemptState.moduleAttemptId, attempt.id));
      await db.delete(moduleAttempts).where(eq(moduleAttempts.id, attempt.id));
      await db
        .update(modules)
        .set({ currentVersionId: null })
        .where(inArray(modules.id, [scormModule.id, videoModule.id]));
      await db
        .delete(moduleVersions)
        .where(inArray(moduleVersions.id, [scormVersion.id, videoVersion.id]));
      await db.delete(modules).where(inArray(modules.id, [scormModule.id, videoModule.id]));
      await db.delete(courses).where(eq(courses.id, course.id));
    }
  });

  it("returns not-started for a non-UUID course id instead of hitting Postgres", async () => {
    expect(await getCourseProgressForLearner("not-a-uuid", userId)).toEqual({
      status: "not-started",
      progress: 0,
    });
  });

  it("returns in-progress with partial progress when only some modules are completed", async () => {
    const [course] = await db
      .insert(courses)
      .values({ code: `${courseCode}-partial`, title: "Course Progress Partial Test", status: "published" })
      .returning();
    const [modA] = await db
      .insert(modules)
      .values({ courseId: course.id, moduleType: "scorm", title: "Module A" })
      .returning();
    const [modB] = await db
      .insert(modules)
      .values({ courseId: course.id, moduleType: "scorm", title: "Module B" })
      .returning();
    const [versionA] = await db
      .insert(moduleVersions)
      .values({ moduleId: modA.id, versionNumber: 1, status: "published" })
      .returning();
    const [versionB] = await db
      .insert(moduleVersions)
      .values({ moduleId: modB.id, versionNumber: 1, status: "published" })
      .returning();
    await db.update(modules).set({ currentVersionId: versionA.id }).where(eq(modules.id, modA.id));
    await db.update(modules).set({ currentVersionId: versionB.id }).where(eq(modules.id, modB.id));
    const [attemptA] = await db
      .insert(moduleAttempts)
      .values({ moduleVersionId: versionA.id, userId, attemptNumber: 1 })
      .returning();
    await db
      .insert(scormAttemptState)
      .values({ moduleAttemptId: attemptA.id, lessonStatus: "completed", rawCmi: {} });

    try {
      const result = await getCourseProgressForLearner(course.id, userId);

      expect(result).toEqual({ status: "in-progress", progress: 50 });
    } finally {
      await db.delete(scormAttemptState).where(eq(scormAttemptState.moduleAttemptId, attemptA.id));
      await db.delete(moduleAttempts).where(eq(moduleAttempts.id, attemptA.id));
      await db
        .update(modules)
        .set({ currentVersionId: null })
        .where(inArray(modules.id, [modA.id, modB.id]));
      await db.delete(moduleVersions).where(inArray(moduleVersions.id, [versionA.id, versionB.id]));
      await db.delete(modules).where(inArray(modules.id, [modA.id, modB.id]));
      await db.delete(courses).where(eq(courses.id, course.id));
    }
  });
});
