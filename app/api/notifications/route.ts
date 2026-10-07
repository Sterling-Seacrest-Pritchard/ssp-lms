import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUserIdByEmail } from "@/lib/db/users";
import { listNotificationsForUser, countUnreadNotifications } from "@/lib/notifications/queries";
import { serverError } from "@/lib/api/errors";

export async function GET(): Promise<NextResponse> {
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

    const [notifications, unreadCount] = await Promise.all([
      listNotificationsForUser(userId),
      countUnreadNotifications(userId),
    ]);

    return NextResponse.json({ notifications, unreadCount });
  } catch (error) {
    return serverError(error);
  }
}
