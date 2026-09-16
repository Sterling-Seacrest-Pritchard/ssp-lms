import { describe, it, expect, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { moduleAttempts, videoAttemptState, modules, moduleVersions, courses, videoModuleVersions, users } from "@/lib/db/schema";
import { getLatestVideoStatus } from "./completion-status";

describe("getLatestVideoStatus", () => {
  let attemptId: string | undefined;
  let versionId: string | undefined;
  let moduleId: string | undefined;
  let courseId: string | undefined;
  let userId: string | undefined;

  afterEach(async () => {
    if (attemptId) await db.delete(videoAttemptState).where(eq(videoAttemptState.moduleAttemptId, attemptId));
    if (attemptId) await db.delete(moduleAttempts).where(eq(moduleAttempts.id, attemptId));
    if (versionId) await db.delete(videoModuleVersions).where(eq(videoModuleVersions.moduleVersionId, versionId));
    if (moduleId) {
      await db.update(modules).set({ currentVersionId: null }).where(eq(modules.id, moduleId));
      if (versionId) await db.delete(moduleVersions).where(eq(moduleVersions.id, versionId));
      await db.delete(modules).where(eq(modules.id, moduleId));
    }
    if (courseId) await db.delete(courses).where(eq(courses.id, courseId));
    if (userId) await db.delete(users).where(eq(users.id, userId));
    attemptId = versionId = moduleId = courseId = userId = undefined;
  });

  it("returns the latest status for a completed attempt", async () => {
    const [testUser] = await db
      .insert(users)
      .values({ email: `video-status-test-${randomUUID()}@example.com`, displayName: "Video Status Test User" })
      .returning();
    userId = testUser.id;
    const [course] = await db.insert(courses).values({ code: `VIDSTATUS2-${randomUUID()}`, title: "x" }).returning();
    courseId = course.id;
    const [mod] = await db.insert(modules).values({ courseId: course.id, moduleType: "video", title: "x" }).returning();
    moduleId = mod.id;
    const [version] = await db.insert(moduleVersions).values({ moduleId: mod.id, versionNumber: 1, status: "published", publishedAt: new Date() }).returning();
    versionId = version.id;
    const [attempt] = await db.insert(moduleAttempts).values({ moduleVersionId: version.id, userId }).returning();
    attemptId = attempt.id;
    await db.insert(videoAttemptState).values({ moduleAttemptId: attempt.id, status: "completed", furthestWatchedSeconds: 60, lastPositionSeconds: 60 });

    const status = await getLatestVideoStatus(version.id, userId);
    expect(status).toBe("completed");
  });

  it("returns null when there is no attempt", async () => {
    const status = await getLatestVideoStatus("00000000-0000-0000-0000-000000000000", randomUUID());
    expect(status).toBeNull();
  });
});
