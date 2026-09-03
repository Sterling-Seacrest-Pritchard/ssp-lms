import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { modules, videoModuleVersions } from "@/lib/db/schema";
import { badRequest, notFound, serverError, isUuid } from "@/lib/api/errors";
import { getMuxClient } from "@/lib/video/mux-client";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ courseId: string; moduleId: string }> }
) {
  try {
    const { courseId, moduleId } = await params;
    if (!isUuid(courseId) || !isUuid(moduleId)) {
      return badRequest("courseId and moduleId must be UUIDs");
    }

    const [courseModule] = await db
      .select()
      .from(modules)
      .where(and(eq(modules.id, moduleId), eq(modules.courseId, courseId)));
    if (!courseModule || !courseModule.currentVersionId) {
      return notFound("Module not found");
    }

    const [videoRow] = await db
      .select()
      .from(videoModuleVersions)
      .where(eq(videoModuleVersions.moduleVersionId, courseModule.currentVersionId));
    if (!videoRow) {
      return notFound("Video module version not found");
    }

    // Already resolved - no need to call Mux again.
    if (videoRow.status === "ready" || videoRow.status === "errored") {
      return NextResponse.json({ status: videoRow.status, durationSeconds: videoRow.durationSeconds });
    }

    if (!videoRow.muxUploadId) {
      return NextResponse.json({ status: videoRow.status, durationSeconds: null });
    }

    const mux = getMuxClient();
    let assetId: string | null | undefined;
    try {
      const upload = await mux.video.uploads.retrieve(videoRow.muxUploadId);
      assetId = upload.asset_id;
    } catch {
      // A not-yet-processed or unknown upload id from Mux's side is not this
      // route's failure to surface as a 500 - report the DB's current
      // status and let the next poll try again.
      return NextResponse.json({ status: videoRow.status, durationSeconds: null });
    }

    if (!assetId) {
      return NextResponse.json({ status: "waiting", durationSeconds: null });
    }

    const asset = await mux.video.assets.retrieve(assetId);
    if (asset.status === "ready") {
      const playbackId = asset.playback_ids?.[0]?.id ?? null;
      const durationSeconds = asset.duration ? Math.round(asset.duration) : null;
      await db
        .update(videoModuleVersions)
        .set({
          muxAssetId: assetId,
          muxPlaybackId: playbackId,
          durationSeconds,
          status: "ready",
        })
        .where(eq(videoModuleVersions.moduleVersionId, courseModule.currentVersionId));
      return NextResponse.json({ status: "ready", durationSeconds });
    }

    if (asset.status === "errored") {
      await db
        .update(videoModuleVersions)
        .set({ muxAssetId: assetId, status: "errored" })
        .where(eq(videoModuleVersions.moduleVersionId, courseModule.currentVersionId));
      return NextResponse.json({ status: "errored", durationSeconds: null });
    }

    await db
      .update(videoModuleVersions)
      .set({ muxAssetId: assetId, status: "preparing" })
      .where(eq(videoModuleVersions.moduleVersionId, courseModule.currentVersionId));
    return NextResponse.json({ status: "preparing", durationSeconds: null });
  } catch (error) {
    return serverError(error);
  }
}
