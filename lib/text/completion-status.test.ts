import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { getLatestTextStatus } from "./completion-status";
import { db } from "@/lib/db/client";
import { courses, modules, moduleVersions, moduleAttempts, users } from "@/lib/db/schema";

describe("getLatestTextStatus", () => {
  it("returns the most recent attempt's status", async () => {
    const [user] = await db
      .insert(users)
      .values({ email: `text-completion-${randomUUID()}@example.com`, displayName: "Text Completion Test" })
      .returning();
    const [course] = await db
      .insert(courses)
      .values({ code: `TEXT-COMPLETION-${randomUUID()}`, title: "x" })
      .returning();
    const [mod] = await db.insert(modules).values({ courseId: course.id, moduleType: "text", title: "x" }).returning();
    const [version] = await db
      .insert(moduleVersions)
      .values({ moduleId: mod.id, versionNumber: 1, status: "published" })
      .returning();
    const [attempt] = await db
      .insert(moduleAttempts)
      .values({ moduleVersionId: version.id, userId: user.id, attemptNumber: 1, status: "completed" })
      .returning();

    try {
      expect(await getLatestTextStatus(version.id, user.id)).toBe("completed");
    } finally {
      await db.delete(moduleAttempts).where(eq(moduleAttempts.id, attempt.id));
      await db.delete(moduleVersions).where(eq(moduleVersions.id, version.id));
      await db.delete(modules).where(eq(modules.id, mod.id));
      await db.delete(courses).where(eq(courses.id, course.id));
      await db.delete(users).where(eq(users.id, user.id));
    }
  });

  it("returns null when there is no attempt", async () => {
    expect(await getLatestTextStatus("00000000-0000-0000-0000-000000000000", "00000000-0000-0000-0000-000000000000")).toBeNull();
  });
});
