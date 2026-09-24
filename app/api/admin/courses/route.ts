import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createDraftCourse } from "@/lib/db/course-authoring";
import { getUserIdByEmail } from "@/lib/db/users";
import { getDepartmentAdminDepartmentIds } from "@/lib/db/department-admins";
import { isOrgAdmin } from "@/lib/roles";
import { badRequest, isUuid, serverError } from "@/lib/api/errors";

export async function POST(request: Request) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return badRequest("Request body must be valid JSON");
    }
    const { title, departmentId: requestedDepartmentId } = (body ?? {}) as {
      title?: string;
      departmentId?: string;
    };
    if (!title || !title.trim()) {
      return badRequest("title is required");
    }

    const session = await auth();
    let departmentId: string | null = null;
    if (!isOrgAdmin(session?.user?.roles)) {
      const userId = session?.user?.email ? await getUserIdByEmail(session.user.email) : null;
      const administeredIds = userId ? await getDepartmentAdminDepartmentIds(userId) : [];
      if (administeredIds.length === 0) {
        return badRequest("You don't administer any department yet");
      }
      if (administeredIds.length === 1) {
        departmentId = administeredIds[0];
      } else {
        if (!requestedDepartmentId || !administeredIds.includes(requestedDepartmentId)) {
          return badRequest("departmentId must be one of the departments you administer");
        }
        departmentId = requestedDepartmentId;
      }
    } else if (requestedDepartmentId) {
      if (!isUuid(requestedDepartmentId)) {
        return badRequest("departmentId must be a UUID");
      }
      departmentId = requestedDepartmentId;
    }

    const { id } = await createDraftCourse(title.trim(), departmentId);
    return NextResponse.json({ courseId: id });
  } catch (error) {
    return serverError(error);
  }
}
