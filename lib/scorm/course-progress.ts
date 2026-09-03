import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { modules } from "@/lib/db/schema";
import { isUuid } from "@/lib/api/errors";
import { getLatestLessonStatus } from "./completion-status";

const FINISHED_STATUSES = new Set(["completed", "passed"]);

/**
 * Module types that report completion back to the LMS.
 *
 * Video placeholder modules have no player and no completion tracking yet, so
 * counting them here would make any course containing one permanently stuck
 * below 100% - never reaching "completed" no matter what the learner does.
 * They are excluded from BOTH sides of the fraction until real video tracking
 * exists.
 */
const TRACKED_MODULE_TYPES = new Set(["scorm"]);

export interface CourseProgress {
  status: "not-started" | "in-progress" | "completed";
  progress: number;
}

export function isTrackedModuleType(moduleType: string): boolean {
  return TRACKED_MODULE_TYPES.has(moduleType);
}

export async function getCourseProgressForLearner(
  courseId: string,
  userId: string
): Promise<CourseProgress> {
  if (!isUuid(courseId)) {
    return { status: "not-started", progress: 0 };
  }

  const courseModules = await db
    .select()
    .from(modules)
    .where(eq(modules.courseId, courseId));
  const trackedModules = courseModules.filter(
    (m) => m.currentVersionId !== null && isTrackedModuleType(m.moduleType)
  );

  if (trackedModules.length === 0) {
    return { status: "not-started", progress: 0 };
  }

  const statuses = await Promise.all(
    trackedModules.map((m) => getLatestLessonStatus(m.currentVersionId as string, userId))
  );
  const completedCount = statuses.filter((s) => s !== null && FINISHED_STATUSES.has(s)).length;
  const progress = Math.round((completedCount / trackedModules.length) * 100);

  if (completedCount === 0) {
    return { status: "not-started", progress: 0 };
  }
  if (completedCount === trackedModules.length) {
    return { status: "completed", progress: 100 };
  }
  return { status: "in-progress", progress };
}
