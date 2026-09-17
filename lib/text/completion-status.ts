import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { moduleAttempts } from "@/lib/db/schema";

/**
 * Text is a self-reported module type, same shape as quiz:
 * module_attempts.status itself IS the finished-state signal (set directly
 * to "completed" the moment the learner clicks "Mark as Complete" - no
 * runtime, no scoring), rather than derived from a sibling state table the
 * way SCORM/video are.
 */
export async function getLatestTextStatus(moduleVersionId: string, userId: string): Promise<string | null> {
  const [row] = await db
    .select({ status: moduleAttempts.status })
    .from(moduleAttempts)
    .where(and(eq(moduleAttempts.moduleVersionId, moduleVersionId), eq(moduleAttempts.userId, userId)))
    .orderBy(desc(moduleAttempts.startedAt))
    .limit(1);
  return row?.status ?? null;
}
