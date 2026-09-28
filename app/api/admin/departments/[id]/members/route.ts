import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { isOrgAdmin } from "@/lib/roles";
import { clearUserDepartment, setUserDepartment, setUserDepartmentIfUnassignedOrSame } from "@/lib/db/departments";
import { assignDepartmentCoursesToUser } from "@/lib/db/department-course-assignments";
import { getDepartmentAdminDepartmentIds } from "@/lib/db/department-admins";
import { getUserIdByEmail } from "@/lib/db/users";
import { badRequest, isUuid, serverError } from "@/lib/api/errors";

type SessionLike = { user?: { email?: string | null; roles?: string[] } } | null;

/**
 * Org Admins can act on any department; a Department Admin can only act on
 * a department they actually administer - checked against their own real
 * assignments, never a client-supplied claim.
 */
async function canManageDepartment(session: SessionLike, departmentId: string): Promise<boolean> {
  if (isOrgAdmin(session?.user?.roles)) return true;
  const email = session?.user?.email;
  if (!email) return false;
  const userId = await getUserIdByEmail(email);
  if (!userId) return false;
  const administeredIds = await getDepartmentAdminDepartmentIds(userId);
  return administeredIds.includes(departmentId);
}

async function parseParams(
  params: Promise<{ id: string }>,
  request: NextRequest
): Promise<{ departmentId: string; userId: string } | NextResponse> {
  const { id } = await params;
  if (!isUuid(id)) return badRequest("id must be a UUID");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("Request body must be valid JSON");
  }
  const userId = (body as { userId?: unknown })?.userId;
  if (typeof userId !== "string" || !isUuid(userId)) {
    return badRequest("userId must be a UUID");
  }
  return { departmentId: id, userId };
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();

    const parsed = await parseParams(params, request);
    if (parsed instanceof NextResponse) return parsed;

    if (!(await canManageDepartment(session, parsed.departmentId))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // A Department Admin can only pull in someone currently unassigned, or
    // a no-op re-add of their own existing member - never poach a member
    // out of a department they don't administer. Org Admins bypass this,
    // since they can already act on either side of any move.
    if (isOrgAdmin(session?.user?.roles)) {
      await setUserDepartment(parsed.userId, parsed.departmentId);
    } else {
      const moved = await setUserDepartmentIfUnassignedOrSame(parsed.userId, parsed.departmentId);
      if (!moved) {
        // Deliberately the same generic message/status as the canManageDepartment
        // check above - varying it by the target's membership state would let a
        // caller probe arbitrary userIds to learn who exists and who's already in
        // another department.
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }
    await assignDepartmentCoursesToUser(parsed.userId, parsed.departmentId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return serverError(error);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();

    const parsed = await parseParams(params, request);
    if (parsed instanceof NextResponse) return parsed;

    if (!(await canManageDepartment(session, parsed.departmentId))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await clearUserDepartment(parsed.userId, parsed.departmentId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return serverError(error);
  }
}
