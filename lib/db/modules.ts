import { eq } from "drizzle-orm";
import { db } from "./client";
import { modules, moduleVersions } from "./schema";

/**
 * Resolve a module version to its parent course id, so callers (the scorm/
 * video/quiz attempts routes) can run `getEnrollmentId(userId, courseId)`
 * against the module's *real* course - never a courseId the caller already
 * had (e.g. from the URL), which would let a moduleVersionId for a different
 * course slip past a check keyed on the wrong id. Mirrors the courseId
 * resolution in lib/scorm/launch-info.ts and lib/video/launch-info.ts.
 *
 * Returns null when the module version doesn't exist.
 */
export async function getModuleVersionCourseId(moduleVersionId: string): Promise<string | null> {
  const [row] = await db
    .select({ courseId: modules.courseId })
    .from(moduleVersions)
    .innerJoin(modules, eq(modules.id, moduleVersions.moduleId))
    .where(eq(moduleVersions.id, moduleVersionId));
  return row?.courseId ?? null;
}
