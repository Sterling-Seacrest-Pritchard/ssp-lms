import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { scormModuleVersions } from "@/lib/db/schema";
import { isUuid, notFound, serverError } from "@/lib/api/errors";

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

    const [row] = await db
      .select()
      .from(scormModuleVersions)
      .where(eq(scormModuleVersions.moduleVersionId, moduleVersionId));

    if (!row) {
      return notFound("Module version not found");
    }

    return NextResponse.json({ launchUrl: row.launchUrl, gcsPrefix: row.gcsPrefix });
  } catch (error) {
    return serverError(error);
  }
}
