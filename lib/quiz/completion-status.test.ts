import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { getLatestQuizStatus } from "./completion-status";
import { db } from "@/lib/db/client";
import { courses, modules, moduleVersions, moduleAttempts, users } from "@/lib/db/schema";

describe("getLatestQuizStatus", () => {
  it("returns the most recent attempt's status", async () => {
    const [user] = await db
      .insert(users)
      .values({ email: `quiz-completion-${randomUUID()}@example.com`, displayName: "Quiz Completion Test" })
      .returning();
    const [course] = await db
      .insert(courses)
      .values({ code: `QUIZ-COMPLETION-${randomUUID()}`, title: "x" })
      .returning();
    const [mod] = await db.insert(modules).values({ courseId: course.id, moduleType: "quiz", title: "x" }).returning();
    const [version] = await db
      .insert(moduleVersions)
      .values({ moduleId: mod.id, versionNumber: 1, status: "published" })
      .returning();
    const [attempt1] = await db
      .insert(moduleAttempts)
      .values({ moduleVersionId: version.id, userId: user.id, attemptNumber: 1, status: "failed" })
      .returning();

    try {
      expect(await getLatestQuizStatus(version.id, user.id)).toBe("failed");

      const [attempt2] = await db
        .insert(moduleAttempts)
        .values({ moduleVersionId: version.id, userId: user.id, attemptNumber: 2, status: "completed" })
        .returning();
      expect(await getLatestQuizStatus(version.id, user.id)).toBe("completed");

      await db.delete(moduleAttempts).where(eq(moduleAttempts.id, attempt2.id));
    } finally {
      await db.delete(moduleAttempts).where(eq(moduleAttempts.id, attempt1.id));
      await db.delete(moduleVersions).where(eq(moduleVersions.id, version.id));
      await db.delete(modules).where(eq(modules.id, mod.id));
      await db.delete(courses).where(eq(courses.id, course.id));
      await db.delete(users).where(eq(users.id, user.id));
    }
  });

  it("returns null when there is no attempt", async () => {
    expect(await getLatestQuizStatus("00000000-0000-0000-0000-000000000000", "00000000-0000-0000-0000-000000000000")).toBeNull();
  });
});
