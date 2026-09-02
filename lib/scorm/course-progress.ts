import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { modules } from "@/lib/db/schema";
import { getLatestLessonStatus } from "./completion-status";

const FINISHED_STATUSES = new Set(["completed", "passed"]);

export interface CourseProgress {
  status: "not-started" | "in-progress" | "completed";
  progress: number;
}

export async function getCourseProgressForLearner(
  courseId: string,
  userId: string
): Promise<CourseProgress> {
  const courseModules = await db
    .select()
    .from(modules)
    .where(eq(modules.courseId, courseId));
  const publishedModules = courseModules.filter((m) => m.currentVersionId !== null);

  if (publishedModules.length === 0) {
    return { status: "not-started", progress: 0 };
  }

  const statuses = await Promise.all(
    publishedModules.map((m) => getLatestLessonStatus(m.currentVersionId as string, userId))
  );
  const completedCount = statuses.filter((s) => s !== null && FINISHED_STATUSES.has(s)).length;
  const progress = Math.round((completedCount / publishedModules.length) * 100);

  if (completedCount === 0) {
    return { status: "not-started", progress: 0 };
  }
  if (completedCount === publishedModules.length) {
    return { status: "completed", progress: 100 };
  }
  return { status: "in-progress", progress };
}
