import { NextRequest, NextResponse } from "next/server";
import { updateQuestion, deleteQuestion } from "@/lib/db/quiz-authoring";
import { badRequest, serverError } from "@/lib/api/errors";

export async function PATCH(request: NextRequest, props: { params: Promise<{ questionId: string }> }) {
  try {
    const { questionId } = await props.params;
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
    await deleteQuestion(questionId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return serverError(error);
  }
}
