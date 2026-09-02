import { NextRequest, NextResponse } from "next/server";
import { publishCourse } from "@/lib/db/course-authoring";
import { badRequest, isUuid, serverError } from "@/lib/api/errors";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ courseId: string }> }
) {
  try {
    const { courseId } = await params;
    if (!isUuid(courseId)) {
      return badRequest("courseId must be a UUID");
    }

    const result = await publishCourse(courseId);
    if ("error" in result) {
      return badRequest(result.error);
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return serverError(error);
  }
}
