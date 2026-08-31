import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { scormModuleVersions } from "@/lib/db/schema";
import { supabaseStorage } from "@/lib/storage/supabase";
import { mimeTypeForPath } from "@/lib/scorm/mime-types";
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

    const [row] = await db
      .select()
      .from(scormModuleVersions)
      .where(eq(scormModuleVersions.moduleVersionId, moduleVersionId));

    if (!row) {
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
      .from("scorm-packages")
      .download(`${row.gcsPrefix}/${joinedPath}`);

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
