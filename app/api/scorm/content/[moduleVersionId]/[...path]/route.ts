import { auth } from "@/auth";
import { isAdminRole } from "@/lib/roles";
import { gcsStorage } from "@/lib/storage/gcs";
import { mimeTypeForPath } from "@/lib/scorm/mime-types";
import { getScormLaunchInfo, getScormLaunchInfoForAdmin } from "@/lib/scorm/launch-info";
import { getEnrollmentId } from "@/lib/db/enrollments";
import { getUserIdByEmail } from "@/lib/db/users";
import { isUuid, notFound, serverError } from "@/lib/api/errors";
import { canCallerAccessCourse } from "@/lib/api/course-access";

/**
 * Same-origin content proxy for extracted SCORM packages.
 *
 * The launch harness sets `window.API` on this app's origin. A SCORM 1.2 SCO
 * discovers the LMS runtime by walking up the window/parent hierarchy reading
 * `.API` off each window - which throws a DOMException on a cross-origin frame.
 * Pointing the iframe straight at the Supabase Storage object URL therefore
 * makes `LMSInitialize` impossible. Streaming the files through this route
 * keeps the iframe same-origin with the parent page, and lets the
 * `scorm-packages` bucket stay private (the service-role key never leaves the
 * server).
 */
export async function GET(
  _request: Request,
  props: { params: Promise<{ moduleVersionId: string; path: string[] }> }
) {
  try {
    const { moduleVersionId, path } = await props.params;

    if (!isUuid(moduleVersionId)) {
      return notFound("Module version not found");
    }

    // Gate the package bytes on the parent course being published, exactly as
    // the learner detail page and the launch lookup do: this route is a
    // learner-reachable way to read a draft course's content otherwise.
    // Admins keep the un-gated lookup so the `/admin/scorm-test` harness can
    // still play a module before its course is published.
    const session = await auth();
    const isAdmin = isAdminRole(session?.user?.roles);
    const info = isAdmin
      ? await getScormLaunchInfoForAdmin(moduleVersionId)
      : await getScormLaunchInfo(moduleVersionId);

    if (!info) {
      return notFound("Module version not found");
    }

    // This proxy served the actual package bytes with no enrollment check at
    // all before - only the parent course's publish status. Same check the
    // learner-facing page and the launch-info route apply.
    if (!isAdmin) {
      const userEmail = session?.user?.email;
      const userId = userEmail ? await getUserIdByEmail(userEmail) : null;
      const enrollmentId = userId ? await getEnrollmentId(userId, info.courseId) : null;
      if (!enrollmentId) {
        return notFound("Module version not found");
      }
    } else if (!(await canCallerAccessCourse(info.courseId, session))) {
      // "Admin" isn't a single tier - a Department Admin is still an admin
      // for isAdminRole's purposes, but must not be able to read another
      // department's (or a global) course's package bytes through this
      // proxy. Same ownership check as the /admin/scorm-test page.
      return notFound("Module version not found");
    }

    const segments = path ?? [];
    // Never let a segment walk out of this package's prefix into another
    // module version's files: these segments come straight from the URL.
    if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
      return notFound("File not found");
    }

    const joinedPath = segments.join("/");
    if (!joinedPath) {
      return notFound("File not found");
    }

    const { data, error } = await gcsStorage
      .from("ssp-lms-scorm-packages")
      .download(`${info.gcsPrefix}/${joinedPath}`);

    if (error || !data) {
      return notFound("File not found");
    }

    const bytes = await data.arrayBuffer();

    return new Response(bytes, {
      status: 200,
      headers: {
        "Content-Type": mimeTypeForPath(joinedPath),
        "Content-Length": String(bytes.byteLength),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return serverError(error);
  }
}
