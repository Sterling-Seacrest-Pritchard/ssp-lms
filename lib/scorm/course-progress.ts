import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { modules } from "@/lib/db/schema";
import { isUuid } from "@/lib/api/errors";
import { getLatestLessonStatus } from "./completion-status";
import { getLatestVideoStatus } from "@/lib/video/completion-status";

const FINISHED_STATUSES = new Set(["completed", "passed"]);
const VIDEO_FINISHED_STATUSES = new Set(["completed"]);

/**
 * Module types that report completion back to the LMS. Video now has a real
 * player and real completion tracking (lib/video/completion-status.ts) - it
 * was excluded here only while it was placeholder-only.
 */
const TRACKED_MODULE_TYPES = new Set(["scorm", "video"]);

export interface CourseProgress {
  status: "not-started" | "in-progress" | "completed";
  progress: number;
}

export function isTrackedModuleType(moduleType: string): boolean {
  return TRACKED_MODULE_TYPES.has(moduleType);
}

async function isModuleFinishedForUser(
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

export async function getCourseProgressForLearner(
  courseId: string,
  userId: string
): Promise<CourseProgress> {
  if (!isUuid(courseId)) {
    return { status: "not-started", progress: 0 };
  }

  const courseModules = await db.select().from(modules).where(eq(modules.courseId, courseId));
  const trackedModules = courseModules.filter(
    (m) => m.currentVersionId !== null && isTrackedModuleType(m.moduleType)
  );

  if (trackedModules.length === 0) {
    return { status: "not-started", progress: 0 };
  }

  const finishedFlags = await Promise.all(
    trackedModules.map((m) => isModuleFinishedForUser(m.moduleType, m.currentVersionId as string, userId))
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
