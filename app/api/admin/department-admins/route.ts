import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { badRequest, isUuid, serverError } from "@/lib/api/errors";
import { assignDepartmentAdmin } from "@/lib/db/department-admins";
import { DuplicateAssignmentError } from "@/lib/db/course-assignments";

export async function POST(request: NextRequest) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return badRequest("Request body must be valid JSON");
    }
    const { userId, departmentId } = (body ?? {}) as { userId?: string; departmentId?: string };
    if (!userId || !isUuid(userId) || !departmentId || !isUuid(departmentId)) {
      return badRequest("userId and departmentId must be UUIDs");
    }

    const session = await auth();
    try {
      await assignDepartmentAdmin(userId, departmentId, session?.user?.email ?? null);
    } catch (error) {
      if (error instanceof DuplicateAssignmentError) {
        return NextResponse.json({ error: error.message }, { status: 409 });
      }
      throw error;
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return serverError(error);
  }
}
