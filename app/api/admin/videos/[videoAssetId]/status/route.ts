import { NextRequest, NextResponse } from "next/server";
import { badRequest, isUuid, notFound, serverError } from "@/lib/api/errors";
import { pollVideoAssetStatus } from "@/lib/video/assets";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ videoAssetId: string }> }
) {
  try {
    const { videoAssetId } = await params;
    if (!isUuid(videoAssetId)) {
      return badRequest("videoAssetId must be a UUID");
    }

    const result = await pollVideoAssetStatus(videoAssetId);
    if (!result) {
      return notFound("Video not found");
    }
    return NextResponse.json(result);
  } catch (error) {
    return serverError(error);
  }
}
