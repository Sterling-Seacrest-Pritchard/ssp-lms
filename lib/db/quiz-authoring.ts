import { eq } from "drizzle-orm";
import { db } from "./client";
import { modules, moduleVersions, quizModuleVersions, quizQuestions, quizChoices } from "./schema";

const SUPPORTED_QUESTION_TYPES = new Set(["single_choice", "multi_choice", "true_false"]);
const DEFAULT_PASSING_SCORE_PCT = 70;

export async function createQuizModule(
  courseId: string,
  title: string
): Promise<{ moduleId: string; moduleVersionId: string }> {
  return db.transaction(async (tx) => {
    const [mod] = await tx.insert(modules).values({ courseId, moduleType: "quiz", title }).returning();
    const [version] = await tx
      .insert(moduleVersions)
      .values({ moduleId: mod.id, versionNumber: 1, status: "draft" })
      .returning();
    await tx.insert(quizModuleVersions).values({
      moduleVersionId: version.id,
      passingScorePct: DEFAULT_PASSING_SCORE_PCT,
    });
    await tx.update(modules).set({ currentVersionId: version.id }).where(eq(modules.id, mod.id));
    return { moduleId: mod.id, moduleVersionId: version.id };
  });
}

export interface AddQuestionParams {
  questionType: string;
  prompt: string;
  points: number;
  choices: { choiceText: string; isCorrect: boolean }[];
}

export async function addQuestion(
  moduleVersionId: string,
  params: AddQuestionParams
): Promise<{ questionId: string }> {
  if (!SUPPORTED_QUESTION_TYPES.has(params.questionType)) {
    throw new Error(`question_type '${params.questionType}' is not supported`);
  }

  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ sortOrder: quizQuestions.sortOrder })
      .from(quizQuestions)
      .where(eq(quizQuestions.quizModuleVersionId, moduleVersionId));
    const nextSortOrder = existing.length;

    const [question] = await tx
      .insert(quizQuestions)
      .values({
        quizModuleVersionId: moduleVersionId,
        sortOrder: nextSortOrder,
        questionType: params.questionType,
        prompt: params.prompt,
        points: params.points,
      })
      .returning();

    if (params.choices.length > 0) {
      await tx.insert(quizChoices).values(
        params.choices.map((choice, index) => ({
          questionId: question.id,
          sortOrder: index,
          choiceText: choice.choiceText,
          isCorrect: choice.isCorrect,
        }))
      );
    }

    return { questionId: question.id };
  });
}

export async function updateQuestion(
  questionId: string,
  fields: { prompt?: string; points?: number }
): Promise<void> {
  const update: Record<string, unknown> = {};
  if (fields.prompt !== undefined) update.prompt = fields.prompt;
  if (fields.points !== undefined) update.points = fields.points;
  if (Object.keys(update).length === 0) return;
  await db.update(quizQuestions).set(update).where(eq(quizQuestions.id, questionId));
}

export async function deleteQuestion(questionId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(quizChoices).where(eq(quizChoices.questionId, questionId));
    await tx.delete(quizQuestions).where(eq(quizQuestions.id, questionId));
  });
}

export async function setPassingScore(moduleVersionId: string, passingScorePct: number): Promise<void> {
  await db
    .update(quizModuleVersions)
    .set({ passingScorePct })
    .where(eq(quizModuleVersions.moduleVersionId, moduleVersionId));
}
