import { and, eq } from "drizzle-orm";
import { db } from "./client";
import { courses, enrollments } from "./schema";

/**
 * Called inside the same transaction as a course_assignments insert
 * (lib/db/course-assignments.ts assignCourse) - not exported for standalone
 * use outside a transaction, since it's meant to be atomic with the
 * assignment record.
 */
export async function ensureEnrollment(
  tx: Pick<typeof db, "select" | "insert">,
  params: { userId: string; courseId: string }
): Promise<void> {
  const existing = await tx
    .select({ id: enrollments.id })
    .from(enrollments)
    .where(and(eq(enrollments.userId, params.userId), eq(enrollments.courseId, params.courseId)));
  if (existing.length > 0) return;

  const [course] = await tx.select({ dueDate: courses.dueDate }).from(courses).where(eq(courses.id, params.courseId));

  await tx.insert(enrollments).values({
    userId: params.userId,
    courseId: params.courseId,
    dueAt: course?.dueDate ?? null,
  });
}

export async function getEnrollmentId(userId: string, courseId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: enrollments.id })
    .from(enrollments)
    .where(and(eq(enrollments.userId, userId), eq(enrollments.courseId, courseId)));
  return row?.id ?? null;
}
