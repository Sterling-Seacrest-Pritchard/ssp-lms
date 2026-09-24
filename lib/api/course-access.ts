import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isOrgAdmin } from "@/lib/roles";
import { getUserIdByEmail } from "@/lib/db/users";
import { getDepartmentAdminDepartmentIds } from "@/lib/db/department-admins";
import { getCourseForBuilder } from "@/lib/db/queries";
import { notFound } from "@/lib/api/errors";

/**
 * Same anti-IDOR shape as the course builder page: an Org Admin bypasses,
 * everyone else must administer the course's department, and a course with
 * no department (or no matching row at all) is rejected too - never trust a
 * courseId route param alone.
 */
export async function canCallerAccessCourse(courseId: string): Promise<boolean> {
  const session = await auth();
  if (isOrgAdmin(session?.user?.roles)) return true;

  const course = await getCourseForBuilder(courseId);
  if (!course) return false;

  const userId = session?.user?.email ? await getUserIdByEmail(session.user.email) : null;
  const administeredIds = userId ? await getDepartmentAdminDepartmentIds(userId) : [];
  return !!course.departmentId && administeredIds.includes(course.departmentId);
}

export async function assertCourseAccess(courseId: string): Promise<NextResponse | null> {
  if (await canCallerAccessCourse(courseId)) return null;
  return notFound("Course not found");
}
