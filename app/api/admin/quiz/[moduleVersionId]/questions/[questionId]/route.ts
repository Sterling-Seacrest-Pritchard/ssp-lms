import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { quizQuestions } from "@/lib/db/schema";
import { updateQuestion, deleteQuestion } from "@/lib/db/quiz-authoring";
import { badRequest, notFound, serverError } from "@/lib/api/errors";
import { assertModuleVersionAccess } from "@/lib/api/course-access";

/**
 * questionId doesn't carry a moduleVersionId of its own in the URL - resolve
 * it from the question row itself before checking course ownership, same
 * anti-IDOR principle as everywhere else in this file tree: never trust a
 * caller-supplied id without confirming what it actually belongs to.
 */
async function assertQuestionAccess(questionId: string): Promise<NextResponse | null> {
  const [question] = await db
    .select({ moduleVersionId: quizQuestions.quizModuleVersionId })
    .from(quizQuestions)
    .where(eq(quizQuestions.id, questionId));
  if (!question) {
    return notFound("Question not found");
  }
  return assertModuleVersionAccess(question.moduleVersionId);
}

export async function PATCH(request: NextRequest, props: { params: Promise<{ questionId: string }> }) {
  try {
    const { questionId } = await props.params;
    const denied = await assertQuestionAccess(questionId);
    if (denied) return denied;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return badRequest("Request body must be valid JSON");
    }
    const { prompt, points } = (body ?? {}) as { prompt?: string; points?: number };
    await updateQuestion(questionId, { prompt, points });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return serverError(error);
  }
}

export async function DELETE(_request: NextRequest, props: { params: Promise<{ questionId: string }> }) {
  try {
    const { questionId } = await props.params;
    const denied = await assertQuestionAccess(questionId);
    if (denied) return denied;

    await deleteQuestion(questionId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return serverError(error);
  }
}
