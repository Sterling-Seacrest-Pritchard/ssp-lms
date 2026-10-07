import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUserIdByEmail } from "@/lib/db/users";
import { markAllNotificationsRead } from "@/lib/notifications/queries";
import { serverError } from "@/lib/api/errors";

export async function PATCH(): Promise<NextResponse> {
  try {
    const session = await auth();
    const email = session?.user?.email;
    if (!email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = await getUserIdByEmail(email);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await markAllNotificationsRead(userId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return serverError(error);
  }
}
