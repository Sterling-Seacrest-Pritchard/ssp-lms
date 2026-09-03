import { describe, it, expect, vi, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { POST } from "./route";
import { db } from "@/lib/db/client";
import { moduleAttempts, videoAttemptState, courses, modules, moduleVersions } from "@/lib/db/schema";

const SESSION_USER = "commit-session-user@example.com";

vi.mock("@/auth", () => ({
  auth: vi.fn().mockResolvedValue({ user: { email: "commit-session-user@example.com" } }),
}));

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

  async function seedAttempt(userId: string = SESSION_USER) {
    const [course] = await db.insert(courses).values({ code: `COMMIT-${Date.now()}`, title: "x" }).returning();
    courseId = course.id;
    const [mod] = await db.insert(modules).values({ courseId: course.id, moduleType: "video", title: "x" }).returning();
    const [version] = await db.insert(moduleVersions).values({ moduleId: mod.id, versionNumber: 1, status: "published", publishedAt: new Date() }).returning();
    const [attempt] = await db.insert(moduleAttempts).values({ moduleVersionId: version.id, userId }).returning();
    attemptId = attempt.id;
    return attempt.id;
  }

  function commitRequest(id: string) {
    return new NextRequest("http://localhost/api/video/commit", {
      method: "POST",
      body: JSON.stringify({
        attemptId: id,
        furthestWatchedSeconds: 5,
        lastPositionSeconds: 5,
        status: "in_progress",
      }),
    });
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

  it("404s on an attempt owned by a different user, without writing to it", async () => {
    const id = await seedAttempt("someone-else@example.com");

    const response = await POST(commitRequest(id));

    expect(response.status).toBe(404);
    expect(
      await db.select().from(videoAttemptState).where(eq(videoAttemptState.moduleAttemptId, id))
    ).toHaveLength(0);
  });

  it("404s on a well-formed attemptId that does not exist, rather than 500ing on the FK", async () => {
    const response = await POST(commitRequest("00000000-0000-0000-0000-000000000000"));
    expect(response.status).toBe(404);
  });

  it("rejects when there is no session", async () => {
    const { auth } = await import("@/auth");
    // `auth` is an overloaded NextAuth export (session-fetch vs. middleware-wrap
    // forms); `vi.mocked` can pick the wrong overload for `mockResolvedValueOnce`'s
    // generic. `null as never` keeps the runtime value identical while sidestepping
    // that overload-resolution mismatch.
    vi.mocked(auth).mockResolvedValueOnce(null as never);
    const response = await POST(commitRequest("00000000-0000-0000-0000-000000000000"));
    expect(response.status).toBe(401);
  });
});
