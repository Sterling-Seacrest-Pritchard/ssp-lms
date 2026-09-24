import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isOrgAdmin } from "@/lib/roles";
import { getUserIdByEmail } from "@/lib/db/users";
import { getDepartmentAdminDepartmentIds } from "@/lib/db/department-admins";
import { getCourseForBuilder } from "@/lib/db/queries";
import { getModuleVersionCourseId } from "@/lib/db/modules";
import { isUuid, notFound } from "@/lib/api/errors";

type SessionLike = { user?: { email?: string | null; roles?: string[] } } | null;

/**
 * Same anti-IDOR shape as the course builder page: an Org Admin bypasses,
 * everyone else must administer the course's department, and a course with
 * no department (or no matching row at all) is rejected too - never trust a
 * courseId route param alone.
 *
 * `session` is optional - most callers just want the check and let this
 * call `auth()` itself, but a caller that also needs the session for its
 * own logic (e.g. validating a `departmentId` field alongside the ownership
 * check) can pass one in to avoid a second `auth()` call.
 */
export async function canCallerAccessCourse(courseId: string, session?: SessionLike): Promise<boolean> {
  const resolvedSession = session === undefined ? await auth() : session;
  if (isOrgAdmin(resolvedSession?.user?.roles)) return true;

  const course = await getCourseForBuilder(courseId);
  if (!course) return false;

  const userId = resolvedSession?.user?.email ? await getUserIdByEmail(resolvedSession.user.email) : null;
  const administeredIds = userId ? await getDepartmentAdminDepartmentIds(userId) : [];
  return !!course.departmentId && administeredIds.includes(course.departmentId);
}

export async function assertCourseAccess(courseId: string, session?: SessionLike): Promise<NextResponse | null> {
  if (await canCallerAccessCourse(courseId, session)) return null;
  return notFound("Course not found");
}

/**
 * Same ownership check, but for endpoints keyed on a moduleVersionId rather
 * than a courseId directly (the quiz/text authoring APIs) - resolves the
 * module version's REAL parent course first, then applies the same rule.
 * Never trust a courseId that arrives alongside a moduleVersionId in the
 * request (e.g. a URL path param): a Department Admin could put their own
 * courseId in the URL beside a foreign moduleVersionId otherwise.
 */
export async function canCallerAccessModuleVersion(moduleVersionId: string): Promise<boolean> {
  const courseId = await getModuleVersionCourseId(moduleVersionId);
  if (!courseId) return false;
  return canCallerAccessCourse(courseId);
}

export async function assertModuleVersionAccess(moduleVersionId: string): Promise<NextResponse | null> {
  if (await canCallerAccessModuleVersion(moduleVersionId)) return null;
  return notFound("Not found");
}

/**
 * Shared department-scoping decision for course *creation* (both the
 * courses POST route and the SCORM-upload create-mode path use this): an
 * Org Admin may pick any department (or none, for a global course); a
 * Department Admin with zero administered departments can't create a
 * course at all; with exactly one, they're silently auto-scoped to it; with
 * two or more, they must pass a departmentId that's one of their own.
 */
export async function resolveCourseCreationDepartmentId(
  session: SessionLike,
  requestedDepartmentId: string | null
): Promise<{ departmentId: string | null } | { error: string }> {
  if (isOrgAdmin(session?.user?.roles)) {
    if (requestedDepartmentId) {
      if (!isUuid(requestedDepartmentId)) {
        return { error: "departmentId must be a UUID" };
      }
      return { departmentId: requestedDepartmentId };
    }
    return { departmentId: null };
  }

  const userId = session?.user?.email ? await getUserIdByEmail(session.user.email) : null;
  const administeredIds = userId ? await getDepartmentAdminDepartmentIds(userId) : [];
  if (administeredIds.length === 0) {
    return { error: "You don't administer any department yet" };
  }
  if (administeredIds.length === 1) {
    return { departmentId: administeredIds[0] };
  }
  if (!requestedDepartmentId || !administeredIds.includes(requestedDepartmentId)) {
    return { error: "departmentId must be one of the departments you administer" };
  }
  return { departmentId: requestedDepartmentId };
}
