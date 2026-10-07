import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUserIdByEmail } from "@/lib/db/users";
import { markNotificationRead } from "@/lib/notifications/queries";
import { badRequest, isUuid, serverError } from "@/lib/api/errors";

export async function PATCH(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    const email = session?.user?.email;
    if (!email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    if (!isUuid(id)) {
      return badRequest("id must be a UUID");
    }

    const userId = await getUserIdByEmail(email);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await markNotificationRead(id, userId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return serverError(error);
  }
}
