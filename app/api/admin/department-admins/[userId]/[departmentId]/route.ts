import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { badRequest, isUuid, serverError } from "@/lib/api/errors";
import { removeDepartmentAdmin } from "@/lib/db/department-admins";
import { isOrgAdmin } from "@/lib/roles";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ userId: string; departmentId: string }> }
) {
  try {
    const { userId, departmentId } = await params;
    if (!isUuid(userId) || !isUuid(departmentId)) {
      return badRequest("userId and departmentId must be UUIDs");
    }

    const session = await auth();
    if (!isOrgAdmin(session?.user?.roles)) {
      return NextResponse.json({ error: "Org Admin role required" }, { status: 403 });
    }

    await removeDepartmentAdmin(userId, departmentId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return serverError(error);
  }
}
