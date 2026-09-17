import { describe, it, expect, vi, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { POST } from "./route";
import { db } from "@/lib/db/client";
import { courses, modules, moduleVersions, moduleAttempts, enrollments, users } from "@/lib/db/schema";

const { SESSION_USER } = vi.hoisted(() => ({
  SESSION_USER: `quiz-attempts-session-user-${require("node:crypto").randomUUID()}@example.com`,
}));
vi.mock("@/auth", () => ({
  auth: vi.fn().mockResolvedValue({ user: { email: SESSION_USER } }),
}));

describe("POST /api/quiz/attempts", () => {
  let moduleVersionId: string | undefined;

  afterEach(async () => {
    if (moduleVersionId) {
      await db.delete(moduleAttempts).where(eq(moduleAttempts.moduleVersionId, moduleVersionId));
    }
    moduleVersionId = undefined;
  });

  it("creates an attempt numbered per-user for the given module version", async () => {
    const [user] = await db.insert(users).values({ email: SESSION_USER, displayName: "Quiz Attempts Test" }).returning();
    const [course] = await db.insert(courses).values({ code: `QUIZ-ATTEMPTS-${randomUUID()}`, title: "x" }).returning();
    const [mod] = await db.insert(modules).values({ courseId: course.id, moduleType: "quiz", title: "x" }).returning();
    const [version] = await db.insert(moduleVersions).values({ moduleId: mod.id, versionNumber: 1, status: "published" }).returning();
    moduleVersionId = version.id;
    await db.insert(enrollments).values({ userId: user.id, courseId: course.id });

    try {
      const request = new NextRequest("http://localhost/api/quiz/attempts", {
        method: "POST",
        body: JSON.stringify({ moduleVersionId: version.id }),
      });
      const response = await POST(request);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.attemptId).toBeDefined();

      const [attempt] = await db.select().from(moduleAttempts).where(eq(moduleAttempts.id, body.attemptId));
      expect(attempt.userId).toBe(user.id);
      expect(attempt.attemptNumber).toBe(1);
    } finally {
      await db.delete(moduleAttempts).where(eq(moduleAttempts.moduleVersionId, version.id));
      await db.delete(enrollments).where(eq(enrollments.courseId, course.id));
      await db.delete(users).where(eq(users.id, user.id));
      await db.delete(moduleVersions).where(eq(moduleVersions.id, version.id));
      await db.delete(modules).where(eq(modules.id, mod.id));
      await db.delete(courses).where(eq(courses.id, course.id));
    }
  });

  it("404s when the session user is not enrolled in the module's course", async () => {
    const [user] = await db.insert(users).values({ email: SESSION_USER, displayName: "Quiz Attempts Test" }).returning();
    const [course] = await db.insert(courses).values({ code: `QUIZ-ATTEMPTS-${randomUUID()}`, title: "x" }).returning();
    const [mod] = await db.insert(modules).values({ courseId: course.id, moduleType: "quiz", title: "x" }).returning();
    const [version] = await db.insert(moduleVersions).values({ moduleId: mod.id, versionNumber: 1, status: "published" }).returning();
    moduleVersionId = version.id;

    try {
      const request = new NextRequest("http://localhost/api/quiz/attempts", {
        method: "POST",
        body: JSON.stringify({ moduleVersionId: version.id }),
      });
      const response = await POST(request);
      expect(response.status).toBe(404);

      const rows = await db.select().from(moduleAttempts).where(eq(moduleAttempts.moduleVersionId, version.id));
      expect(rows).toHaveLength(0);
    } finally {
      await db.delete(users).where(eq(users.id, user.id));
      await db.delete(moduleVersions).where(eq(moduleVersions.id, version.id));
      await db.delete(modules).where(eq(modules.id, mod.id));
      await db.delete(courses).where(eq(courses.id, course.id));
    }
  });
});
