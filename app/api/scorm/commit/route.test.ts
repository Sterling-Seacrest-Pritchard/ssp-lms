import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { POST } from "./route";
import { db } from "@/lib/db/client";
import { courses, modules, moduleVersions, moduleAttempts, scormAttemptState } from "@/lib/db/schema";

describe("POST /api/scorm/commit", () => {
  const courseCode = `COMMIT-TEST-${randomUUID()}`;
  let attemptId: string;

  async function seed() {
    const [course] = await db.insert(courses).values({ code: courseCode, title: "t" }).returning();
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
      .values({ moduleVersionId: version.id, userId: "user-1" })
      .returning();
    attemptId = attempt.id;
  }

  afterAll(async () => {
    // Clean up in FK dependency order:
    // scormAttemptState -> moduleAttempts -> moduleVersions -> modules -> courses.
    const [course] = await db.select().from(courses).where(eq(courses.code, courseCode));
    if (course) {
      const courseModules = await db.select().from(modules).where(eq(modules.courseId, course.id));
      for (const courseModule of courseModules) {
        const versions = await db
          .select()
          .from(moduleVersions)
          .where(eq(moduleVersions.moduleId, courseModule.id));
        for (const version of versions) {
          const attempts = await db
            .select()
            .from(moduleAttempts)
            .where(eq(moduleAttempts.moduleVersionId, version.id));
          for (const attempt of attempts) {
            await db
              .delete(scormAttemptState)
              .where(eq(scormAttemptState.moduleAttemptId, attempt.id));
          }
          await db.delete(moduleAttempts).where(eq(moduleAttempts.moduleVersionId, version.id));
        }
        await db.delete(moduleVersions).where(eq(moduleVersions.moduleId, courseModule.id));
      }
      await db.delete(modules).where(eq(modules.courseId, course.id));
      await db.delete(courses).where(eq(courses.id, course.id));
    }
  });

  it("inserts scorm_attempt_state on first commit, updates it on second", async () => {
    await seed();

    const firstCmi = { "cmi.core.lesson_status": "incomplete", "cmi.suspend_data": "page=1" };
    const firstResponse = await POST(
      new NextRequest("http://localhost/api/scorm/commit", {
        method: "POST",
        body: JSON.stringify({ attemptId, cmi: firstCmi }),
      })
    );
    expect(firstResponse.status).toBe(200);

    const secondCmi = { "cmi.core.lesson_status": "completed", "cmi.suspend_data": "page=2" };
    await POST(
      new NextRequest("http://localhost/api/scorm/commit", {
        method: "POST",
        body: JSON.stringify({ attemptId, cmi: secondCmi }),
      })
    );

    const [state] = await db
      .select()
      .from(scormAttemptState)
      .where(eq(scormAttemptState.moduleAttemptId, attemptId));

    expect(state.lessonStatus).toBe("completed");
    expect(state.rawCmi).toEqual(secondCmi);
  });

  it("extracts lessonStatus/lessonLocation from SCORM 2004's flattened keys", async () => {
    // Reuses the attempt seeded by the previous test (tests in this file run
    // sequentially) rather than calling seed() again - seed() always inserts
    // the same fixed courseCode, so a second call would violate the unique
    // constraint on courses.code.
    const cmi2004 = {
      "cmi.completion_status": "completed",
      "cmi.success_status": "passed",
      "cmi.location": "page-3",
      "cmi.suspend_data": "state=abc",
    };
    const response = await POST(
      new NextRequest("http://localhost/api/scorm/commit", {
        method: "POST",
        body: JSON.stringify({ attemptId, cmi: cmi2004 }),
      })
    );
    expect(response.status).toBe(200);

    const [state] = await db
      .select()
      .from(scormAttemptState)
      .where(eq(scormAttemptState.moduleAttemptId, attemptId));

    expect(state.lessonStatus).toBe("completed");
    expect(state.lessonLocation).toBe("page-3");
    expect(state.suspendData).toBe("state=abc");
    expect(state.rawCmi).toEqual(cmi2004);
  });
});
