import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { moduleAttempts } from "@/lib/db/schema";

/**
 * Quiz is the one module type where module_attempts.status itself IS the
 * finished-state signal - unlike SCORM/video, which derive finished-ness
 * from a sibling state table and leave module_attempts.status at its
 * default "in_progress" forever. The quiz submission route (a later task)
 * sets this directly to "completed"/"failed" at scoring time.
 */
export async function getLatestQuizStatus(moduleVersionId: string, userId: string): Promise<string | null> {
  const [row] = await db
    .select({ status: moduleAttempts.status })
    .from(moduleAttempts)
    .where(and(eq(moduleAttempts.moduleVersionId, moduleVersionId), eq(moduleAttempts.userId, userId)))
    .orderBy(desc(moduleAttempts.startedAt))
    .limit(1);
  return row?.status ?? null;
}
