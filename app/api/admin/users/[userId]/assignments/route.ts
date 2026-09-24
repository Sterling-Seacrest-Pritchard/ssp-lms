import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { isOrgAdmin } from "@/lib/roles";
import { badRequest, isUuid, serverError } from "@/lib/api/errors";
import {
  assignCourse,
  DuplicateAssignmentError,
  listAssignmentsForUser,
} from "@/lib/db/course-assignments";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const session = await auth();
    if (!isOrgAdmin(session?.user?.roles)) {
      return NextResponse.json({ error: "Org Admin role required" }, { status: 403 });
    }

    const { userId } = await params;
    if (!isUuid(userId)) {
      return badRequest("userId must be a UUID");
    }
    const assignments = await listAssignmentsForUser(userId);
    return NextResponse.json({ assignments });
  } catch (error) {
    return serverError(error);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    // This lets the caller enroll ANY employee org-wide in ANY course - not
    // scoped to a department at all - so it must stay Org-Admin-only, same
    // as `requiresOrgAdminRole` enforces at the proxy level.
    const session = await auth();
    if (!isOrgAdmin(session?.user?.roles)) {
      return NextResponse.json({ error: "Org Admin role required" }, { status: 403 });
    }

    const { userId } = await params;
    if (!isUuid(userId)) {
      return badRequest("userId must be a UUID");
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

    try {
      await assignCourse(courseId, userId, session?.user?.email ?? null);
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
