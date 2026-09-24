import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { isOrgAdmin } from "@/lib/roles";
import { getUserIdByEmail } from "@/lib/db/users";
import { getDepartmentAdminDepartmentIds } from "@/lib/db/department-admins";
import { badRequest, isUuid, serverError } from "@/lib/api/errors";
import {
  assignCourseToDepartment,
  listCourseAssignmentsForDepartment,
} from "@/lib/db/department-course-assignments";
import { DuplicateAssignmentError } from "@/lib/db/course-assignments";
import { assertCourseAccess } from "@/lib/api/course-access";

async function assertDepartmentAccess(
  session: { user?: { email?: string | null; roles?: string[] } } | null,
  departmentId: string
): Promise<NextResponse | null> {
  if (isOrgAdmin(session?.user?.roles)) return null;
  const callerId = session?.user?.email ? await getUserIdByEmail(session.user.email) : null;
  const administeredIds = callerId ? await getDepartmentAdminDepartmentIds(callerId) : [];
  if (!administeredIds.includes(departmentId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!isUuid(id)) {
      return badRequest("id must be a UUID");
    }

    const session = await auth();
    const forbidden = await assertDepartmentAccess(session, id);
    if (forbidden) return forbidden;

    const assignments = await listCourseAssignmentsForDepartment(id);
    return NextResponse.json({ assignments });
  } catch (error) {
    return serverError(error);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!isUuid(id)) {
      return badRequest("id must be a UUID");
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return badRequest("Request body must be valid JSON");
    }
    const { courseId } = (body ?? {}) as { courseId?: string };
    if (!courseId || !isUuid(courseId)) {
      return badRequest("courseId must be a UUID");
    }

    const session = await auth();
    const forbidden = await assertDepartmentAccess(session, id);
    if (forbidden) return forbidden;

    // assertDepartmentAccess only confirmed the caller administers the
    // TARGET department (`id`) - it says nothing about where `courseId`
    // itself lives. Without this, a Department Admin of dept A could pull
    // dept B's course into dept A's roster. `assertCourseAccess` bypasses
    // for an Org Admin (who may still assign any course, including a
    // global one, to any department) and otherwise requires the course's
    // OWN departmentId to be one the caller administers - which also means
    // a Department Admin can't use this route to hand a global course to
    // their department either. That's intentional here, not just a side
    // effect: the course picker this route backs (`/api/admin/courses/list`)
    // already excludes global courses from what a Department Admin sees as
    // assignable in the first place, so this matches the existing UI
    // capability exactly rather than removing one.
    const courseDenied = await assertCourseAccess(courseId, session);
    if (courseDenied) return courseDenied;

    try {
      const result = await assignCourseToDepartment(courseId, id, session?.user?.email ?? null);
      return NextResponse.json(result);
    } catch (error) {
      if (error instanceof DuplicateAssignmentError) {
        return NextResponse.json({ error: error.message }, { status: 409 });
      }
      throw error;
    }
  } catch (error) {
    return serverError(error);
  }
}
