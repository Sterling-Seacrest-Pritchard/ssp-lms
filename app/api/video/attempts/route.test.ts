import { describe, it, expect, vi, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { POST } from "./route";
import { db } from "@/lib/db/client";
import { courses, modules, moduleVersions, moduleAttempts } from "@/lib/db/schema";

vi.mock("@/auth", () => ({
  auth: vi.fn().mockResolvedValue({ user: { email: "real-session-user@example.com" } }),
}));

describe("POST /api/video/attempts", () => {
  let courseId: string | undefined;
  let versionId: string | undefined;

  afterEach(async () => {
    if (versionId) await db.delete(moduleAttempts).where(eq(moduleAttempts.moduleVersionId, versionId));
    if (courseId) {
      const mods = await db.select().from(modules).where(eq(modules.courseId, courseId));
      for (const m of mods) {
        await db.update(modules).set({ currentVersionId: null }).where(eq(modules.id, m.id));
        await db.delete(moduleVersions).where(eq(moduleVersions.moduleId, m.id));
      }
      await db.delete(modules).where(eq(modules.courseId, courseId));
      await db.delete(courses).where(eq(courses.id, courseId));
    }
    courseId = versionId = undefined;
  });

  it("creates an attempt using the SESSION user id, ignoring any userId in the body", async () => {
    const [course] = await db.insert(courses).values({ code: `ATTEMPT-${Date.now()}`, title: "x" }).returning();
    courseId = course.id;
    const [mod] = await db.insert(modules).values({ courseId: course.id, moduleType: "video", title: "x" }).returning();
    const [version] = await db.insert(moduleVersions).values({ moduleId: mod.id, versionNumber: 1, status: "published", publishedAt: new Date() }).returning();
    versionId = version.id;

    const request = new NextRequest("http://localhost/api/video/attempts", {
      method: "POST",
      body: JSON.stringify({ moduleVersionId: version.id, userId: "attacker@example.com" }),
    });
    const response = await POST(request);
    expect(response.status).toBe(200);
    const body = await response.json();

    const [attempt] = await db.select().from(moduleAttempts).where(eq(moduleAttempts.id, body.attemptId));
    expect(attempt.userId).toBe("real-session-user@example.com");
  });

  it("rejects when there is no session", async () => {
    const { auth } = await import("@/auth");
    // `auth` is an overloaded NextAuth export (session-fetch vs. middleware-wrap
    // forms); `vi.mocked` can pick the wrong overload for `mockResolvedValueOnce`'s
    // generic. `null as never` keeps the runtime value identical while sidestepping
    // that overload-resolution mismatch (never is assignable to any parameter type).
    vi.mocked(auth).mockResolvedValueOnce(null as never);
    const request = new NextRequest("http://localhost/api/video/attempts", {
      method: "POST",
      body: JSON.stringify({ moduleVersionId: "00000000-0000-0000-0000-000000000000" }),
    });
    const response = await POST(request);
    expect(response.status).toBe(401);
  });
});
