import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { moduleAttempts } from "@/lib/db/schema";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { moduleVersionId, userId } = body as { moduleVersionId?: string; userId?: string };

  if (!moduleVersionId || !userId) {
    return NextResponse.json(
      { error: "moduleVersionId and userId are required" },
      { status: 400 }
    );
  }

  const previousAttempts = await db
    .select()
    .from(moduleAttempts)
    .where(eq(moduleAttempts.moduleVersionId, moduleVersionId));

  const [attempt] = await db
    .insert(moduleAttempts)
    .values({
      moduleVersionId,
      userId,
      attemptNumber: previousAttempts.length + 1,
    })
    .returning();

  return NextResponse.json({ attemptId: attempt.id, attemptNumber: attempt.attemptNumber });
}
