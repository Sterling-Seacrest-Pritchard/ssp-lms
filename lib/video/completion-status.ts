import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { moduleAttempts, videoAttemptState } from "@/lib/db/schema";

export async function getLatestVideoStatus(
  moduleVersionId: string,
  userId: string
): Promise<string | null> {
  const [row] = await db
    .select({ status: videoAttemptState.status })
    .from(moduleAttempts)
    .leftJoin(videoAttemptState, eq(videoAttemptState.moduleAttemptId, moduleAttempts.id))
    .where(and(eq(moduleAttempts.moduleVersionId, moduleVersionId), eq(moduleAttempts.userId, userId)))
    .orderBy(desc(moduleAttempts.startedAt))
    .limit(1);

  return row?.status ?? null;
}
