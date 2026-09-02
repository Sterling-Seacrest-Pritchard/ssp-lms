import { NextRequest, NextResponse } from "next/server";
import { updateCourseDetails } from "@/lib/db/course-authoring";
import { badRequest, isUuid, serverError } from "@/lib/api/errors";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ courseId: string }> }
) {
  try {
    const { courseId } = await params;
    if (!isUuid(courseId)) {
      return badRequest("courseId must be a UUID");
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return badRequest("Request body must be valid JSON");
    }

    await updateCourseDetails(courseId, body as Record<string, unknown>);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return serverError(error);
  }
}
