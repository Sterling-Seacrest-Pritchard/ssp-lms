import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { isOrgAdmin } from "@/lib/roles";
import { getUserIdByEmail } from "@/lib/db/users";
import { getDepartmentAdminDepartmentIds } from "@/lib/db/department-admins";
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
    // Resolve the session once and pass it into assertCourseAccess, so the
    // departmentId re-check below sees the SAME session rather than issuing
    // a second auth() call.
    const session = await auth();
    const denied = await assertCourseAccess(courseId, session);
    if (denied) return denied;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return badRequest("Request body must be valid JSON");
    }
    const fields = (body ?? {}) as Record<string, unknown>;

    // departmentId is otherwise a plain client-writable field, which would
    // let a Department Admin PATCH it to null (global) or to a department
    // they don't administer - completely bypassing the creation-time
    // scoping this plan added. Scoping must derive from the session, never
    // a client-supplied parameter.
    if ("departmentId" in fields) {
      if (!isOrgAdmin(session?.user?.roles)) {
        const requestedDepartmentId = fields.departmentId;
        if (typeof requestedDepartmentId !== "string" || !requestedDepartmentId) {
          return badRequest("departmentId must be one of the departments you administer");
        }
        const userId = session?.user?.email ? await getUserIdByEmail(session.user.email) : null;
        const administeredIds = userId ? await getDepartmentAdminDepartmentIds(userId) : [];
        if (!administeredIds.includes(requestedDepartmentId)) {
          return badRequest("departmentId must be one of the departments you administer");
        }
      }
    }

    await updateCourseDetails(courseId, fields);
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
