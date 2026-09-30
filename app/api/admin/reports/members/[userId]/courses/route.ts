import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { isOrgAdmin } from "@/lib/roles";
import { getUserDepartmentId, getUserIdByEmail } from "@/lib/db/users";
import { getDepartmentAdminDepartmentIds } from "@/lib/db/department-admins";
import { listCourseStatusRows } from "@/lib/db/member-progress";
import { badRequest, isUuid, notFound, serverError } from "@/lib/api/errors";

export async function GET(request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  try {
    const { userId } = await params;
    if (!isUuid(userId)) return badRequest("userId must be a UUID");

    const targetDepartmentId = await getUserDepartmentId(userId);
    if (targetDepartmentId === undefined) return notFound("User not found");

    const session = await auth();
    if (!isOrgAdmin(session?.user?.roles)) {
      const email = session?.user?.email;
      const callerId = email ? await getUserIdByEmail(email) : null;
      const administeredIds = callerId ? await getDepartmentAdminDepartmentIds(callerId) : [];
      if (targetDepartmentId === null || !administeredIds.includes(targetDepartmentId)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    const rows = await listCourseStatusRows({ userId });
    return NextResponse.json({ rows });
  } catch (error) {
    return serverError(error);
  }
}
