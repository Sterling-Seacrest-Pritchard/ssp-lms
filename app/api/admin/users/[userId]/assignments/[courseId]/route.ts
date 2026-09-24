import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { isOrgAdmin } from "@/lib/roles";
import { badRequest, isUuid, serverError } from "@/lib/api/errors";
import { unassignCourse } from "@/lib/db/course-assignments";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ userId: string; courseId: string }> }
) {
  try {
    // Removes any employee's compliance assignment org-wide - same
    // Org-Admin-only reasoning as the POST in the sibling route.
    const session = await auth();
    if (!isOrgAdmin(session?.user?.roles)) {
      return NextResponse.json({ error: "Org Admin role required" }, { status: 403 });
    }

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
