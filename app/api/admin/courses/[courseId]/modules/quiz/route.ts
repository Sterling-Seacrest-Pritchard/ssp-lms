import { NextRequest, NextResponse } from "next/server";
import { createQuizModule } from "@/lib/db/quiz-authoring";
import { badRequest, isUuid, serverError } from "@/lib/api/errors";
import { assertCourseAccess } from "@/lib/api/course-access";

export async function POST(request: NextRequest, props: { params: Promise<{ courseId: string }> }) {
  try {
    const { courseId } = await props.params;
    if (!isUuid(courseId)) {
      return badRequest("courseId must be a UUID");
    }
    const denied = await assertCourseAccess(courseId);
    if (denied) return denied;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return badRequest("Request body must be valid JSON");
    }
    const { title } = (body ?? {}) as { title?: string };
    if (!title) {
      return badRequest("title is required");
    }
    const { moduleId, moduleVersionId } = await createQuizModule(courseId, title);
    return NextResponse.json({ moduleId, moduleVersionId });
  } catch (error) {
    return serverError(error);
  }
}
