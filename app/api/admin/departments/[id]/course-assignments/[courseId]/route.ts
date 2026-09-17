import { NextRequest, NextResponse } from "next/server";
import { badRequest, isUuid, serverError } from "@/lib/api/errors";
import { unassignCourseFromDepartment } from "@/lib/db/department-course-assignments";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; courseId: string }> }
) {
  try {
    const { id, courseId } = await params;
    if (!isUuid(id) || !isUuid(courseId)) {
      return badRequest("id and courseId must be UUIDs");
    }
    await unassignCourseFromDepartment(courseId, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return serverError(error);
  }
}
