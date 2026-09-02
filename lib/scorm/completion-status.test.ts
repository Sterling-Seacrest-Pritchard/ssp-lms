import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { getLatestLessonStatus } from "./completion-status";
import { db } from "@/lib/db/client";
import { courses, modules, moduleVersions, moduleAttempts, scormAttemptState } from "@/lib/db/schema";

describe("getLatestLessonStatus", () => {
  const courseCode = `COMPLETION-STATUS-TEST-${randomUUID()}`;
  const userId = "completion-status-test@example.com";

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

  it("returns null when no attempts exist for this module/user pair", async () => {
    const result = await getLatestLessonStatus(randomUUID(), userId);
    expect(result).toBeNull();
  });

  it("returns the most recent attempt's lesson status, not an earlier one", async () => {
    const [course] = await db
      .insert(courses)
      .values({ code: courseCode, title: "Completion Status Test Course" })
      .returning();
    const [courseModule] = await db
      .insert(modules)
      .values({ courseId: course.id, moduleType: "scorm", title: "Completion Status Test Module" })
      .returning();
    const [version] = await db
      .insert(moduleVersions)
      .values({ moduleId: courseModule.id, versionNumber: 1, status: "published" })
      .returning();
    const moduleVersionId = version.id;

    const [firstAttempt] = await db
      .insert(moduleAttempts)
      .values({
        moduleVersionId,
        userId,
        attemptNumber: 1,
        startedAt: new Date("2026-01-01T00:00:00Z"),
      })
      .returning();
    await db.insert(scormAttemptState).values({
      moduleAttemptId: firstAttempt.id,
      lessonStatus: "incomplete",
      rawCmi: {},
    });

    const [secondAttempt] = await db
      .insert(moduleAttempts)
      .values({
        moduleVersionId,
        userId,
        attemptNumber: 2,
        startedAt: new Date("2026-01-02T00:00:00Z"),
      })
      .returning();
    await db.insert(scormAttemptState).values({
      moduleAttemptId: secondAttempt.id,
      lessonStatus: "completed",
      rawCmi: {},
    });

    const result = await getLatestLessonStatus(moduleVersionId, userId);
    expect(result).toBe("completed");
  });

  it("returns null when the latest attempt has no committed state yet", async () => {
    const [course] = await db
      .insert(courses)
      .values({ code: `${courseCode}-uncommitted`, title: "Uncommitted Attempt Test" })
      .returning();
    let version: { id: string } | undefined;
    try {
      const [courseModule] = await db
        .insert(modules)
        .values({ courseId: course.id, moduleType: "scorm", title: "Uncommitted Module" })
        .returning();
      [version] = await db
        .insert(moduleVersions)
        .values({ moduleId: courseModule.id, versionNumber: 1, status: "published" })
        .returning();
      await db.insert(moduleAttempts).values({
        moduleVersionId: version.id,
        userId,
        attemptNumber: 1,
      });

      const result = await getLatestLessonStatus(version.id, userId);
      expect(result).toBeNull();
    } finally {
      // Scoped to this test's own moduleVersionId, not the shared userId —
      // deleting by userId here would also match the earlier test's attempts,
      // which still have scorm_attempt_state rows at this point (that test's
      // own cleanup runs later, in afterAll) and would violate its FK.
      if (version) {
        await db.delete(moduleAttempts).where(eq(moduleAttempts.moduleVersionId, version.id));
        await db.delete(moduleVersions).where(eq(moduleVersions.id, version.id));
      }
      await db.delete(modules).where(eq(modules.courseId, course.id));
      await db.delete(courses).where(eq(courses.id, course.id));
    }
  });
});
