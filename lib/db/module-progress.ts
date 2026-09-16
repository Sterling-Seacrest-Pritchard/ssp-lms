import { and, eq } from "drizzle-orm";
import { db } from "./client";
import { enrollments, modules, moduleProgress, moduleVersions } from "./schema";
import { getEnrollmentId } from "./enrollments";
import { getUserIdByEmail } from "./users";
import { getLatestLessonStatus } from "@/lib/scorm/completion-status";
import { getLatestVideoStatus } from "@/lib/video/completion-status";
import { getTrackedModuleVersionIds } from "@/lib/scorm/course-progress";

const FINISHED_LESSON_STATUSES = new Set(["completed", "passed"]);
const FINISHED_VIDEO_STATUSES = new Set(["completed"]);

/**
 * Called by both commit routes (app/api/scorm/commit, app/api/video/commit)
 * after they've written the raw scorm_attempt_state/video_attempt_state row.
 * Failures here must never surface as a failed commit response - a
 * progress-cache write failure is recoverable on the next commit, but a lost
 * attempt-state write is not (see spec Error Handling). Callers wrap this in
 * try/catch and log, not propagate.
 *
 * Deliberately a silent no-op (not an error) when the committing user has no
 * enrollment for this module's course - covers the admin SCORM test tool,
 * which launches modules for people who were never assigned/enrolled.
 */
export async function recordModuleCompletion(params: {
  userEmail: string;
  moduleVersionId: string;
}): Promise<void> {
  const userId = await getUserIdByEmail(params.userEmail);
  if (!userId) return;

  const [moduleRow] = await db
    .select({ moduleId: modules.id, courseId: modules.courseId, moduleType: modules.moduleType })
    .from(moduleVersions)
    .innerJoin(modules, eq(modules.id, moduleVersions.moduleId))
    .where(eq(moduleVersions.id, params.moduleVersionId));
  if (!moduleRow) return;

  const enrollmentId = await getEnrollmentId(userId, moduleRow.courseId);
  if (!enrollmentId) return;

  const finished = await isModuleFinished(moduleRow.moduleType, params.moduleVersionId, params.userEmail);

  const [existingProgress] = await db
    .select({ status: moduleProgress.status })
    .from(moduleProgress)
    .where(and(eq(moduleProgress.enrollmentId, enrollmentId), eq(moduleProgress.moduleId, moduleRow.moduleId)));

  const newStatus = finished ? "completed" : "incomplete";
  const progressChanged = !existingProgress || existingProgress.status !== newStatus;

  if (!existingProgress) {
    await db.insert(moduleProgress).values({ enrollmentId, moduleId: moduleRow.moduleId, status: newStatus });
  } else if (existingProgress.status !== newStatus) {
    await db
      .update(moduleProgress)
      .set({ status: newStatus })
      .where(and(eq(moduleProgress.enrollmentId, enrollmentId), eq(moduleProgress.moduleId, moduleRow.moduleId)));
  }

  // Rolling the parent enrollment up is a course-wide query - only run it
  // when this commit actually changed this module's progress row (first
  // time it's tracked at all, or its finished/incomplete status flipped),
  // not on every one of SCORM's frequent no-op commits.
  if (progressChanged) {
    await recomputeEnrollmentStatus(enrollmentId, moduleRow.courseId);
  }
}

async function isModuleFinished(moduleType: string, moduleVersionId: string, userEmail: string): Promise<boolean> {
  if (moduleType === "video") {
    const status = await getLatestVideoStatus(moduleVersionId, userEmail);
    return status !== null && FINISHED_VIDEO_STATUSES.has(status);
  }
  const lessonStatus = await getLatestLessonStatus(moduleVersionId, userEmail);
  return lessonStatus !== null && FINISHED_LESSON_STATUSES.has(lessonStatus);
}

async function recomputeEnrollmentStatus(enrollmentId: string, courseId: string): Promise<void> {
  const courseModules = await db.select().from(modules).where(eq(modules.courseId, courseId));
  const trackable = courseModules.flatMap((m) =>
    m.currentVersionId ? [{ moduleType: m.moduleType, moduleVersionId: m.currentVersionId, moduleId: m.id }] : []
  );
  const trackedIds = await getTrackedModuleVersionIds(trackable);
  const trackedModuleIds = new Set(trackable.filter((m) => trackedIds.has(m.moduleVersionId)).map((m) => m.moduleId));
  if (trackedModuleIds.size === 0) return;

  const progressRows = await db
    .select({ moduleId: moduleProgress.moduleId, status: moduleProgress.status })
    .from(moduleProgress)
    .where(eq(moduleProgress.enrollmentId, enrollmentId));
  const completedCount = progressRows.filter(
    (p) => trackedModuleIds.has(p.moduleId) && p.status === "completed"
  ).length;
  const attemptedCount = progressRows.filter((p) => trackedModuleIds.has(p.moduleId)).length;

  if (completedCount === trackedModuleIds.size) {
    await db
      .update(enrollments)
      .set({ status: "completed", completedAt: new Date() })
      .where(eq(enrollments.id, enrollmentId));
  } else if (attemptedCount > 0) {
    await db.update(enrollments).set({ status: "in_progress" }).where(eq(enrollments.id, enrollmentId));
  }
}
