import { and, eq } from "drizzle-orm";
import { db } from "./client";
import { courses, departmentCourseAssignments, users } from "./schema";
import { assignCourse, DuplicateAssignmentError } from "./course-assignments";
import { isUuid } from "@/lib/api/errors";

export interface DepartmentAssignedCourse {
  courseId: string;
  title: string;
  code: string;
  assignedAt: string;
}

export async function listCourseAssignmentsForDepartment(
  departmentId: string
): Promise<DepartmentAssignedCourse[]> {
  if (!isUuid(departmentId)) return [];
  const rows = await db
    .select({
      courseId: courses.id,
      title: courses.title,
      code: courses.code,
      assignedAt: departmentCourseAssignments.assignedAt,
    })
    .from(departmentCourseAssignments)
    .innerJoin(courses, eq(courses.id, departmentCourseAssignments.courseId))
    .where(eq(departmentCourseAssignments.departmentId, departmentId))
    .orderBy(departmentCourseAssignments.assignedAt);
  return rows.map((r) => ({ ...r, assignedAt: r.assignedAt.toISOString() }));
}

/**
 * Assign a course to every current member of a department.
 *
 * Records the department-level assignment (so a user added to the
 * department later automatically picks it up - see
 * `assignDepartmentCoursesToUser`), then assigns the course to each current
 * member individually via the same `assignCourse` used by the per-user
 * "Assign" flow in Org Admin - this is what makes the two paths share one
 * source of truth: a member who already has the course (assigned to them
 * directly, or via a previous department assignment) simply gets skipped,
 * since `course_assignments` has a unique (course_id, user_id) constraint
 * and `listAssignmentsForUser` - which the per-user assign dialog reads to
 * hide already-assigned courses - doesn't care how an assignment got there.
 */
export async function assignCourseToDepartment(
  courseId: string,
  departmentId: string,
  assignedBy: string | null
): Promise<{ memberCount: number; newlyAssigned: number }> {
  try {
    await db.insert(departmentCourseAssignments).values({ departmentId, courseId, assignedBy });
  } catch (error) {
    const pgCode = (error as { cause?: { code?: string } })?.cause?.code;
    if (pgCode === "23505") {
      throw new DuplicateAssignmentError("This course is already assigned to this department");
    }
    throw error;
  }

  const members = await db.select({ id: users.id }).from(users).where(eq(users.departmentId, departmentId));

  let newlyAssigned = 0;
  for (const member of members) {
    try {
      await assignCourse(courseId, member.id, assignedBy);
      newlyAssigned++;
    } catch (error) {
      // A member who already has this course (assigned individually earlier)
      // is expected, not an error - every other member still needs to go
      // through.
      if (error instanceof DuplicateAssignmentError) continue;
      throw error;
    }
  }

  return { memberCount: members.length, newlyAssigned };
}

/**
 * Stops the department from handing this course to FUTURE members - does
 * NOT retroactively unassign it from current members, matching how removing
 * a user from a department (`clearUserDepartment`) doesn't retroactively
 * touch their existing assignments either. An admin who wants a specific
 * member off the course removes it from the Users list, same as any other
 * assignment.
 */
export async function unassignCourseFromDepartment(courseId: string, departmentId: string): Promise<void> {
  await db
    .delete(departmentCourseAssignments)
    .where(
      and(
        eq(departmentCourseAssignments.departmentId, departmentId),
        eq(departmentCourseAssignments.courseId, courseId)
      )
    );
}

/**
 * Called when a user joins a department, so they immediately get every
 * course already assigned to that department - the "sync" half of this
 * feature. Skips (rather than errors on) any course the user already has,
 * the same way `assignCourseToDepartment` skips members who already have a
 * course.
 */
export async function assignDepartmentCoursesToUser(userId: string, departmentId: string): Promise<void> {
  const departmentCourses = await db
    .select({ courseId: departmentCourseAssignments.courseId })
    .from(departmentCourseAssignments)
    .where(eq(departmentCourseAssignments.departmentId, departmentId));

  for (const { courseId } of departmentCourses) {
    try {
      await assignCourse(courseId, userId, "department-sync");
    } catch (error) {
      if (error instanceof DuplicateAssignmentError) continue;
      throw error;
    }
  }
}
