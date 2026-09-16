import { describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { recordModuleCompletion } from "./module-progress";
import { db } from "./client";
import {
  courses,
  enrollments,
  moduleAttempts,
  moduleProgress,
  modules,
  moduleVersions,
  scormAttemptState,
  users,
} from "./schema";

async function seedScormModuleWithAttempt(lessonStatus: string) {
  const [user] = await db
    .insert(users)
    .values({ email: `progress-${randomUUID()}@example.com`, displayName: "Progress Test" })
    .returning();
  const [course] = await db
    .insert(courses)
    .values({ code: `MODPROG-${randomUUID()}`, title: "Module Progress Course" })
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
  const [enrollment] = await db.insert(enrollments).values({ userId: user.id, courseId: course.id }).returning();
  const [attempt] = await db
    .insert(moduleAttempts)
    .values({ moduleVersionId: version.id, userId: user.email, attemptNumber: 1 })
    .returning();
  await db.insert(scormAttemptState).values({ moduleAttemptId: attempt.id, lessonStatus, rawCmi: {} });
  return { user, course, mod, version, enrollment, attempt };
}

describe("recordModuleCompletion", () => {
  it("upserts module_progress as completed and rolls the enrollment up to completed for a single-module course", async () => {
    const { user, course, mod, version, enrollment, attempt } = await seedScormModuleWithAttempt("completed");
    try {
      await recordModuleCompletion({ userEmail: user.email, moduleVersionId: version.id });

      const [progress] = await db
        .select()
        .from(moduleProgress)
        .where(and(eq(moduleProgress.enrollmentId, enrollment.id), eq(moduleProgress.moduleId, mod.id)));
      expect(progress.status).toBe("completed");

      const [updatedEnrollment] = await db.select().from(enrollments).where(eq(enrollments.id, enrollment.id));
      expect(updatedEnrollment.status).toBe("completed");
      expect(updatedEnrollment.completedAt).not.toBeNull();
    } finally {
      await db.delete(moduleProgress).where(eq(moduleProgress.enrollmentId, enrollment.id));
      await db.delete(scormAttemptState).where(eq(scormAttemptState.moduleAttemptId, attempt.id));
      await db.delete(moduleAttempts).where(eq(moduleAttempts.id, attempt.id));
      await db.delete(enrollments).where(eq(enrollments.id, enrollment.id));
      await db.update(modules).set({ currentVersionId: null }).where(eq(modules.id, mod.id));
      await db.delete(moduleVersions).where(eq(moduleVersions.id, version.id));
      await db.delete(modules).where(eq(modules.id, mod.id));
      await db.delete(courses).where(eq(courses.id, course.id));
      await db.delete(users).where(eq(users.id, user.id));
    }
  });

  it("marks the enrollment in_progress (not completed) when the module is only incomplete", async () => {
    const { user, course, mod, version, enrollment, attempt } = await seedScormModuleWithAttempt("incomplete");
    try {
      await recordModuleCompletion({ userEmail: user.email, moduleVersionId: version.id });

      const [updatedEnrollment] = await db.select().from(enrollments).where(eq(enrollments.id, enrollment.id));
      expect(updatedEnrollment.status).toBe("in_progress");
    } finally {
      await db.delete(moduleProgress).where(eq(moduleProgress.enrollmentId, enrollment.id));
      await db.delete(scormAttemptState).where(eq(scormAttemptState.moduleAttemptId, attempt.id));
      await db.delete(moduleAttempts).where(eq(moduleAttempts.id, attempt.id));
      await db.delete(enrollments).where(eq(enrollments.id, enrollment.id));
      await db.update(modules).set({ currentVersionId: null }).where(eq(modules.id, mod.id));
      await db.delete(moduleVersions).where(eq(moduleVersions.id, version.id));
      await db.delete(modules).where(eq(modules.id, mod.id));
      await db.delete(courses).where(eq(courses.id, course.id));
      await db.delete(users).where(eq(users.id, user.id));
    }
  });

  it("is a no-op (does not throw) when the committing user has no enrollment for this course - e.g. an admin using the SCORM test tool", async () => {
    const [user] = await db
      .insert(users)
      .values({ email: `no-enrollment-${randomUUID()}@example.com`, displayName: "No Enrollment Test" })
      .returning();
    const [course] = await db.insert(courses).values({ code: `NOENROLL-${randomUUID()}`, title: "No Enroll Course" }).returning();
    const [mod] = await db.insert(modules).values({ courseId: course.id, moduleType: "scorm", title: "Module 1" }).returning();
    const [version] = await db.insert(moduleVersions).values({ moduleId: mod.id, versionNumber: 1, status: "published" }).returning();
    await db.update(modules).set({ currentVersionId: version.id }).where(eq(modules.id, mod.id));
    const [attempt] = await db.insert(moduleAttempts).values({ moduleVersionId: version.id, userId: user.email, attemptNumber: 1 }).returning();
    await db.insert(scormAttemptState).values({ moduleAttemptId: attempt.id, lessonStatus: "completed", rawCmi: {} });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await expect(recordModuleCompletion({ userEmail: user.email, moduleVersionId: version.id })).resolves.not.toThrow();
      const progressRows = await db.select().from(moduleProgress);
      expect(progressRows.find((p) => p.moduleId === mod.id)).toBeUndefined();
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("recordModuleCompletion: no enrollment"));
    } finally {
      logSpy.mockRestore();
      await db.delete(scormAttemptState).where(eq(scormAttemptState.moduleAttemptId, attempt.id));
      await db.delete(moduleAttempts).where(eq(moduleAttempts.id, attempt.id));
      await db.update(modules).set({ currentVersionId: null }).where(eq(modules.id, mod.id));
      await db.delete(moduleVersions).where(eq(moduleVersions.id, version.id));
      await db.delete(modules).where(eq(modules.id, mod.id));
      await db.delete(courses).where(eq(courses.id, course.id));
      await db.delete(users).where(eq(users.id, user.id));
    }
  });
});
