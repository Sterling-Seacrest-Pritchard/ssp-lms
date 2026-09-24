import { NextRequest, NextResponse } from "next/server";
import { badRequest, isUuid, serverError } from "@/lib/api/errors";
import { removeDepartmentAdmin } from "@/lib/db/department-admins";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ userId: string; departmentId: string }> }
) {
  try {
    const { userId, departmentId } = await params;
    if (!isUuid(userId) || !isUuid(departmentId)) {
      return badRequest("userId and departmentId must be UUIDs");
    }
    await removeDepartmentAdmin(userId, departmentId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return serverError(error);
  }
}
