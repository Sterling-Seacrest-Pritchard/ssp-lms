import { NextRequest, NextResponse } from "next/server";
import { removeModule } from "@/lib/db/course-authoring";
import { badRequest, isUuid, serverError } from "@/lib/api/errors";
import { assertCourseAccess } from "@/lib/api/course-access";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ courseId: string; moduleId: string }> }
) {
  try {
    const { courseId, moduleId } = await params;
    if (!isUuid(courseId) || !isUuid(moduleId)) {
      return badRequest("courseId and moduleId must be UUIDs");
    }
    const denied = await assertCourseAccess(courseId);
    if (denied) return denied;

    await removeModule(courseId, moduleId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return serverError(error);
  }
}
