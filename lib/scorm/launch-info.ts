import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { courses, modules, moduleVersions, scormModuleVersions } from "@/lib/db/schema";
import { isUuid } from "@/lib/api/errors";

export interface ScormLaunchInfo {
  launchUrl: string;
  gcsPrefix: string;
  scormVersion: string;
  courseId: string;
}

interface ScormLaunchInfoRow extends ScormLaunchInfo {
  courseId: string;
  courseStatus: string;
}

/**
 * Resolve a module version to its package's launch details, WITHOUT checking
 * the parent course's publish status.
 *
 * Admin-only surfaces use this: an admin building a course needs to test a
 * SCORM module before the course is published. Never call it from a
 * learner-facing surface - use `getScormLaunchInfo` there.
 */
export async function getScormLaunchInfoForAdmin(
  moduleVersionId: string
): Promise<ScormLaunchInfo | null> {
  const row = await loadLaunchInfoRow(moduleVersionId);
  if (!row) return null;
  return { launchUrl: row.launchUrl, gcsPrefix: row.gcsPrefix, scormVersion: row.scormVersion, courseId: row.courseId };
}

/**
 * Resolve a module version to its package's launch details, for a learner.
 *
 * Returns null unless the module's parent course is published, mirroring the
 * gate `getRealCourseDetail` applies to the course detail page. Without the
 * join up to `courses`, this lookup took only a module version id and a
 * learner holding (or enumerating) an id belonging to a DRAFT course's module
 * could launch that content - and create real attempt rows against it -
 * straight past the detail page's gate.
 *
 * Always returns the module's real `courseId` so callers can check
 * enrollment against it - never trust a courseId a caller already had (e.g.
 * from the URL) without confirming this module actually belongs to it. A
 * learner enrolled in course A could otherwise pass A's id (satisfying an
 * enrollment check keyed on that id) but supply a moduleVersionId belonging
 * to course B and still get B's real launch info.
 */
export async function getScormLaunchInfo(moduleVersionId: string): Promise<ScormLaunchInfo | null> {
  const row = await loadLaunchInfoRow(moduleVersionId);
  if (!row || row.courseStatus !== "published") return null;
  return { launchUrl: row.launchUrl, gcsPrefix: row.gcsPrefix, scormVersion: row.scormVersion, courseId: row.courseId };
}

async function loadLaunchInfoRow(moduleVersionId: string): Promise<ScormLaunchInfoRow | null> {
  if (!isUuid(moduleVersionId)) return null;

  const [row] = await db
    .select({
      launchUrl: scormModuleVersions.launchUrl,
      gcsPrefix: scormModuleVersions.gcsPrefix,
      scormVersion: scormModuleVersions.scormVersion,
      courseId: courses.id,
      courseStatus: courses.status,
    })
    .from(scormModuleVersions)
    .innerJoin(moduleVersions, eq(moduleVersions.id, scormModuleVersions.moduleVersionId))
    .innerJoin(modules, eq(modules.id, moduleVersions.moduleId))
    .innerJoin(courses, eq(courses.id, modules.courseId))
    .where(eq(scormModuleVersions.moduleVersionId, moduleVersionId));

  return row ?? null;
}
