import { describe, it, expect, vi, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { POST } from "./route";
import { db } from "@/lib/db/client";
import { courses, modules, moduleVersions, moduleAttempts, scormAttemptState } from "@/lib/db/schema";

const SESSION_USER = "commit-session-user@example.com";

vi.mock("@/auth", () => ({
  auth: vi.fn().mockResolvedValue({ user: { email: "commit-session-user@example.com" } }),
}));

describe("POST /api/scorm/commit", () => {
  let attemptId: string | undefined;
  let courseId: string | undefined;

  afterEach(async () => {
    if (attemptId) {
      await db.delete(scormAttemptState).where(eq(scormAttemptState.moduleAttemptId, attemptId));
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
    const [course] = await db.insert(courses).values({ code: `COMMIT-${Date.now()}`, title: "t" }).returning();
    courseId = course.id;
    const [courseModule] = await db
      .insert(modules)
      .values({ courseId: course.id, moduleType: "scorm", title: "t" })
      .returning();
    const [version] = await db
      .insert(moduleVersions)
      .values({ moduleId: courseModule.id, versionNumber: 1, status: "published" })
      .returning();
    const [attempt] = await db
      .insert(moduleAttempts)
      .values({ moduleVersionId: version.id, userId })
      .returning();
    attemptId = attempt.id;
    return attempt.id;
  }

  function commitRequest(id: string, cmi: Record<string, unknown>) {
    return new NextRequest("http://localhost/api/scorm/commit", {
      method: "POST",
      body: JSON.stringify({ attemptId: id, cmi }),
    });
  }

  it("inserts scorm_attempt_state on first commit, updates it on second", async () => {
    const id = await seedAttempt();

    const firstCmi = { "cmi.core.lesson_status": "incomplete", "cmi.suspend_data": "page=1" };
    const firstResponse = await POST(commitRequest(id, firstCmi));
    expect(firstResponse.status).toBe(200);

    const secondCmi = { "cmi.core.lesson_status": "completed", "cmi.suspend_data": "page=2" };
    await POST(commitRequest(id, secondCmi));

    const [state] = await db.select().from(scormAttemptState).where(eq(scormAttemptState.moduleAttemptId, id));

    expect(state.lessonStatus).toBe("completed");
    expect(state.rawCmi).toEqual(secondCmi);
  });

  it("extracts lessonStatus/lessonLocation from SCORM 2004's flattened keys", async () => {
    const id = await seedAttempt();
    const cmi2004 = {
      "cmi.completion_status": "completed",
      "cmi.success_status": "passed",
      "cmi.location": "page-3",
      "cmi.suspend_data": "state=abc",
    };
    const response = await POST(commitRequest(id, cmi2004));
    expect(response.status).toBe(200);

    const [state] = await db.select().from(scormAttemptState).where(eq(scormAttemptState.moduleAttemptId, id));

    expect(state.lessonStatus).toBe("completed");
    expect(state.lessonLocation).toBe("page-3");
    expect(state.suspendData).toBe("state=abc");
    expect(state.rawCmi).toEqual(cmi2004);
  });

  it("404s on an attempt owned by a different user, without writing to it", async () => {
    const id = await seedAttempt("someone-else@example.com");

    const response = await POST(commitRequest(id, { "cmi.core.lesson_status": "completed" }));

    expect(response.status).toBe(404);
    expect(
      await db.select().from(scormAttemptState).where(eq(scormAttemptState.moduleAttemptId, id))
    ).toHaveLength(0);
  });

  it("404s on a well-formed attemptId that does not exist, rather than 500ing on the FK", async () => {
    const response = await POST(
      commitRequest("00000000-0000-0000-0000-000000000000", { "cmi.core.lesson_status": "completed" })
    );
    expect(response.status).toBe(404);
  });

  it("rejects when there is no session", async () => {
    const { auth } = await import("@/auth");
    // `auth` is an overloaded NextAuth export (session-fetch vs. middleware-wrap
    // forms); `vi.mocked` can pick the wrong overload for `mockResolvedValueOnce`'s
    // generic. `null as never` keeps the runtime value identical while sidestepping
    // that overload-resolution mismatch.
    vi.mocked(auth).mockResolvedValueOnce(null as never);
    const response = await POST(
      commitRequest("00000000-0000-0000-0000-000000000000", { "cmi.core.lesson_status": "completed" })
    );
    expect(response.status).toBe(401);
  });
});
