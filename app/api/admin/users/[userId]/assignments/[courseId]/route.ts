import { NextRequest, NextResponse } from "next/server";
import { badRequest, isUuid, serverError } from "@/lib/api/errors";
import { unassignCourse } from "@/lib/db/course-assignments";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ userId: string; courseId: string }> }
) {
  try {
    const { userId, courseId } = await params;
    if (!isUuid(userId) || !isUuid(courseId)) {
      return badRequest("userId and courseId must be UUIDs");
    }
    await unassignCourse(courseId, userId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return serverError(error);
  }
}
