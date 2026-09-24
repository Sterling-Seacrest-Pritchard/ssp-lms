import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { isOrgAdmin } from "@/lib/roles";
import { getUserIdByEmail } from "@/lib/db/users";
import { getDepartmentAdminDepartmentIds } from "@/lib/db/department-admins";
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

    const session = await auth();
    if (!isOrgAdmin(session?.user?.roles)) {
      const callerId = session?.user?.email ? await getUserIdByEmail(session.user.email) : null;
      const administeredIds = callerId ? await getDepartmentAdminDepartmentIds(callerId) : [];
      if (!administeredIds.includes(id)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    await unassignCourseFromDepartment(courseId, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return serverError(error);
  }
}
