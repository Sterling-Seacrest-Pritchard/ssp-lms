import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { moduleAttempts, scormAttemptState } from "@/lib/db/schema";

export async function getLatestLessonStatus(
  moduleVersionId: string,
  userId: string
): Promise<string | null> {
  const [row] = await db
    .select({ lessonStatus: scormAttemptState.lessonStatus })
    .from(moduleAttempts)
    .leftJoin(scormAttemptState, eq(scormAttemptState.moduleAttemptId, moduleAttempts.id))
    .where(
      and(eq(moduleAttempts.moduleVersionId, moduleVersionId), eq(moduleAttempts.userId, userId))
    )
    .orderBy(desc(moduleAttempts.startedAt))
    .limit(1);

  return row?.lessonStatus ?? null;
}
