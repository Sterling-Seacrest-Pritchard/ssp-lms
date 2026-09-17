import { describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { POST } from "./route";
import { db } from "@/lib/db/client";
import {
  courses,
  modules,
  moduleVersions,
  moduleAttempts,
  quizModuleVersions,
  quizQuestions,
  quizChoices,
  quizAttemptAnswers,
  users,
} from "@/lib/db/schema";

const { SESSION_USER } = vi.hoisted(() => ({
  SESSION_USER: `quiz-submit-session-user-${require("node:crypto").randomUUID()}@example.com`,
}));
vi.mock("@/auth", () => ({
  auth: vi.fn().mockResolvedValue({ user: { email: SESSION_USER } }),
}));

async function seedQuiz(passingScorePct: number) {
  const [user] = await db.insert(users).values({ email: SESSION_USER, displayName: "Quiz Submit Test" }).returning();
  const [course] = await db.insert(courses).values({ code: `QUIZ-SUBMIT-${randomUUID()}`, title: "x" }).returning();
  const [mod] = await db.insert(modules).values({ courseId: course.id, moduleType: "quiz", title: "x" }).returning();
  const [version] = await db.insert(moduleVersions).values({ moduleId: mod.id, versionNumber: 1, status: "published" }).returning();
  await db.insert(quizModuleVersions).values({ moduleVersionId: version.id, passingScorePct });
  const [question] = await db
    .insert(quizQuestions)
    .values({ quizModuleVersionId: version.id, sortOrder: 0, questionType: "single_choice", prompt: "2+2?", points: 1 })
    .returning();
  const [wrong] = await db.insert(quizChoices).values({ questionId: question.id, sortOrder: 0, choiceText: "3", isCorrect: false }).returning();
  const [right] = await db.insert(quizChoices).values({ questionId: question.id, sortOrder: 1, choiceText: "4", isCorrect: true }).returning();
  const [attempt] = await db.insert(moduleAttempts).values({ moduleVersionId: version.id, userId: user.id, attemptNumber: 1 }).returning();
  return { user, course, mod, version, question, wrong, right, attempt };
}

describe("POST /api/quiz/submit", () => {
  it("scores a fully-correct submission as passed and marks the attempt completed", async () => {
    const { user, course, mod, version, question, right, attempt } = await seedQuiz(70);
    try {
      const request = new NextRequest("http://localhost/api/quiz/submit", {
        method: "POST",
        body: JSON.stringify({
          attemptId: attempt.id,
          answers: [{ questionId: question.id, selectedChoiceIds: [right.id] }],
        }),
      });
      const response = await POST(request);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({ percentage: 100, passed: true });

      const [updatedAttempt] = await db.select().from(moduleAttempts).where(eq(moduleAttempts.id, attempt.id));
      expect(updatedAttempt.status).toBe("completed");

      const [answer] = await db.select().from(quizAttemptAnswers).where(eq(quizAttemptAnswers.moduleAttemptId, attempt.id));
      expect(answer.isCorrect).toBe(true);
    } finally {
      await db.delete(quizAttemptAnswers).where(eq(quizAttemptAnswers.moduleAttemptId, attempt.id));
      await db.delete(moduleAttempts).where(eq(moduleAttempts.id, attempt.id));
      await db.delete(quizChoices).where(eq(quizChoices.questionId, question.id));
      await db.delete(quizQuestions).where(eq(quizQuestions.id, question.id));
      await db.delete(quizModuleVersions).where(eq(quizModuleVersions.moduleVersionId, version.id));
      await db.update(modules).set({ currentVersionId: null }).where(eq(modules.id, mod.id));
      await db.delete(moduleVersions).where(eq(moduleVersions.id, version.id));
      await db.delete(modules).where(eq(modules.id, mod.id));
      await db.delete(courses).where(eq(courses.id, course.id));
      await db.delete(users).where(eq(users.id, user.id));
    }
  });

  it("scores a wrong answer as failed and marks the attempt failed", async () => {
    const { user, course, mod, version, question, wrong, attempt } = await seedQuiz(70);
    try {
      const request = new NextRequest("http://localhost/api/quiz/submit", {
        method: "POST",
        body: JSON.stringify({
          attemptId: attempt.id,
          answers: [{ questionId: question.id, selectedChoiceIds: [wrong.id] }],
        }),
      });
      const response = await POST(request);
      const body = await response.json();
      expect(body).toEqual({ percentage: 0, passed: false });

      const [updatedAttempt] = await db.select().from(moduleAttempts).where(eq(moduleAttempts.id, attempt.id));
      expect(updatedAttempt.status).toBe("failed");
    } finally {
      await db.delete(quizAttemptAnswers).where(eq(quizAttemptAnswers.moduleAttemptId, attempt.id));
      await db.delete(moduleAttempts).where(eq(moduleAttempts.id, attempt.id));
      await db.delete(quizChoices).where(eq(quizChoices.questionId, question.id));
      await db.delete(quizQuestions).where(eq(quizQuestions.id, question.id));
      await db.delete(quizModuleVersions).where(eq(quizModuleVersions.moduleVersionId, version.id));
      await db.update(modules).set({ currentVersionId: null }).where(eq(modules.id, mod.id));
      await db.delete(moduleVersions).where(eq(moduleVersions.id, version.id));
      await db.delete(modules).where(eq(modules.id, mod.id));
      await db.delete(courses).where(eq(courses.id, course.id));
      await db.delete(users).where(eq(users.id, user.id));
    }
  });

  it("rejects re-submitting an already-scored attempt", async () => {
    const { user, course, mod, version, question, right, attempt } = await seedQuiz(70);
    try {
      const body = JSON.stringify({ attemptId: attempt.id, answers: [{ questionId: question.id, selectedChoiceIds: [right.id] }] });
      await POST(new NextRequest("http://localhost/api/quiz/submit", { method: "POST", body }));
      const second = await POST(new NextRequest("http://localhost/api/quiz/submit", { method: "POST", body }));
      expect(second.status).toBe(400);
    } finally {
      await db.delete(quizAttemptAnswers).where(eq(quizAttemptAnswers.moduleAttemptId, attempt.id));
      await db.delete(moduleAttempts).where(eq(moduleAttempts.id, attempt.id));
      await db.delete(quizChoices).where(eq(quizChoices.questionId, question.id));
      await db.delete(quizQuestions).where(eq(quizQuestions.id, question.id));
      await db.delete(quizModuleVersions).where(eq(quizModuleVersions.moduleVersionId, version.id));
      await db.update(modules).set({ currentVersionId: null }).where(eq(modules.id, mod.id));
      await db.delete(moduleVersions).where(eq(moduleVersions.id, version.id));
      await db.delete(modules).where(eq(modules.id, mod.id));
      await db.delete(courses).where(eq(courses.id, course.id));
      await db.delete(users).where(eq(users.id, user.id));
    }
  });

  it("returns 404 for an attempt that doesn't belong to the signed-in user", async () => {
    const { user, course, mod, version, question, right, attempt } = await seedQuiz(70);
    const [otherUser] = await db.insert(users).values({ email: `other-${randomUUID()}@example.com`, displayName: "Other" }).returning();
    const [otherAttempt] = await db.insert(moduleAttempts).values({ moduleVersionId: version.id, userId: otherUser.id, attemptNumber: 1 }).returning();
    try {
      const response = await POST(
        new NextRequest("http://localhost/api/quiz/submit", {
          method: "POST",
          body: JSON.stringify({ attemptId: otherAttempt.id, answers: [{ questionId: question.id, selectedChoiceIds: [right.id] }] }),
        })
      );
      expect(response.status).toBe(404);
    } finally {
      await db.delete(moduleAttempts).where(eq(moduleAttempts.id, otherAttempt.id));
      await db.delete(users).where(eq(users.id, otherUser.id));
      await db.delete(moduleAttempts).where(eq(moduleAttempts.id, attempt.id));
      await db.delete(quizChoices).where(eq(quizChoices.questionId, question.id));
      await db.delete(quizQuestions).where(eq(quizQuestions.id, question.id));
      await db.delete(quizModuleVersions).where(eq(quizModuleVersions.moduleVersionId, version.id));
      await db.update(modules).set({ currentVersionId: null }).where(eq(modules.id, mod.id));
      await db.delete(moduleVersions).where(eq(moduleVersions.id, version.id));
      await db.delete(modules).where(eq(modules.id, mod.id));
      await db.delete(courses).where(eq(courses.id, course.id));
      await db.delete(users).where(eq(users.id, user.id));
    }
  });
});
