import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { moduleAttempts, scormAttemptState } from "@/lib/db/schema";
import { badRequest, isUuid, notFound, serverError } from "@/lib/api/errors";
import { auth } from "@/auth";

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    const sessionUserId = session?.user?.email;
    if (!sessionUserId) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return badRequest("Request body must be valid JSON");
    }

    const { attemptId, cmi } = (body ?? {}) as {
      attemptId?: string;
      cmi?: Record<string, unknown>;
    };

    if (!attemptId || !cmi) {
      return badRequest("attemptId and cmi are required");
    }

    if (!isUuid(attemptId)) {
      return badRequest("attemptId must be a UUID");
    }

    // The attempt must exist AND belong to the caller. Both misses collapse to
    // the same 404, matching app/api/video/commit/route.ts's rationale: a 403
    // would tell an attacker holding a guessed UUID that the attempt is real
    // and someone else's.
    const [attempt] = await db
      .select({ userId: moduleAttempts.userId })
      .from(moduleAttempts)
      .where(eq(moduleAttempts.id, attemptId));
    if (!attempt || attempt.userId !== sessionUserId) {
      return notFound("Attempt not found");
    }

    // SCORM 1.2's flattened CMI uses cmi.core.lesson_status/lesson_location;
    // SCORM 2004 uses cmi.completion_status (no combined pass/fail - that's
    // cmi.success_status, not tracked separately in this minimal slice) and
    // cmi.location. Try 1.2's keys first, fall back to 2004's. suspend_data
    // is the same key name in both versions.
    const stringOrNull = (value: unknown) => (typeof value === "string" ? value : null);
    const lessonStatus =
      stringOrNull(cmi["cmi.core.lesson_status"]) ?? stringOrNull(cmi["cmi.completion_status"]);
    const lessonLocation =
      stringOrNull(cmi["cmi.core.lesson_location"]) ?? stringOrNull(cmi["cmi.location"]);
    const suspendData = stringOrNull(cmi["cmi.suspend_data"]);

    const existing = await db
      .select()
      .from(scormAttemptState)
      .where(eq(scormAttemptState.moduleAttemptId, attemptId));

    if (existing.length === 0) {
      await db.insert(scormAttemptState).values({
        moduleAttemptId: attemptId,
        lessonStatus,
        lessonLocation,
        suspendData,
        rawCmi: cmi,
        lastCommitAt: new Date(),
      });
    } else {
      await db
        .update(scormAttemptState)
        .set({ lessonStatus, lessonLocation, suspendData, rawCmi: cmi, lastCommitAt: new Date() })
        .where(eq(scormAttemptState.moduleAttemptId, attemptId));
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return serverError(error);
  }
}
