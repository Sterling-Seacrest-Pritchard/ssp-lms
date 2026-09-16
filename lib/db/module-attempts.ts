import { and, eq } from "drizzle-orm";
import { db } from "./client";
import { moduleAttempts } from "./schema";

const MAX_ATTEMPT_NUMBER_RETRIES = 5;

/** node-postgres error code for a unique_violation. */
const UNIQUE_VIOLATION = "23505";

/**
 * Count-then-insert to number this user's attempts at this module version is
 * inherently racy: two concurrent requests can both read the same previous-
 * attempts count and then both insert with the same attemptNumber. The
 * unique(module_version_id, user_id, attempt_number) constraint on
 * module_attempts (lib/db/schema.ts) turns the loser into a 23505 instead of
 * a silent duplicate; this retries with a freshly re-read count until one
 * insert wins.
 */
export async function createModuleAttempt(params: {
  userId: string;
  moduleVersionId: string;
}) {
  const { userId, moduleVersionId } = params;

  for (let attempt = 0; attempt < MAX_ATTEMPT_NUMBER_RETRIES; attempt++) {
    const previousAttempts = await db
      .select()
      .from(moduleAttempts)
      .where(and(eq(moduleAttempts.moduleVersionId, moduleVersionId), eq(moduleAttempts.userId, userId)));

    try {
      const [row] = await db
        .insert(moduleAttempts)
        .values({ moduleVersionId, userId, attemptNumber: previousAttempts.length + 1 })
        .returning();
      return row;
    } catch (error) {
      if ((error as { code?: string }).code === UNIQUE_VIOLATION && attempt < MAX_ATTEMPT_NUMBER_RETRIES - 1) {
        continue;
      }
      throw error;
    }
  }

  throw new Error("createModuleAttempt: exhausted retries computing attemptNumber");
}
