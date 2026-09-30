import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { isOrgAdmin } from "@/lib/roles";
import { deleteDepartment } from "@/lib/db/departments";
import { badRequest, isUuid, serverError } from "@/lib/api/errors";

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!isUuid(id)) return badRequest("id must be a UUID");

    const session = await auth();
    if (!isOrgAdmin(session?.user?.roles)) {
      return NextResponse.json({ error: "Org Admin role required" }, { status: 403 });
    }

    await deleteDepartment(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return serverError(error);
  }
}
