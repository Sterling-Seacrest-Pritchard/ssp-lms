import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { moduleAttempts } from "@/lib/db/schema";
import { badRequest, isUuid, serverError } from "@/lib/api/errors";
import { auth } from "@/auth";

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    const userId = session?.user?.email;
    if (!userId) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
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

    const previousAttempts = await db
      .select()
      .from(moduleAttempts)
      .where(and(eq(moduleAttempts.moduleVersionId, moduleVersionId), eq(moduleAttempts.userId, userId)));

    const [attempt] = await db
      .insert(moduleAttempts)
      .values({ moduleVersionId, userId, attemptNumber: previousAttempts.length + 1 })
      .returning();

    return NextResponse.json({ attemptId: attempt.id });
  } catch (error) {
    return serverError(error);
  }
}
