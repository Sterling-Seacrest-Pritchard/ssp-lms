import { NextRequest, NextResponse } from "next/server";
import { setPassingScore } from "@/lib/db/quiz-authoring";
import { badRequest, serverError } from "@/lib/api/errors";

export async function PATCH(request: NextRequest, props: { params: Promise<{ moduleVersionId: string }> }) {
  try {
    const { moduleVersionId } = await props.params;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return badRequest("Request body must be valid JSON");
    }
    const { passingScorePct } = (body ?? {}) as { passingScorePct?: number };
    if (passingScorePct === undefined) {
      return badRequest("passingScorePct is required");
    }
    await setPassingScore(moduleVersionId, passingScorePct);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return serverError(error);
  }
}
