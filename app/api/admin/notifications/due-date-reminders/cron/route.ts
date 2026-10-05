import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { serverError } from "@/lib/api/errors";
import { sendDueDateReminders } from "@/lib/mail/due-date-reminders";

/**
 * Daily due-date-reminder sweep, triggered by the `crons` entry in
 * vercel.json. Same CRON_SECRET bearer-token check as the existing Entra
 * sync cron (app/api/admin/entra-sync/cron) - reused rather than a second
 * secret, since both are internal-only Vercel-triggered routes.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("Due-date reminder cron: CRON_SECRET is not set - refusing to run unauthenticated");
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }
  const expected = Buffer.from(`Bearer ${secret}`);
  const got = Buffer.from(request.headers.get("authorization") ?? "");
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await sendDueDateReminders();
    console.log(
      `Due-date reminder cron: ${result.checked} checked, ${result.sent} sent, ${result.failed} failed`
    );
    return NextResponse.json(result);
  } catch (error) {
    console.error("Due-date reminder cron failed:", error);
    return serverError(error);
  }
}
