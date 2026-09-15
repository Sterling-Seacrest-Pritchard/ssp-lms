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
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await syncAssignedUsers();
    console.log(
      `Entra cron sync: ${result.total} total, ${result.created} created, ${result.updated} updated`
    );
    return NextResponse.json(result);
  } catch (error) {
    return serverError(error);
  }
}
