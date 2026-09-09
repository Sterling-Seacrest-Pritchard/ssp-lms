import { auth } from "@/auth";
import { isAdminRole } from "@/lib/roles";
import { gcsStorage as supabaseStorage } from "@/lib/storage/gcs";
import { mimeTypeForPath } from "@/lib/scorm/mime-types";
import { getScormLaunchInfo, getScormLaunchInfoForAdmin } from "@/lib/scorm/launch-info";
import { isUuid, notFound, serverError } from "@/lib/api/errors";

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
    const info = isAdminRole(session?.user?.roles)
      ? await getScormLaunchInfoForAdmin(moduleVersionId)
      : await getScormLaunchInfo(moduleVersionId);

    if (!info) {
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

    const { data, error } = await supabaseStorage
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
