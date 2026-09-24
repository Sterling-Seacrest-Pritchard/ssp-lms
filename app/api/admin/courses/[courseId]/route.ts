import { NextRequest, NextResponse } from "next/server";
import { deleteCourse, updateCourseDetails } from "@/lib/db/course-authoring";
import { badRequest, isUuid, serverError } from "@/lib/api/errors";
import { assertCourseAccess } from "@/lib/api/course-access";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ courseId: string }> }
) {
  try {
    const { courseId } = await params;
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

    await updateCourseDetails(courseId, body as Record<string, unknown>);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return serverError(error);
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ courseId: string }> }
) {
  try {
    const { courseId } = await params;
    if (!isUuid(courseId)) {
      return badRequest("courseId must be a UUID");
    }
    const denied = await assertCourseAccess(courseId);
    if (denied) return denied;

    await deleteCourse(courseId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return serverError(error);
  }
}
