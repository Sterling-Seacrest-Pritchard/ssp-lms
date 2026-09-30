import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { isOrgAdmin } from "@/lib/roles";
import { getUserDepartmentId, getUserIdByEmail } from "@/lib/db/users";
import { getDepartmentAdminDepartmentIds } from "@/lib/db/department-admins";
import { listCourseStatusRows } from "@/lib/db/member-progress";
import { badRequest, isUuid, notFound, serverError } from "@/lib/api/errors";

export async function GET(request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  try {
    const { userId } = await params;
    if (!isUuid(userId)) return badRequest("userId must be a UUID");

    const session = await auth();
    const targetDepartmentId = await getUserDepartmentId(userId);

    if (isOrgAdmin(session?.user?.roles)) {
      if (targetDepartmentId === undefined) return notFound("User not found");
    } else {
      // A Department Admin's target is checked entirely against their own
      // real assignments before anything else runs - "doesn't exist,"
      // "exists but has no department," and "exists in a foreign
      // department" all collapse to the same generic 403, so a caller can
      // never learn whether an arbitrary userId is real from a
      // distinguishing status code.
      const email = session?.user?.email;
      const callerId = email ? await getUserIdByEmail(email) : null;
      const administeredIds = callerId ? await getDepartmentAdminDepartmentIds(callerId) : [];
      if (
        targetDepartmentId === undefined ||
        targetDepartmentId === null ||
        !administeredIds.includes(targetDepartmentId)
      ) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    const rows = await listCourseStatusRows({ userId });
    return NextResponse.json({ rows });
  } catch (error) {
    return serverError(error);
  }
}
