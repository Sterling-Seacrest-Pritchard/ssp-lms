import { eq } from "drizzle-orm";
import { db } from "./client";
import { modules } from "./schema";
import { getTrackedModuleVersionIds } from "@/lib/scorm/course-progress";

export interface AdjacentModule {
  moduleVersionId: string;
  moduleType: string;
  title: string;
}

export interface AdjacentModules {
  prev: AdjacentModule | null;
  next: AdjacentModule | null;
}

/**
 * The module immediately before/after `currentModuleVersionId` in course
 * order, considering only modules that are actually launchable right now
 * (same "launchable" rule the course detail page uses via
 * `getTrackedModuleVersionIds` - a video module isn't launchable until its
 * Mux asset is `ready`, so skipping over it here matches what the learner
 * can actually click into next).
 *
 * Returns `{ prev: null, next: null }` if the course has no other launchable
 * modules, or if `currentModuleVersionId` isn't one of them.
 */
export async function getAdjacentModules(
  courseId: string,
  currentModuleVersionId: string
): Promise<AdjacentModules> {
  const courseModules = await db
    .select({
      title: modules.title,
      moduleType: modules.moduleType,
      currentVersionId: modules.currentVersionId,
    })
    .from(modules)
    .where(eq(modules.courseId, courseId))
    .orderBy(modules.sortOrder);

  const launchableCandidates = courseModules.flatMap((m) =>
    m.currentVersionId ? [{ moduleType: m.moduleType, moduleVersionId: m.currentVersionId, title: m.title }] : []
  );
  const trackedIds = await getTrackedModuleVersionIds(launchableCandidates);
  const launchable = launchableCandidates.filter((m) => trackedIds.has(m.moduleVersionId));

  const index = launchable.findIndex((m) => m.moduleVersionId === currentModuleVersionId);
  if (index === -1) {
    return { prev: null, next: null };
  }

  return {
    prev: index > 0 ? launchable[index - 1] : null,
    next: index < launchable.length - 1 ? launchable[index + 1] : null,
  };
}
