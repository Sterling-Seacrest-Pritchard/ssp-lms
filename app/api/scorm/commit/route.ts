import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { scormAttemptState } from "@/lib/db/schema";
import { badRequest, isUuid, serverError } from "@/lib/api/errors";

export async function POST(request: NextRequest) {
  try {
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

    const lessonStatus =
      typeof cmi["cmi.core.lesson_status"] === "string" ? (cmi["cmi.core.lesson_status"] as string) : null;
    const lessonLocation =
      typeof cmi["cmi.core.lesson_location"] === "string" ? (cmi["cmi.core.lesson_location"] as string) : null;
    const suspendData =
      typeof cmi["cmi.suspend_data"] === "string" ? (cmi["cmi.suspend_data"] as string) : null;

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
