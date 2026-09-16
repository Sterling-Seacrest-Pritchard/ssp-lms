import { NextResponse } from "next/server";
import { getScormLaunchInfo } from "@/lib/scorm/launch-info";
import { getEnrollmentId } from "@/lib/db/enrollments";
import { getUserIdByEmail } from "@/lib/db/users";
import { isAdminRole } from "@/lib/roles";
import { isUuid, notFound, serverError } from "@/lib/api/errors";
import { auth } from "@/auth";

export async function GET(
  _request: Request,
  props: { params: Promise<{ moduleVersionId: string }> }
) {
  try {
    const { moduleVersionId } = await props.params;

    // Reject a non-UUID id BEFORE it reaches Postgres: `uuid = 'garbage'` raises
    // "invalid input syntax for type uuid", which would surface as a 500. The
    // launch page only branches on `status === 404`, so a 500 there makes it
    // build a broken iframe URL instead of calling notFound().
    if (!isUuid(moduleVersionId)) {
      return notFound("Module version not found");
    }

    const info = await getScormLaunchInfo(moduleVersionId);
    if (!info) {
      return notFound("Module version not found");
    }

    // This route had no enrollment check at all before - it only gated on
    // the parent course being published, which any signed-in learner
    // satisfies for any published course. Same check the learner-facing
    // page applies.
    const session = await auth();
    if (!isAdminRole(session?.user?.roles)) {
      const userEmail = session?.user?.email;
      const userId = userEmail ? await getUserIdByEmail(userEmail) : null;
      const enrollmentId = userId ? await getEnrollmentId(userId, info.courseId) : null;
      if (!enrollmentId) {
        return notFound("Module version not found");
      }
    }

    return NextResponse.json(info);
  } catch (error) {
    return serverError(error);
  }
}
