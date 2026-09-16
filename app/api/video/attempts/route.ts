import { NextRequest, NextResponse } from "next/server";
import { badRequest, isUuid, notFound, serverError } from "@/lib/api/errors";
import { auth } from "@/auth";
import { getUserIdByEmail } from "@/lib/db/users";
import { getModuleVersionCourseId } from "@/lib/db/modules";
import { getEnrollmentId } from "@/lib/db/enrollments";
import { createModuleAttempt } from "@/lib/db/module-attempts";
import { isAdminRole } from "@/lib/roles";

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    const userEmail = session?.user?.email;
    if (!userEmail) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }
    const userId = await getUserIdByEmail(userEmail);
    if (!userId) {
      return NextResponse.json({ error: "User record not found" }, { status: 404 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return badRequest("Request body must be valid JSON");
    }
    const { moduleVersionId } = (body ?? {}) as { moduleVersionId?: string };
    if (!moduleVersionId) {
      return badRequest("moduleVersionId is required");
    }
    if (!isUuid(moduleVersionId)) {
      return badRequest("moduleVersionId must be a UUID");
    }

    const courseId = await getModuleVersionCourseId(moduleVersionId);
    if (!courseId) {
      return notFound("Module version not found");
    }

    if (!isAdminRole(session.user?.roles)) {
      const enrollmentId = await getEnrollmentId(userId, courseId);
      if (!enrollmentId) {
        return notFound("Module version not found");
      }
    }

    const attempt = await createModuleAttempt({ userId, moduleVersionId });

    return NextResponse.json({ attemptId: attempt.id });
  } catch (error) {
    return serverError(error);
  }
}
