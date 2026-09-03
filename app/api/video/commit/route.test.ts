import { describe, it, expect, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { POST } from "./route";
import { db } from "@/lib/db/client";
import { moduleAttempts, videoAttemptState, courses, modules, moduleVersions } from "@/lib/db/schema";

describe("POST /api/video/commit", () => {
  let attemptId: string | undefined;
  let courseId: string | undefined;

  afterEach(async () => {
    if (attemptId) {
      await db.delete(videoAttemptState).where(eq(videoAttemptState.moduleAttemptId, attemptId));
      await db.delete(moduleAttempts).where(eq(moduleAttempts.id, attemptId));
    }
    if (courseId) {
      const mods = await db.select().from(modules).where(eq(modules.courseId, courseId));
      for (const m of mods) {
        await db.update(modules).set({ currentVersionId: null }).where(eq(modules.id, m.id));
        await db.delete(moduleVersions).where(eq(moduleVersions.moduleId, m.id));
      }
      await db.delete(modules).where(eq(modules.courseId, courseId));
      await db.delete(courses).where(eq(courses.id, courseId));
    }
    attemptId = courseId = undefined;
  });

  async function seedAttempt() {
    const [course] = await db.insert(courses).values({ code: `COMMIT-${Date.now()}`, title: "x" }).returning();
    courseId = course.id;
    const [mod] = await db.insert(modules).values({ courseId: course.id, moduleType: "video", title: "x" }).returning();
    const [version] = await db.insert(moduleVersions).values({ moduleId: mod.id, versionNumber: 1, status: "published", publishedAt: new Date() }).returning();
    const [attempt] = await db.insert(moduleAttempts).values({ moduleVersionId: version.id, userId: "x@example.com" }).returning();
    attemptId = attempt.id;
    return attempt.id;
  }

  it("inserts state on first commit, updates on later commits", async () => {
    const id = await seedAttempt();

    let request = new NextRequest("http://localhost/api/video/commit", {
      method: "POST",
      body: JSON.stringify({ attemptId: id, furthestWatchedSeconds: 10, lastPositionSeconds: 10, status: "in_progress" }),
    });
    let response = await POST(request);
    expect(response.status).toBe(200);

    request = new NextRequest("http://localhost/api/video/commit", {
      method: "POST",
      body: JSON.stringify({ attemptId: id, furthestWatchedSeconds: 30, lastPositionSeconds: 30, status: "in_progress" }),
    });
    response = await POST(request);
    expect(response.status).toBe(200);

    const [row] = await db.select().from(videoAttemptState).where(eq(videoAttemptState.moduleAttemptId, id));
    expect(row.furthestWatchedSeconds).toBe(30);
  });

  it("rejects a non-UUID attemptId", async () => {
    const request = new NextRequest("http://localhost/api/video/commit", {
      method: "POST",
      body: JSON.stringify({ attemptId: "not-a-uuid", furthestWatchedSeconds: 1, lastPositionSeconds: 1, status: "in_progress" }),
    });
    const response = await POST(request);
    expect(response.status).toBe(400);
  });
});
