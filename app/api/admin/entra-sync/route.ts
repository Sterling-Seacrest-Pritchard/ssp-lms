import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isOrgAdmin } from "@/lib/roles";
import { serverError } from "@/lib/api/errors";
import { syncAssignedUsers } from "@/lib/entra/sync";

export async function POST() {
  try {
    // Triggers a full org resync - Org-Admin-only, matching
    // `requiresOrgAdminRole` at the proxy level. (The separate scheduled
    // /api/admin/entra-sync/cron route authenticates with a bearer secret
    // instead, and is unaffected by this.)
    const session = await auth();
    if (!isOrgAdmin(session?.user?.roles)) {
      return NextResponse.json({ error: "Org Admin role required" }, { status: 403 });
    }

    const result = await syncAssignedUsers();
    return NextResponse.json(result);
  } catch (error) {
    return serverError(error);
  }
}
