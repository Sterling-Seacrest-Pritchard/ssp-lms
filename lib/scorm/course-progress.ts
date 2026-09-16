import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { enrollments, modules, moduleProgress } from "@/lib/db/schema";
import { isUuid } from "@/lib/api/errors";
import { getLatestLessonStatus } from "./completion-status";
import { getLatestVideoStatus } from "@/lib/video/completion-status";
import { getReadyVideoModuleVersionIds } from "@/lib/video/launch-info";

const FINISHED_STATUSES = new Set(["completed", "passed"]);
const VIDEO_FINISHED_STATUSES = new Set(["completed"]);

/**
 * Module types that report completion back to the LMS. Video now has a real
 * player and real completion tracking (lib/video/completion-status.ts) - it
 * was excluded here only while it was placeholder-only.
 *
 * Type alone is NOT sufficient for video - see
 * `getTrackedModuleVersionIds`, which is what callers should use.
 */
const TRACKED_MODULE_TYPES = new Set(["scorm", "video"]);

export interface CourseProgress {
  status: "not-started" | "in-progress" | "completed";
  progress: number;
}

function isTrackedModuleType(moduleType: string): boolean {
  return TRACKED_MODULE_TYPES.has(moduleType);
}

export interface TrackableModule {
  moduleType: string;
  moduleVersionId: string;
}

/**
 * Which of the given modules actually report completion to the LMS *right
 * now*, keyed by module version id.
 *
 * For video, the module's type is not enough: a video module whose Mux asset
 * is not `ready` (still `waiting`/`preparing`, or `errored`) has nothing to
 * play - `getVideoLaunchInfo` correctly refuses it, so a "Start" button on
 * one leads straight to a 404. Worse, counting it toward the completion
 * denominator pins the course below 100% forever, since it can never be
 * finished. That's the same hazard the placeholder-era exclusion existed to
 * prevent; it applies just as much to the not-ready era, and it is live data
 * today because Task 1's backfill migration set every pre-existing
 * placeholder video row to `status: "errored"`.
 *
 * SCORM modules have no equivalent asynchronous processing step, so type
 * alone still settles it for them.
 */
export async function getTrackedModuleVersionIds(
  courseModules: TrackableModule[]
): Promise<Set<string>> {
  const byType = courseModules.filter((m) => isTrackedModuleType(m.moduleType));
  const readyVideoIds = await getReadyVideoModuleVersionIds(
    byType.filter((m) => m.moduleType === "video").map((m) => m.moduleVersionId)
  );
  return new Set(
    byType
      .filter((m) => m.moduleType !== "video" || readyVideoIds.has(m.moduleVersionId))
      .map((m) => m.moduleVersionId)
  );
}

export async function isModuleFinishedForUser(
  moduleType: string,
  moduleVersionId: string,
  userId: string
): Promise<boolean> {
  if (moduleType === "video") {
    const status = await getLatestVideoStatus(moduleVersionId, userId);
    return status !== null && VIDEO_FINISHED_STATUSES.has(status);
  }
  const lessonStatus = await getLatestLessonStatus(moduleVersionId, userId);
  return lessonStatus !== null && FINISHED_STATUSES.has(lessonStatus);
}

export async function computeLiveCourseProgress(
  courseId: string,
  userId: string
): Promise<CourseProgress> {
  if (!isUuid(courseId)) {
    return { status: "not-started", progress: 0 };
  }

  const courseModules = await db.select().from(modules).where(eq(modules.courseId, courseId));
  const published: TrackableModule[] = courseModules.flatMap((m) =>
    m.currentVersionId
      ? [{ moduleType: m.moduleType, moduleVersionId: m.currentVersionId }]
      : []
  );
  const trackedIds = await getTrackedModuleVersionIds(published);
  const trackedModules = published.filter((m) => trackedIds.has(m.moduleVersionId));

  if (trackedModules.length === 0) {
    return { status: "not-started", progress: 0 };
  }

  const finishedFlags = await Promise.all(
    trackedModules.map((m) => isModuleFinishedForUser(m.moduleType, m.moduleVersionId, userId))
  );
  const completedCount = finishedFlags.filter(Boolean).length;
  const progress = Math.round((completedCount / trackedModules.length) * 100);

  if (completedCount === 0) {
    return { status: "not-started", progress: 0 };
  }
  if (completedCount === trackedModules.length) {
    return { status: "completed", progress: 100 };
  }
  return { status: "in-progress", progress };
}

export async function getCourseProgressForLearner(
  courseId: string,
  userId: string
): Promise<CourseProgress> {
  if (!isUuid(courseId)) {
    return { status: "not-started", progress: 0 };
  }

  const [enrollment] = await db
    .select()
    .from(enrollments)
    .where(and(eq(enrollments.userId, userId), eq(enrollments.courseId, courseId)));
  if (!enrollment) {
    return { status: "not-started", progress: 0 };
  }

  const courseModules = await db.select().from(modules).where(eq(modules.courseId, courseId));
  // Bridge module-VERSION-ids (what getTrackedModuleVersionIds works in) to
  // module-ids (what module_progress rows are keyed by) - same approach
  // recomputeEnrollmentStatus (lib/db/module-progress.ts) already uses. This
  // matters when a completed module is later unpublished/removed: without
  // intersecting against the currently-tracked set, a stale module_progress
  // row could inflate completedCount past the current tracked-module count
  // and push progress over 100%.
  const trackable = courseModules.flatMap((m) =>
    m.currentVersionId
      ? [{ moduleType: m.moduleType, moduleVersionId: m.currentVersionId, moduleId: m.id }]
      : []
  );
  const trackedVersionIds = await getTrackedModuleVersionIds(trackable);
  const trackedModuleIds = new Set(
    trackable.filter((m) => trackedVersionIds.has(m.moduleVersionId)).map((m) => m.moduleId)
  );
  if (trackedModuleIds.size === 0) {
    return { status: "not-started", progress: 0 };
  }

  const progressRows = await db
    .select({ moduleId: moduleProgress.moduleId, status: moduleProgress.status })
    .from(moduleProgress)
    .where(eq(moduleProgress.enrollmentId, enrollment.id));
  const completedCount = progressRows.filter(
    (p) => trackedModuleIds.has(p.moduleId) && p.status === "completed"
  ).length;
  const progress = Math.round((completedCount / trackedModuleIds.size) * 100);

  // Checked BEFORE the zero-progress short-circuit: an enrollment already
  // marked completed must always render as completed/100%, whether or not
  // module_progress rows happen to exist for it (e.g. a backfilled
  // enrollment, or a future data-repair path).
  if (enrollment.status === "completed") {
    return { status: "completed", progress: 100 };
  }
  if (completedCount === 0) {
    return { status: "not-started", progress: 0 };
  }
  return { status: "in-progress", progress };
}
