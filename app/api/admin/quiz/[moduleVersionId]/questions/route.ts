import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { quizQuestions, quizChoices } from "@/lib/db/schema";
import { addQuestion } from "@/lib/db/quiz-authoring";
import { badRequest, serverError } from "@/lib/api/errors";
import { assertModuleVersionAccess } from "@/lib/api/course-access";

export async function GET(_request: NextRequest, props: { params: Promise<{ moduleVersionId: string }> }) {
  try {
    const { moduleVersionId } = await props.params;
    const denied = await assertModuleVersionAccess(moduleVersionId);
    if (denied) return denied;

    const questions = await db
      .select()
      .from(quizQuestions)
      .where(eq(quizQuestions.quizModuleVersionId, moduleVersionId))
      .orderBy(quizQuestions.sortOrder);
    const withChoices = await Promise.all(
      questions.map(async (question) => {
        const choices = await db
          .select()
          .from(quizChoices)
          .where(eq(quizChoices.questionId, question.id))
          .orderBy(quizChoices.sortOrder);
        return { ...question, choices };
      })
    );
    return NextResponse.json({ questions: withChoices });
  } catch (error) {
    return serverError(error);
  }
}

export async function POST(request: NextRequest, props: { params: Promise<{ moduleVersionId: string }> }) {
  try {
    const { moduleVersionId } = await props.params;
    const denied = await assertModuleVersionAccess(moduleVersionId);
    if (denied) return denied;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return badRequest("Request body must be valid JSON");
    }
    const { questionType, prompt, points, choices } = (body ?? {}) as {
      questionType?: string;
      prompt?: string;
      points?: number;
      choices?: { choiceText: string; isCorrect: boolean }[];
    };
    if (!questionType || !prompt || points === undefined || !choices) {
      return badRequest("questionType, prompt, points, and choices are required");
    }
    const { questionId } = await addQuestion(moduleVersionId, { questionType, prompt, points, choices });
    return NextResponse.json({ questionId });
  } catch (error) {
    if (error instanceof Error && error.message.includes("is not supported")) {
      return badRequest(error.message);
    }
    return serverError(error);
  }
}
