import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { moduleAttempts, quizAttemptAnswers, quizChoices, quizModuleVersions, quizQuestions } from "@/lib/db/schema";
import { getUserIdByEmail } from "@/lib/db/users";
import { scoreAnswer, scoreAttempt } from "@/lib/quiz/scoring";
import { recordModuleCompletion } from "@/lib/db/module-progress";
import { badRequest, isUuid, notFound, serverError } from "@/lib/api/errors";
import { auth } from "@/auth";

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    const userEmail = session?.user?.email;
    if (!userEmail) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }
    const userId = await getUserIdByEmail(userEmail);
    if (!userId) {
      return NextResponse.json({ error: "User record not found" }, { status: 404 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return badRequest("Request body must be valid JSON");
    }
    const { attemptId, answers } = (body ?? {}) as {
      attemptId?: string;
      answers?: { questionId: string; selectedChoiceIds: string[] }[];
    };
    if (!attemptId || !answers) {
      return badRequest("attemptId and answers are required");
    }
    if (!isUuid(attemptId)) {
      return badRequest("attemptId must be a UUID");
    }

    // Both a missing attempt and someone else's attempt collapse to the
    // same 404 - matches the SCORM/video commit routes' rationale.
    const [attempt] = await db.select().from(moduleAttempts).where(eq(moduleAttempts.id, attemptId));
    if (!attempt || attempt.userId !== userId) {
      return notFound("Attempt not found");
    }
    if (attempt.status === "completed" || attempt.status === "failed") {
      return badRequest("This attempt has already been scored");
    }

    const [quizVersion] = await db
      .select()
      .from(quizModuleVersions)
      .where(eq(quizModuleVersions.moduleVersionId, attempt.moduleVersionId));
    if (!quizVersion) {
      return notFound("Quiz not found");
    }

    const questions = await db
      .select()
      .from(quizQuestions)
      .where(eq(quizQuestions.quizModuleVersionId, attempt.moduleVersionId));

    const choicesByQuestion = new Map<string, { id: string; isCorrect: boolean }[]>();
    for (const question of questions) {
      const questionChoices = await db
        .select({ id: quizChoices.id, isCorrect: quizChoices.isCorrect })
        .from(quizChoices)
        .where(eq(quizChoices.questionId, question.id));
      choicesByQuestion.set(question.id, questionChoices);
    }

    const answersByQuestionId = new Map(answers.map((a) => [a.questionId, a.selectedChoiceIds]));

    const scoredQuestions = questions.map((question) => {
      if (question.questionType !== "single_choice" && question.questionType !== "multi_choice" && question.questionType !== "true_false") {
        throw new Error(`question_type '${question.questionType}' is not supported`);
      }
      const questionChoices = choicesByQuestion.get(question.id) ?? [];
      const selectedChoiceIds = answersByQuestionId.get(question.id) ?? [];
      const isCorrect = scoreAnswer({ questionType: question.questionType, choices: questionChoices }, selectedChoiceIds);
      return { questionId: question.id, points: question.points, isCorrect, selectedChoiceIds };
    });

    const result = scoreAttempt(scoredQuestions, quizVersion.passingScorePct);

    await db.transaction(async (tx) => {
      if (scoredQuestions.length > 0) {
        await tx.insert(quizAttemptAnswers).values(
          scoredQuestions.map((q) => ({
            moduleAttemptId: attempt.id,
            questionId: q.questionId,
            selectedChoiceIds: q.selectedChoiceIds,
            isCorrect: q.isCorrect,
          }))
        );
      }
      await tx
        .update(moduleAttempts)
        .set({ status: result.passed ? "completed" : "failed", endedAt: new Date() })
        .where(eq(moduleAttempts.id, attempt.id));
    });

    try {
      await recordModuleCompletion({ userId, moduleVersionId: attempt.moduleVersionId });
    } catch (error) {
      console.error("recordModuleCompletion failed after a successful quiz submission", error);
    }

    return NextResponse.json({ percentage: result.percentage, passed: result.passed });
  } catch (error) {
    return serverError(error);
  }
}
