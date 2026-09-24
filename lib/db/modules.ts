import { eq } from "drizzle-orm";
import { db } from "./client";
import { modules, moduleVersions } from "./schema";
import { isUuid } from "@/lib/api/errors";

/**
 * Resolve a module version to its parent course id, so callers (the scorm/
 * video/quiz attempts routes) can run `getEnrollmentId(userId, courseId)`
 * against the module's *real* course - never a courseId the caller already
 * had (e.g. from the URL), which would let a moduleVersionId for a different
 * course slip past a check keyed on the wrong id. Mirrors the courseId
 * resolution in lib/scorm/launch-info.ts and lib/video/launch-info.ts.
 *
 * Returns null when the module version doesn't exist OR isn't a UUID -
 * matches every sibling resolver in this file tree (e.g.
 * lib/scorm/launch-info.ts's loadLaunchInfoRow); without this a malformed id
 * hits Postgres directly and throws a raw 22P02 instead of resolving to a
 * clean not-found.
 */
export async function getModuleVersionCourseId(moduleVersionId: string): Promise<string | null> {
  if (!isUuid(moduleVersionId)) return null;

  const [row] = await db
    .select({ courseId: modules.courseId })
    .from(moduleVersions)
    .innerJoin(modules, eq(modules.id, moduleVersions.moduleId))
    .where(eq(moduleVersions.id, moduleVersionId));
  return row?.courseId ?? null;
}
