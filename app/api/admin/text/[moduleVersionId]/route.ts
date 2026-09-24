import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { textModuleVersions } from "@/lib/db/schema";
import { updateTextBody } from "@/lib/db/text-authoring";
import { badRequest, notFound, serverError } from "@/lib/api/errors";
import { assertModuleVersionAccess } from "@/lib/api/course-access";

export async function GET(_request: NextRequest, props: { params: Promise<{ moduleVersionId: string }> }) {
  try {
    const { moduleVersionId } = await props.params;
    const denied = await assertModuleVersionAccess(moduleVersionId);
    if (denied) return denied;

    const [textVersion] = await db
      .select()
      .from(textModuleVersions)
      .where(eq(textModuleVersions.moduleVersionId, moduleVersionId));
    if (!textVersion) {
      return notFound("Text module not found");
    }
    return NextResponse.json({ body: textVersion.body });
  } catch (error) {
    return serverError(error);
  }
}

export async function PATCH(request: NextRequest, props: { params: Promise<{ moduleVersionId: string }> }) {
  try {
    const { moduleVersionId } = await props.params;
    const denied = await assertModuleVersionAccess(moduleVersionId);
    if (denied) return denied;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return badRequest("Request body must be valid JSON");
    }
    const { body: textBody } = (body ?? {}) as { body?: string };
    if (!textBody || !textBody.trim()) {
      return badRequest("body is required");
    }
    await updateTextBody(moduleVersionId, textBody);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return serverError(error);
  }
}
