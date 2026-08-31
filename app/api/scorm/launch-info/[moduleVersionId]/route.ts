import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { scormModuleVersions } from "@/lib/db/schema";

export async function GET(
  _request: Request,
  props: { params: Promise<{ moduleVersionId: string }> }
) {
  const { moduleVersionId } = await props.params;

  const [row] = await db
    .select()
    .from(scormModuleVersions)
    .where(eq(scormModuleVersions.moduleVersionId, moduleVersionId));

  if (!row) {
    return NextResponse.json({ error: "Module version not found" }, { status: 404 });
  }

  return NextResponse.json({ launchUrl: row.launchUrl, gcsPrefix: row.gcsPrefix });
}
