import { NextRequest, NextResponse } from "next/server";
import { reorderModules } from "@/lib/db/course-authoring";
import { badRequest, isUuid, serverError } from "@/lib/api/errors";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ courseId: string }> }
) {
  try {
    const { courseId } = await params;
    if (!isUuid(courseId)) {
      return badRequest("courseId must be a UUID");
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return badRequest("Request body must be valid JSON");
    }

    const { moduleIds } = (body ?? {}) as { moduleIds?: unknown };
    if (!Array.isArray(moduleIds) || !moduleIds.every((id) => typeof id === "string")) {
      return badRequest("moduleIds must be an array of strings");
    }

    await reorderModules(courseId, moduleIds);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return serverError(error);
  }
}
