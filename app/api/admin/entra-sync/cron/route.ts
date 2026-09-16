import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { serverError } from "@/lib/api/errors";
import { syncAssignedUsers } from "@/lib/entra/sync";

/**
 * Daily automatic Entra sync, triggered by the `crons` entry in vercel.json.
 * Vercel signs its own cron requests with `Authorization: Bearer
 * $CRON_SECRET` when a CRON_SECRET env var is set on the project - checked
 * here so this endpoint can't be triggered by anyone else who finds the URL.
 * The existing manual "Sync from Entra" button (POST /api/admin/entra-sync)
 * is unaffected and still works the same way.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("Entra cron sync: CRON_SECRET is not set - refusing to run unauthenticated");
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }
  const expected = Buffer.from(`Bearer ${secret}`);
  const got = Buffer.from(request.headers.get("authorization") ?? "");
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await syncAssignedUsers();
    console.log(
      `Entra cron sync: ${result.total} total, ${result.created} created, ${result.updated} updated`
    );
    return NextResponse.json(result);
  } catch (error) {
    // Logged explicitly (not just the 500 response) so a failed run is
    // findable by searching Vercel's Runtime Logs / Cron Jobs tab, since
    // there's no automated alert wired up for this route - see the
    // 2026-09-15 daily-entra-sync-cron log entry for why that was deferred.
    console.error("Entra cron sync failed:", error);
    return serverError(error);
  }
}
