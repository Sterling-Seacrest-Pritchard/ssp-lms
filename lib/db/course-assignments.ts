import { and, eq } from "drizzle-orm";
import { db } from "./client";
import { courseAssignments, courses, users } from "./schema";
import { ensureEnrollment } from "./enrollments";
import { isUuid } from "@/lib/api/errors";

export interface UserWithStatus {
  id: string;
  email: string;
  displayName: string;
  departmentId: string | null;
  /** "active" once they've signed in at least once (entraObjectId claimed), "pending" if only synced in from Entra so far. */
  status: "active" | "pending";
  /** Entra app role last seen at sync time (e.g. "Org Admin", "Learner"), or null if never synced / no distinct role. */
  entraRole: string | null;
  /** False once a sync no longer finds this person assigned in Entra - distinct from `status`, which tracks sign-in history, not current access. */
  isActive: boolean;
}

/**
 * Every user, synced-but-never-signed-in ones included - this is the search
 * surface an admin uses to find someone to assign a course to, whether or
 * not that person has ever touched the LMS yet.
 */
export async function listUsersWithStatus(): Promise<UserWithStatus[]> {
  const rows = await db.select().from(users).orderBy(users.displayName);
  return rows.map((u) => ({
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    departmentId: u.departmentId,
    status: u.entraObjectId ? "active" : "pending",
    entraRole: u.entraRole,
    isActive: u.isActive,
  }));
}

export interface AssignedCourse {
  courseId: string;
  title: string;
  code: string;
  assignedAt: string;
}

export async function listAssignmentsForUser(userId: string): Promise<AssignedCourse[]> {
  if (!isUuid(userId)) return [];
  const rows = await db
    .select({
      courseId: courses.id,
      title: courses.title,
      code: courses.code,
      assignedAt: courseAssignments.assignedAt,
    })
    .from(courseAssignments)
    .innerJoin(courses, eq(courses.id, courseAssignments.courseId))
    .where(eq(courseAssignments.userId, userId))
    .orderBy(courseAssignments.assignedAt);
  return rows.map((r) => ({ ...r, assignedAt: r.assignedAt.toISOString() }));
}

export class DuplicateAssignmentError extends Error {}

export async function assignCourse(
  courseId: string,
  userId: string,
  assignedBy: string | null
): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await tx.insert(courseAssignments).values({ courseId, userId, assignedBy });
      await ensureEnrollment(tx, { userId, courseId });
    });
  } catch (error) {
    // Postgres unique_violation on the (course_id, user_id) constraint -
    // "already assigned" is a normal outcome here, not a server error. Drizzle
    // wraps the real pg error in a DrizzleQueryError, so the pg error code
    // lives on `.cause`, not on the caught error directly (confirmed against
    // the actual thrown shape, not assumed).
    const pgCode = (error as { cause?: { code?: string } })?.cause?.code;
    if (pgCode === "23505") {
      throw new DuplicateAssignmentError("This course is already assigned to this user");
    }
    throw error;
  }
}

export async function unassignCourse(courseId: string, userId: string): Promise<void> {
  await db
    .delete(courseAssignments)
    .where(and(eq(courseAssignments.courseId, courseId), eq(courseAssignments.userId, userId)));
}
