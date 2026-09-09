import { NextRequest, NextResponse } from "next/server";
import { badRequest, isUuid, notFound, serverError } from "@/lib/api/errors";
import { attachExistingVideo } from "@/lib/video/assets";

export async function POST(
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
    const { videoAssetId, title } = (body ?? {}) as { videoAssetId?: string; title?: string };
    if (!videoAssetId || !isUuid(videoAssetId)) {
      return badRequest("videoAssetId must be a UUID");
    }
    if (!title) {
      return badRequest("title is required");
    }

    const result = await attachExistingVideo(courseId, videoAssetId, title);
    if (!result) {
      return notFound("Video not found");
    }
    return NextResponse.json(result);
  } catch (error) {
    return serverError(error);
  }
}
