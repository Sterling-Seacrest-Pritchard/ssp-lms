import { describe, it, expect, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { moduleAttempts, videoAttemptState, modules, moduleVersions, courses, videoModuleVersions } from "@/lib/db/schema";
import { getLatestVideoStatus } from "./completion-status";

describe("getLatestVideoStatus", () => {
  let attemptId: string | undefined;
  let versionId: string | undefined;
  let moduleId: string | undefined;
  let courseId: string | undefined;

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
    attemptId = versionId = moduleId = courseId = undefined;
  });

  it("returns the latest status for a completed attempt", async () => {
    const [course] = await db.insert(courses).values({ code: `VIDSTATUS2-${Date.now()}`, title: "x" }).returning();
    courseId = course.id;
    const [mod] = await db.insert(modules).values({ courseId: course.id, moduleType: "video", title: "x" }).returning();
    moduleId = mod.id;
    const [version] = await db.insert(moduleVersions).values({ moduleId: mod.id, versionNumber: 1, status: "published", publishedAt: new Date() }).returning();
    versionId = version.id;
    const [attempt] = await db.insert(moduleAttempts).values({ moduleVersionId: version.id, userId: "test@example.com" }).returning();
    attemptId = attempt.id;
    await db.insert(videoAttemptState).values({ moduleAttemptId: attempt.id, status: "completed", furthestWatchedSeconds: 60, lastPositionSeconds: 60 });

    const status = await getLatestVideoStatus(version.id, "test@example.com");
    expect(status).toBe("completed");
  });

  it("returns null when there is no attempt", async () => {
    const status = await getLatestVideoStatus("00000000-0000-0000-0000-000000000000", "nobody@example.com");
    expect(status).toBeNull();
  });
});
