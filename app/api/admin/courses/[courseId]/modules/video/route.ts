import { NextRequest, NextResponse } from "next/server";
import { addVideoPlaceholderModule } from "@/lib/db/course-authoring";
import { badRequest, isUuid, serverError } from "@/lib/api/errors";

export async function POST(
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

    const { title, durationMinutes } = (body ?? {}) as { title?: string; durationMinutes?: number };
    if (typeof title !== "string" || title.trim().length === 0) {
      return badRequest("title is required");
    }

    const { moduleVersionId } = await addVideoPlaceholderModule(
      courseId,
      title,
      typeof durationMinutes === "number" ? durationMinutes : null
    );
    return NextResponse.json({ moduleVersionId });
  } catch (error) {
    return serverError(error);
  }
}
