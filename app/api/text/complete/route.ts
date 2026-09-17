import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getUserIdByEmail } from "@/lib/db/users";
import { badRequest, isUuid, notFound, serverError } from "@/lib/api/errors";
import { auth } from "@/auth";
import { getModuleVersionCourseId } from "@/lib/db/modules";
import { getEnrollmentId } from "@/lib/db/enrollments";
import { createModuleAttempt } from "@/lib/db/module-attempts";
import { isAdminRole } from "@/lib/roles";
import { db } from "@/lib/db/client";
import { moduleAttempts } from "@/lib/db/schema";
import { recordModuleCompletion } from "@/lib/db/module-progress";

/**
 * Text is self-reported completion, no scoring - one endpoint creates the
 * attempt and marks it completed in the same request, unlike quiz's
 * two-step attempts/submit split (which exists there because scoring
 * happens between those steps; there's nothing to score here).
 */
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
    await db
      .update(moduleAttempts)
      .set({ status: "completed", endedAt: new Date() })
      .where(eq(moduleAttempts.id, attempt.id));

    try {
      await recordModuleCompletion({ userId, moduleVersionId });
    } catch (error) {
      console.error("recordModuleCompletion failed after marking a text module complete", error);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return serverError(error);
  }
}
