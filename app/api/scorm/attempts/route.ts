import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { moduleAttempts } from "@/lib/db/schema";
import { badRequest, isUuid, serverError } from "@/lib/api/errors";

export async function POST(request: NextRequest) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return badRequest("Request body must be valid JSON");
    }

    const { moduleVersionId, userId } = (body ?? {}) as {
      moduleVersionId?: string;
      userId?: string;
    };

    if (!moduleVersionId || !userId) {
      return badRequest("moduleVersionId and userId are required");
    }

    if (!isUuid(moduleVersionId)) {
      return badRequest("moduleVersionId must be a UUID");
    }

    // Attempt numbers are PER USER: filtering on moduleVersionId alone would
    // number User B's first attempt 2 just because User A already has one.
    const previousAttempts = await db
      .select()
      .from(moduleAttempts)
      .where(
        and(
          eq(moduleAttempts.moduleVersionId, moduleVersionId),
          eq(moduleAttempts.userId, userId)
        )
      );

    const [attempt] = await db
      .insert(moduleAttempts)
      .values({
        moduleVersionId,
        userId,
        attemptNumber: previousAttempts.length + 1,
      })
      .returning();

    return NextResponse.json({ attemptId: attempt.id, attemptNumber: attempt.attemptNumber });
  } catch (error) {
    return serverError(error);
  }
}
