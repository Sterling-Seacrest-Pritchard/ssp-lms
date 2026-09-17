import { NextRequest, NextResponse } from "next/server";
import { createTextModule } from "@/lib/db/text-authoring";
import { badRequest, serverError } from "@/lib/api/errors";

export async function POST(request: NextRequest, props: { params: Promise<{ courseId: string }> }) {
  try {
    const { courseId } = await props.params;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return badRequest("Request body must be valid JSON");
    }
    const { title, body: textBody } = (body ?? {}) as { title?: string; body?: string };
    if (!title) {
      return badRequest("title is required");
    }
    if (!textBody || !textBody.trim()) {
      return badRequest("body is required");
    }
    const { moduleId, moduleVersionId } = await createTextModule(courseId, title, textBody);
    return NextResponse.json({ moduleId, moduleVersionId });
  } catch (error) {
    return serverError(error);
  }
}
