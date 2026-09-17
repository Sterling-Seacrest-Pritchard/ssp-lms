import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { computeLiveCourseProgress, getCourseProgressForLearner } from "./course-progress";
import { db } from "@/lib/db/client";
import {
  courses,
  modules,
  moduleVersions,
  moduleAttempts,
  scormAttemptState,
  videoAssets,
  videoAttemptState,
  videoModuleVersions,
  enrollments,
  moduleProgress,
  users,
} from "@/lib/db/schema";

// Tracked here so a single file-level afterAll can clean these up - this
// file's own per-test cleanup blocks never deleted the video_assets row
// markVideoReady creates, which leaked real rows into production on every
// test run (there is no separate test database; DATABASE_URL is the live
// Cloud SQL instance). See lib/db/course-authoring.test.ts for the same fix.
const createdTestVideoAssetIds: string[] = [];

afterAll(async () => {
  if (createdTestVideoAssetIds.length > 0) {
    await db.delete(videoAssets).where(inArray(videoAssets.id, createdTestVideoAssetIds));
  }
});

/**
 * A video module is only tracked once its Mux asset is `ready`, so every
 * video module in these tests needs a real video_assets row linked to it -
 * the same shape the video-status poll writes once Mux finishes processing.
 */
async function markVideoReady(moduleVersionId: string) {
  const [asset] = await db
    .insert(videoAssets)
    .values({
      title: "Test Video",
      muxAssetId: `asset-${randomUUID()}`,
      muxPlaybackId: `playback-${randomUUID()}`,
      status: "ready",
      durationSeconds: 60,
    })
    .returning();
  createdTestVideoAssetIds.push(asset.id);
  await db.insert(videoModuleVersions).values({ moduleVersionId, videoAssetId: asset.id });
}

describe("computeLiveCourseProgress", () => {
  const courseCode = `COURSE-PROGRESS-TEST-${randomUUID()}`;
  let userId: string;

  beforeAll(async () => {
    const [testUser] = await db
      .insert(users)
      .values({ email: `course-progress-test-${randomUUID()}@example.com`, displayName: "Course Progress Test User" })
      .returning();
    userId = testUser.id;
  });

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
          const versionIds = versions.map((v) => v.id);
          await db
            .delete(videoModuleVersions)
            .where(inArray(videoModuleVersions.moduleVersionId, versionIds));
          await db.delete(moduleVersions).where(inArray(moduleVersions.id, versionIds));
        }
        await db.delete(modules).where(inArray(modules.id, moduleIds));
      }
      await db.delete(courses).where(eq(courses.id, course.id));
    }
    await db.delete(users).where(eq(users.id, userId));
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

    const result = await computeLiveCourseProgress(course.id, userId);

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
      const result = await computeLiveCourseProgress(course.id, userId);

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

  it("treats a quiz module with a completed attempt as finished (isModuleFinishedForUser quiz branch)", async () => {
    const [course] = await db
      .insert(courses)
      .values({ code: `${courseCode}-quiz`, title: "Course Progress Quiz Test", status: "published" })
      .returning();
    const [mod] = await db
      .insert(modules)
      .values({ courseId: course.id, moduleType: "quiz", title: "Quiz Module" })
      .returning();
    const [version] = await db
      .insert(moduleVersions)
      .values({ moduleId: mod.id, versionNumber: 1, status: "published" })
      .returning();
    await db.update(modules).set({ currentVersionId: version.id }).where(eq(modules.id, mod.id));
    const [attempt] = await db
      .insert(moduleAttempts)
      .values({ moduleVersionId: version.id, userId, attemptNumber: 1, status: "completed" })
      .returning();

    try {
      const result = await computeLiveCourseProgress(course.id, userId);

      // Before the fix, isModuleFinishedForUser fell through to the
      // SCORM-style getLatestLessonStatus check for "quiz", which always
      // returned null (no scorm_attempt_state row for a quiz attempt), so
      // this module was never seen as finished.
      expect(result).toEqual({ status: "completed", progress: 100 });
    } finally {
      await db.delete(moduleAttempts).where(eq(moduleAttempts.id, attempt.id));
      await db.update(modules).set({ currentVersionId: null }).where(eq(modules.id, mod.id));
      await db.delete(moduleVersions).where(eq(moduleVersions.id, version.id));
      await db.delete(modules).where(eq(modules.id, mod.id));
      await db.delete(courses).where(eq(courses.id, course.id));
    }
  });

  it("does not ignore an unfinished video module - only the SCORM module being done leaves it in-progress", async () => {
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
      .values({ courseId: course.id, moduleType: "video", title: "Video Module" })
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
    await markVideoReady(videoVersion.id);
    const [attempt] = await db
      .insert(moduleAttempts)
      .values({ moduleVersionId: scormVersion.id, userId, attemptNumber: 1 })
      .returning();
    await db
      .insert(scormAttemptState)
      .values({ moduleAttemptId: attempt.id, lessonStatus: "completed", rawCmi: {} });

    try {
      const result = await computeLiveCourseProgress(course.id, userId);

      expect(result).toEqual({ status: "in-progress", progress: 50 });
    } finally {
      await db.delete(scormAttemptState).where(eq(scormAttemptState.moduleAttemptId, attempt.id));
      await db.delete(moduleAttempts).where(eq(moduleAttempts.id, attempt.id));
      await db
        .update(modules)
        .set({ currentVersionId: null })
        .where(inArray(modules.id, [scormModule.id, videoModule.id]));
      await db
        .delete(videoModuleVersions)
        .where(eq(videoModuleVersions.moduleVersionId, videoVersion.id));
      await db
        .delete(moduleVersions)
        .where(inArray(moduleVersions.id, [scormVersion.id, videoVersion.id]));
      await db.delete(modules).where(inArray(modules.id, [scormModule.id, videoModule.id]));
      await db.delete(courses).where(eq(courses.id, course.id));
    }
  });

  it("ignores a video module whose Mux asset is not ready, so the course can still reach 100%", async () => {
    // The exact shape Task 1's backfill migration left every pre-existing
    // placeholder video row in: status "errored", no asset, no playback id.
    // Counting it would pin this course below 100% forever, and it would
    // render a "Start" button leading to a 404.
    const [course] = await db
      .insert(courses)
      .values({
        code: `${courseCode}-video-errored`,
        title: "Course Progress Errored Video Test",
        status: "published",
      })
      .returning();
    const [scormModule] = await db
      .insert(modules)
      .values({ courseId: course.id, moduleType: "scorm", title: "Scorm Module" })
      .returning();
    const [videoModule] = await db
      .insert(modules)
      .values({ courseId: course.id, moduleType: "video", title: "Errored Video Module" })
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
    const [erroredAsset] = await db
      .insert(videoAssets)
      .values({ title: "Test Video", status: "errored" })
      .returning();
    await db
      .insert(videoModuleVersions)
      .values({ moduleVersionId: videoVersion.id, videoAssetId: erroredAsset.id });
    const [attempt] = await db
      .insert(moduleAttempts)
      .values({ moduleVersionId: scormVersion.id, userId, attemptNumber: 1 })
      .returning();
    await db
      .insert(scormAttemptState)
      .values({ moduleAttemptId: attempt.id, lessonStatus: "completed", rawCmi: {} });

    try {
      const result = await computeLiveCourseProgress(course.id, userId);

      expect(result).toEqual({ status: "completed", progress: 100 });
    } finally {
      await db.delete(scormAttemptState).where(eq(scormAttemptState.moduleAttemptId, attempt.id));
      await db.delete(moduleAttempts).where(eq(moduleAttempts.id, attempt.id));
      await db
        .update(modules)
        .set({ currentVersionId: null })
        .where(inArray(modules.id, [scormModule.id, videoModule.id]));
      await db
        .delete(videoModuleVersions)
        .where(eq(videoModuleVersions.moduleVersionId, videoVersion.id));
      await db
        .delete(moduleVersions)
        .where(inArray(moduleVersions.id, [scormVersion.id, videoVersion.id]));
      await db.delete(modules).where(inArray(modules.id, [scormModule.id, videoModule.id]));
      await db.delete(courses).where(eq(courses.id, course.id));
    }
  });

  it("reaches completed when both a SCORM and a video module are done", async () => {
    const [course] = await db
      .insert(courses)
      .values({
        code: `${courseCode}-video-done`,
        title: "Course Progress Video Done Test",
        status: "published",
      })
      .returning();
    const [scormModule] = await db
      .insert(modules)
      .values({ courseId: course.id, moduleType: "scorm", title: "Scorm Module" })
      .returning();
    const [videoModule] = await db
      .insert(modules)
      .values({ courseId: course.id, moduleType: "video", title: "Video Module" })
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
    await markVideoReady(videoVersion.id);
    const [scormAttempt] = await db
      .insert(moduleAttempts)
      .values({ moduleVersionId: scormVersion.id, userId, attemptNumber: 1 })
      .returning();
    await db
      .insert(scormAttemptState)
      .values({ moduleAttemptId: scormAttempt.id, lessonStatus: "completed", rawCmi: {} });
    const [videoAttempt] = await db
      .insert(moduleAttempts)
      .values({ moduleVersionId: videoVersion.id, userId, attemptNumber: 1 })
      .returning();
    await db
      .insert(videoAttemptState)
      .values({ moduleAttemptId: videoAttempt.id, status: "completed" });

    try {
      const result = await computeLiveCourseProgress(course.id, userId);

      expect(result).toEqual({ status: "completed", progress: 100 });
    } finally {
      await db.delete(videoAttemptState).where(eq(videoAttemptState.moduleAttemptId, videoAttempt.id));
      await db.delete(scormAttemptState).where(eq(scormAttemptState.moduleAttemptId, scormAttempt.id));
      await db
        .delete(moduleAttempts)
        .where(inArray(moduleAttempts.id, [scormAttempt.id, videoAttempt.id]));
      await db
        .update(modules)
        .set({ currentVersionId: null })
        .where(inArray(modules.id, [scormModule.id, videoModule.id]));
      await db
        .delete(videoModuleVersions)
        .where(eq(videoModuleVersions.moduleVersionId, videoVersion.id));
      await db
        .delete(moduleVersions)
        .where(inArray(moduleVersions.id, [scormVersion.id, videoVersion.id]));
      await db.delete(modules).where(inArray(modules.id, [scormModule.id, videoModule.id]));
      await db.delete(courses).where(eq(courses.id, course.id));
    }
  });

  it("returns not-started for a non-UUID course id instead of hitting Postgres", async () => {
    expect(await computeLiveCourseProgress("not-a-uuid", userId)).toEqual({
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
      const result = await computeLiveCourseProgress(course.id, userId);

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

describe("getCourseProgressForLearner (persisted)", () => {
  it("returns not-started with no enrollment (falls back to not-started rather than throwing)", async () => {
    const [course] = await db
      .insert(courses)
      .values({ code: `PERSISTED-${randomUUID()}`, title: "Persisted Progress Test" })
      .returning();
    try {
      const result = await getCourseProgressForLearner(course.id, randomUUID());
      expect(result).toEqual({ status: "not-started", progress: 0 });
    } finally {
      await db.delete(courses).where(eq(courses.id, course.id));
    }
  });

  it("reads status/progress directly from the enrollment and module_progress rows", async () => {
    const email = `persisted-${randomUUID()}@example.com`;
    const [user] = await db.insert(users).values({ email, displayName: "Persisted Test" }).returning();
    const userId = user.id;
    const [course] = await db
      .insert(courses)
      .values({ code: `PERSISTED-READ-${randomUUID()}`, title: "Persisted Read Test" })
      .returning();
    const [mod] = await db.insert(modules).values({ courseId: course.id, moduleType: "scorm", title: "M1" }).returning();
    const [version] = await db.insert(moduleVersions).values({ moduleId: mod.id, versionNumber: 1, status: "published" }).returning();
    await db.update(modules).set({ currentVersionId: version.id }).where(eq(modules.id, mod.id));
    const [enrollment] = await db
      .insert(enrollments)
      .values({ userId: user.id, courseId: course.id, status: "in_progress" })
      .returning();
    await db.insert(moduleProgress).values({ enrollmentId: enrollment.id, moduleId: mod.id, status: "completed" });

    try {
      const result = await getCourseProgressForLearner(course.id, userId);
      expect(result).toEqual({ status: "in-progress", progress: 100 });
    } finally {
      await db.delete(moduleProgress).where(eq(moduleProgress.enrollmentId, enrollment.id));
      await db.delete(enrollments).where(eq(enrollments.id, enrollment.id));
      await db.update(modules).set({ currentVersionId: null }).where(eq(modules.id, mod.id));
      await db.delete(moduleVersions).where(eq(moduleVersions.id, version.id));
      await db.delete(modules).where(eq(modules.id, mod.id));
      await db.delete(courses).where(eq(courses.id, course.id));
      await db.delete(users).where(eq(users.id, user.id));
    }
  });

  it("does not exceed 100% when a completed module's version is later unpublished, by intersecting module_progress against the currently-tracked module set (I2)", async () => {
    const email = `persisted-unpublished-${randomUUID()}@example.com`;
    const [user] = await db.insert(users).values({ email, displayName: "Persisted Unpublished Test" }).returning();
    const [course] = await db
      .insert(courses)
      .values({ code: `PERSISTED-UNPUB-${randomUUID()}`, title: "Persisted Unpublished Test" })
      .returning();
    const [modA] = await db.insert(modules).values({ courseId: course.id, moduleType: "scorm", title: "M1" }).returning();
    const [modB] = await db.insert(modules).values({ courseId: course.id, moduleType: "scorm", title: "M2" }).returning();
    const [versionA] = await db.insert(moduleVersions).values({ moduleId: modA.id, versionNumber: 1, status: "published" }).returning();
    const [versionB] = await db.insert(moduleVersions).values({ moduleId: modB.id, versionNumber: 1, status: "published" }).returning();
    await db.update(modules).set({ currentVersionId: versionA.id }).where(eq(modules.id, modA.id));
    await db.update(modules).set({ currentVersionId: versionB.id }).where(eq(modules.id, modB.id));
    const [enrollment] = await db
      .insert(enrollments)
      .values({ userId: user.id, courseId: course.id, status: "in_progress" })
      .returning();
    // Both modules were completed while tracked...
    await db.insert(moduleProgress).values({ enrollmentId: enrollment.id, moduleId: modA.id, status: "completed" });
    await db.insert(moduleProgress).values({ enrollmentId: enrollment.id, moduleId: modB.id, status: "completed" });
    // ...but modB was since removed/unpublished (currentVersionId cleared),
    // so only modA is in the currently-tracked set. Before the I2 fix,
    // completedCount counted both stale rows against a denominator of 1,
    // producing 200%.
    await db.update(modules).set({ currentVersionId: null }).where(eq(modules.id, modB.id));

    try {
      const result = await getCourseProgressForLearner(course.id, user.id);
      expect(result).toEqual({ status: "in-progress", progress: 100 });
    } finally {
      await db.delete(moduleProgress).where(eq(moduleProgress.enrollmentId, enrollment.id));
      await db.delete(enrollments).where(eq(enrollments.id, enrollment.id));
      await db.update(modules).set({ currentVersionId: null }).where(inArray(modules.id, [modA.id, modB.id]));
      await db.delete(moduleVersions).where(inArray(moduleVersions.id, [versionA.id, versionB.id]));
      await db.delete(modules).where(inArray(modules.id, [modA.id, modB.id]));
      await db.delete(courses).where(eq(courses.id, course.id));
      await db.delete(users).where(eq(users.id, user.id));
    }
  });

  it("renders a completed enrollment as completed/100% even with zero module_progress rows (enrollment.status is checked before the zero-progress short-circuit)", async () => {
    const email = `persisted-completed-noprogress-${randomUUID()}@example.com`;
    const [user] = await db.insert(users).values({ email, displayName: "Persisted Completed No Progress Test" }).returning();
    const [course] = await db
      .insert(courses)
      .values({ code: `PERSISTED-COMPLETED-${randomUUID()}`, title: "Persisted Completed No Progress Test" })
      .returning();
    const [mod] = await db.insert(modules).values({ courseId: course.id, moduleType: "scorm", title: "M1" }).returning();
    const [version] = await db.insert(moduleVersions).values({ moduleId: mod.id, versionNumber: 1, status: "published" }).returning();
    await db.update(modules).set({ currentVersionId: version.id }).where(eq(modules.id, mod.id));
    // enrollment marked completed (e.g. by a backfill), but with no
    // module_progress rows at all - the fragile ordering this fix addresses.
    const [enrollment] = await db
      .insert(enrollments)
      .values({ userId: user.id, courseId: course.id, status: "completed" })
      .returning();

    try {
      const result = await getCourseProgressForLearner(course.id, user.id);
      expect(result).toEqual({ status: "completed", progress: 100 });
    } finally {
      await db.delete(enrollments).where(eq(enrollments.id, enrollment.id));
      await db.update(modules).set({ currentVersionId: null }).where(eq(modules.id, mod.id));
      await db.delete(moduleVersions).where(eq(moduleVersions.id, version.id));
      await db.delete(modules).where(eq(modules.id, mod.id));
      await db.delete(courses).where(eq(courses.id, course.id));
      await db.delete(users).where(eq(users.id, user.id));
    }
  });
});
