import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isOrgAdmin } from "@/lib/roles";
import { listUsersWithStatus } from "@/lib/db/course-assignments";
import { serverError } from "@/lib/api/errors";

export async function GET() {
  try {
    // Defense-in-depth: `requiresOrgAdminRole` already gates this path at
    // the proxy level, but this is the full company directory (every
    // user's email, department, and assignment status), so it's worth a
    // second check in the handler itself, matching the department-admins
    // route's pattern.
    const session = await auth();
    if (!isOrgAdmin(session?.user?.roles)) {
      return NextResponse.json({ error: "Org Admin role required" }, { status: 403 });
    }

    const users = await listUsersWithStatus();
    return NextResponse.json({ users });
  } catch (error) {
    return serverError(error);
  }
}
