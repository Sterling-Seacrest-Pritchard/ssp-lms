import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUserIdByEmail } from "@/lib/db/users";
import { listNotificationsForUser, countUnreadNotifications } from "@/lib/notifications/queries";
import { serverError } from "@/lib/api/errors";

function parseLimit(raw: string | null): number | undefined {
  if (raw === null) return undefined;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
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

    const limit = parseLimit(request.nextUrl.searchParams.get("limit"));

    const [notifications, unreadCount] = await Promise.all([
      listNotificationsForUser(userId, { limit }),
      countUnreadNotifications(userId),
    ]);

    return NextResponse.json({ notifications, unreadCount });
  } catch (error) {
    return serverError(error);
  }
}
