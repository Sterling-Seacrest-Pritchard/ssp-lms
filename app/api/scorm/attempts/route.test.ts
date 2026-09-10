import { describe, it, expect, vi, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { POST } from "./route";
import { db } from "@/lib/db/client";
import { courses, modules, moduleVersions, moduleAttempts } from "@/lib/db/schema";

vi.mock("@/auth", () => ({
  auth: vi.fn().mockResolvedValue({ user: { email: "real-session-user@example.com" } }),
}));

describe("POST /api/scorm/attempts", () => {
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

  async function seed() {
    const [course] = await db.insert(courses).values({ code: `ATTEMPT-${Date.now()}`, title: "t" }).returning();
    courseId = course.id;
    const [courseModule] = await db
      .insert(modules)
      .values({ courseId: course.id, moduleType: "scorm", title: "t" })
      .returning();
    const [version] = await db
      .insert(moduleVersions)
      .values({ moduleId: courseModule.id, versionNumber: 1, status: "published" })
      .returning();
    versionId = version.id;
    return version.id;
  }

  it("creates a first attempt numbered 1, then a second numbered 2, using the SESSION user id", async () => {
    const moduleVersionId = await seed();

    const first = await POST(
      new NextRequest("http://localhost/api/scorm/attempts", {
        method: "POST",
        body: JSON.stringify({ moduleVersionId }),
      })
    );
    const firstBody = await first.json();
    expect(firstBody.attemptNumber).toBe(1);

    const second = await POST(
      new NextRequest("http://localhost/api/scorm/attempts", {
        method: "POST",
        body: JSON.stringify({ moduleVersionId }),
      })
    );
    const secondBody = await second.json();
    expect(secondBody.attemptNumber).toBe(2);

    const rows = await db.select().from(moduleAttempts).where(eq(moduleAttempts.moduleVersionId, moduleVersionId));
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.userId === "real-session-user@example.com")).toBe(true);
  });

  it("ignores any userId supplied in the body, using the session's instead", async () => {
    const moduleVersionId = await seed();

    const response = await POST(
      new NextRequest("http://localhost/api/scorm/attempts", {
        method: "POST",
        body: JSON.stringify({ moduleVersionId, userId: "attacker@example.com" }),
      })
    );
    const body = await response.json();

    const [attempt] = await db.select().from(moduleAttempts).where(eq(moduleAttempts.id, body.attemptId));
    expect(attempt.userId).toBe("real-session-user@example.com");
  });

  it("rejects when there is no session", async () => {
    const { auth } = await import("@/auth");
    vi.mocked(auth).mockResolvedValueOnce(null as never);
    const request = new NextRequest("http://localhost/api/scorm/attempts", {
      method: "POST",
      body: JSON.stringify({ moduleVersionId: "00000000-0000-0000-0000-000000000000" }),
    });
    const response = await POST(request);
    expect(response.status).toBe(401);
  });
});
