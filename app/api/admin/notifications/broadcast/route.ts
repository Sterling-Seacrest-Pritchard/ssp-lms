import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { badRequest, isUuid, serverError } from "@/lib/api/errors";
import { getDepartmentAdminDepartmentIds } from "@/lib/db/department-admins";
import { getUserIdByEmail } from "@/lib/db/users";
import { isOrgAdmin } from "@/lib/roles";
import { createBroadcast } from "@/lib/notifications/broadcast";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return badRequest("Request body must be valid JSON");
    }

    const { title, body: messageBody, targetScope, targetDepartmentId } = (body ?? {}) as {
      title?: string;
      body?: string;
      targetScope?: string;
      targetDepartmentId?: string;
    };

    if (!title || typeof title !== "string") {
      return badRequest("title is required");
    }
    if (!messageBody || typeof messageBody !== "string") {
      return badRequest("body is required");
    }
    if (targetScope !== "all" && targetScope !== "department") {
      return badRequest("targetScope must be 'all' or 'department'");
    }
    if (targetScope === "department" && (!targetDepartmentId || !isUuid(targetDepartmentId))) {
      return badRequest("targetDepartmentId must be a UUID when targetScope is 'department'");
    }

    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Admin role required" }, { status: 403 });
    }

    if (targetScope === "all") {
      if (!isOrgAdmin(session.user.roles)) {
        return NextResponse.json({ error: "Org Admin role required" }, { status: 403 });
      }
    } else {
      if (!isOrgAdmin(session.user.roles)) {
        const userId = await getUserIdByEmail(session.user.email);
        const adminDepartmentIds = userId ? await getDepartmentAdminDepartmentIds(userId) : [];
        if (!targetDepartmentId || !adminDepartmentIds.includes(targetDepartmentId)) {
          return NextResponse.json({ error: "You do not administer this department" }, { status: 403 });
        }
      }
    }

    const result = await createBroadcast({
      authorEmail: session.user.email,
      title,
      body: messageBody,
      targetScope,
      targetDepartmentId,
    });

    return NextResponse.json(result);
  } catch (error) {
    return serverError(error);
  }
}
