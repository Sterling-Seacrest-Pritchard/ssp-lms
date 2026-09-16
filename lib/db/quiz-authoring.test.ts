import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  createQuizModule,
  addQuestion,
  updateQuestion,
  deleteQuestion,
  setPassingScore,
} from "./quiz-authoring";
import { db } from "./client";
import { courses, modules, moduleVersions, quizModuleVersions, quizQuestions, quizChoices } from "./schema";

async function cleanup(courseId: string) {
  const mods = await db.select().from(modules).where(eq(modules.courseId, courseId));
  for (const mod of mods) {
    const versions = await db.select().from(moduleVersions).where(eq(moduleVersions.moduleId, mod.id));
    for (const version of versions) {
      const questions = await db
        .select()
        .from(quizQuestions)
        .where(eq(quizQuestions.quizModuleVersionId, version.id));
      for (const q of questions) {
        await db.delete(quizChoices).where(eq(quizChoices.questionId, q.id));
      }
      await db.delete(quizQuestions).where(eq(quizQuestions.quizModuleVersionId, version.id));
      await db.delete(quizModuleVersions).where(eq(quizModuleVersions.moduleVersionId, version.id));
    }
    await db.update(modules).set({ currentVersionId: null }).where(eq(modules.id, mod.id));
    await db.delete(moduleVersions).where(eq(moduleVersions.moduleId, mod.id));
  }
  await db.delete(modules).where(eq(modules.courseId, courseId));
  await db.delete(courses).where(eq(courses.id, courseId));
}

describe("createQuizModule", () => {
  it("creates a draft module, version, and quiz_module_versions row with a default passing score", async () => {
    const [course] = await db
      .insert(courses)
      .values({ code: `QUIZ-AUTHOR-${randomUUID()}`, title: "Quiz Authoring Course" })
      .returning();
    try {
      const { moduleId, moduleVersionId } = await createQuizModule(course.id, "New Quiz");

      const [mod] = await db.select().from(modules).where(eq(modules.id, moduleId));
      expect(mod.moduleType).toBe("quiz");
      expect(mod.currentVersionId).toBe(moduleVersionId);

      const [version] = await db.select().from(moduleVersions).where(eq(moduleVersions.id, moduleVersionId));
      expect(version.status).toBe("draft");

      const [quizVersion] = await db
        .select()
        .from(quizModuleVersions)
        .where(eq(quizModuleVersions.moduleVersionId, moduleVersionId));
      expect(quizVersion.passingScorePct).toBe(70);
    } finally {
      await cleanup(course.id);
    }
  });
});

describe("addQuestion / updateQuestion / deleteQuestion", () => {
  it("adds a question with choices, updates it, and deletes it", async () => {
    const [course] = await db
      .insert(courses)
      .values({ code: `QUIZ-AUTHOR-Q-${randomUUID()}`, title: "Quiz Question Course" })
      .returning();
    try {
      const { moduleVersionId } = await createQuizModule(course.id, "Quiz");

      const { questionId } = await addQuestion(moduleVersionId, {
        questionType: "single_choice",
        prompt: "2 + 2?",
        points: 1,
        choices: [
          { choiceText: "3", isCorrect: false },
          { choiceText: "4", isCorrect: true },
        ],
      });

      const [question] = await db.select().from(quizQuestions).where(eq(quizQuestions.id, questionId));
      expect(question.prompt).toBe("2 + 2?");
      const choices = await db.select().from(quizChoices).where(eq(quizChoices.questionId, questionId));
      expect(choices).toHaveLength(2);

      await updateQuestion(questionId, { prompt: "What is 2 + 2?", points: 2 });
      const [updated] = await db.select().from(quizQuestions).where(eq(quizQuestions.id, questionId));
      expect(updated.prompt).toBe("What is 2 + 2?");
      expect(updated.points).toBe(2);

      await deleteQuestion(questionId);
      expect(await db.select().from(quizQuestions).where(eq(quizQuestions.id, questionId))).toHaveLength(0);
      expect(await db.select().from(quizChoices).where(eq(quizChoices.questionId, questionId))).toHaveLength(0);
    } finally {
      await cleanup(course.id);
    }
  });

  it("rejects a 'text' question type - not supported in v1", async () => {
    const [course] = await db
      .insert(courses)
      .values({ code: `QUIZ-AUTHOR-TEXT-${randomUUID()}`, title: "Quiz Text Rejection Course" })
      .returning();
    try {
      const { moduleVersionId } = await createQuizModule(course.id, "Quiz");
      await expect(
        addQuestion(moduleVersionId, {
          questionType: "text",
          prompt: "Explain yourself",
          points: 1,
          choices: [],
        })
      ).rejects.toThrow("question_type 'text' is not supported");
    } finally {
      await cleanup(course.id);
    }
  });
});

describe("setPassingScore", () => {
  it("updates the passing score", async () => {
    const [course] = await db
      .insert(courses)
      .values({ code: `QUIZ-AUTHOR-SCORE-${randomUUID()}`, title: "Quiz Score Course" })
      .returning();
    try {
      const { moduleVersionId } = await createQuizModule(course.id, "Quiz");
      await setPassingScore(moduleVersionId, 85);
      const [quizVersion] = await db
        .select()
        .from(quizModuleVersions)
        .where(eq(quizModuleVersions.moduleVersionId, moduleVersionId));
      expect(quizVersion.passingScorePct).toBe(85);
    } finally {
      await cleanup(course.id);
    }
  });
});
