import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { PATCH, DELETE } from "./route";
import { createQuizModule, addQuestion } from "@/lib/db/quiz-authoring";
import { db } from "@/lib/db/client";
import { courses, modules, moduleVersions, quizModuleVersions, quizQuestions, quizChoices } from "@/lib/db/schema";

describe("PATCH/DELETE /api/admin/quiz/[moduleVersionId]/questions/[questionId]", () => {
  it("updates and then deletes a question", async () => {
    const [course] = await db.insert(courses).values({ code: `ADMIN-QUIZ-QID-${randomUUID()}`, title: "x" }).returning();
    const { moduleId, moduleVersionId } = await createQuizModule(course.id, "Quiz");
    const { questionId } = await addQuestion(moduleVersionId, {
      questionType: "single_choice",
      prompt: "old prompt",
      points: 1,
      choices: [{ choiceText: "a", isCorrect: true }],
    });
    try {
      const patchResponse = await PATCH(
        new NextRequest("http://localhost/x", { method: "PATCH", body: JSON.stringify({ prompt: "new prompt" }) }),
        { params: Promise.resolve({ moduleVersionId, questionId }) }
      );
      expect(patchResponse.status).toBe(200);
      const [updated] = await db.select().from(quizQuestions).where(eq(quizQuestions.id, questionId));
      expect(updated.prompt).toBe("new prompt");

      const deleteResponse = await DELETE(new NextRequest("http://localhost/x", { method: "DELETE" }), {
        params: Promise.resolve({ moduleVersionId, questionId }),
      });
      expect(deleteResponse.status).toBe(200);
      expect(await db.select().from(quizQuestions).where(eq(quizQuestions.id, questionId))).toHaveLength(0);
    } finally {
      await db.delete(quizModuleVersions).where(eq(quizModuleVersions.moduleVersionId, moduleVersionId));
      await db.update(modules).set({ currentVersionId: null }).where(eq(modules.id, moduleId));
      await db.delete(moduleVersions).where(eq(moduleVersions.id, moduleVersionId));
      await db.delete(modules).where(eq(modules.id, moduleId));
      await db.delete(courses).where(eq(courses.id, course.id));
    }
  });
});
