import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { GET, POST } from "./route";
import { createQuizModule } from "@/lib/db/quiz-authoring";
import { db } from "@/lib/db/client";
import { courses, modules, moduleVersions, quizModuleVersions, quizQuestions, quizChoices } from "@/lib/db/schema";

describe("POST /api/admin/quiz/[moduleVersionId]/questions", () => {
  it("adds a question with choices", async () => {
    const [course] = await db.insert(courses).values({ code: `ADMIN-QUIZ-Q-${randomUUID()}`, title: "x" }).returning();
    const { moduleId, moduleVersionId } = await createQuizModule(course.id, "Quiz");
    try {
      const response = await POST(
        new NextRequest("http://localhost/x", {
          method: "POST",
          body: JSON.stringify({
            questionType: "single_choice",
            prompt: "2+2?",
            points: 1,
            choices: [{ choiceText: "3", isCorrect: false }, { choiceText: "4", isCorrect: true }],
          }),
        }),
        { params: Promise.resolve({ moduleVersionId }) }
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.questionId).toBeDefined();
    } finally {
      const questions = await db.select().from(quizQuestions).where(eq(quizQuestions.quizModuleVersionId, moduleVersionId));
      for (const q of questions) await db.delete(quizChoices).where(eq(quizChoices.questionId, q.id));
      await db.delete(quizQuestions).where(eq(quizQuestions.quizModuleVersionId, moduleVersionId));
      await db.delete(quizModuleVersions).where(eq(quizModuleVersions.moduleVersionId, moduleVersionId));
      await db.update(modules).set({ currentVersionId: null }).where(eq(modules.id, moduleId));
      await db.delete(moduleVersions).where(eq(moduleVersions.id, moduleVersionId));
      await db.delete(modules).where(eq(modules.id, moduleId));
      await db.delete(courses).where(eq(courses.id, course.id));
    }
  });

  it("rejects a 'text' question type with 400", async () => {
    const [course] = await db.insert(courses).values({ code: `ADMIN-QUIZ-TXT-${randomUUID()}`, title: "x" }).returning();
    const { moduleId, moduleVersionId } = await createQuizModule(course.id, "Quiz");
    try {
      const response = await POST(
        new NextRequest("http://localhost/x", {
          method: "POST",
          body: JSON.stringify({ questionType: "text", prompt: "Explain", points: 1, choices: [] }),
        }),
        { params: Promise.resolve({ moduleVersionId }) }
      );
      expect(response.status).toBe(400);
    } finally {
      await db.delete(quizModuleVersions).where(eq(quizModuleVersions.moduleVersionId, moduleVersionId));
      await db.update(modules).set({ currentVersionId: null }).where(eq(modules.id, moduleId));
      await db.delete(moduleVersions).where(eq(moduleVersions.id, moduleVersionId));
      await db.delete(modules).where(eq(modules.id, moduleId));
      await db.delete(courses).where(eq(courses.id, course.id));
    }
  });
});

describe("GET /api/admin/quiz/[moduleVersionId]/questions", () => {
  it("lists questions with their choices in sort order", async () => {
    const [course] = await db.insert(courses).values({ code: `ADMIN-QUIZ-LIST-${randomUUID()}`, title: "x" }).returning();
    const { moduleId, moduleVersionId } = await createQuizModule(course.id, "Quiz");
    try {
      await POST(
        new NextRequest("http://localhost/x", {
          method: "POST",
          body: JSON.stringify({
            questionType: "true_false",
            prompt: "The sky is blue.",
            points: 1,
            choices: [{ choiceText: "True", isCorrect: true }, { choiceText: "False", isCorrect: false }],
          }),
        }),
        { params: Promise.resolve({ moduleVersionId }) }
      );

      const response = await GET(new NextRequest("http://localhost/x"), { params: Promise.resolve({ moduleVersionId }) });
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.questions).toHaveLength(1);
      expect(body.questions[0].choices).toHaveLength(2);
    } finally {
      const questions = await db.select().from(quizQuestions).where(eq(quizQuestions.quizModuleVersionId, moduleVersionId));
      for (const q of questions) await db.delete(quizChoices).where(eq(quizChoices.questionId, q.id));
      await db.delete(quizQuestions).where(eq(quizQuestions.quizModuleVersionId, moduleVersionId));
      await db.delete(quizModuleVersions).where(eq(quizModuleVersions.moduleVersionId, moduleVersionId));
      await db.update(modules).set({ currentVersionId: null }).where(eq(modules.id, moduleId));
      await db.delete(moduleVersions).where(eq(moduleVersions.id, moduleVersionId));
      await db.delete(modules).where(eq(modules.id, moduleId));
      await db.delete(courses).where(eq(courses.id, course.id));
    }
  });
});
