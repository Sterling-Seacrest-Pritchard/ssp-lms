import { NextRequest, NextResponse } from "next/server";
import { badRequest, isUuid, serverError } from "@/lib/api/errors";
import { deleteVideoAsset, renameVideoAsset, VideoInUseError } from "@/lib/video/assets";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ videoAssetId: string }> }
) {
  try {
    const { videoAssetId } = await params;
    if (!isUuid(videoAssetId)) {
      return badRequest("videoAssetId must be a UUID");
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return badRequest("Request body must be valid JSON");
    }
    const { title } = (body ?? {}) as { title?: string };
    if (!title) {
      return badRequest("title is required");
    }

    await renameVideoAsset(videoAssetId, title);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return serverError(error);
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ videoAssetId: string }> }
) {
  try {
    const { videoAssetId } = await params;
    if (!isUuid(videoAssetId)) {
      return badRequest("videoAssetId must be a UUID");
    }

    try {
      await deleteVideoAsset(videoAssetId);
    } catch (error) {
      if (error instanceof VideoInUseError) {
        return NextResponse.json({ error: error.message }, { status: 409 });
      }
      throw error;
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return serverError(error);
  }
}
