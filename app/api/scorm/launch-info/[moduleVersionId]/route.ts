import { NextResponse } from "next/server";
import { getScormLaunchInfo } from "@/lib/scorm/launch-info";
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

    const info = await getScormLaunchInfo(moduleVersionId);
    if (!info) {
      return notFound("Module version not found");
    }

    return NextResponse.json(info);
  } catch (error) {
    return serverError(error);
  }
}
