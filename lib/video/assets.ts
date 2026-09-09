import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { modules, moduleVersions, videoAssets, videoModuleVersions } from "@/lib/db/schema";
import { countMuxAssets, FREE_TIER_ASSET_LIMIT, getMuxClient, listAllMuxAssets } from "./mux-client";

export class FreeTierLimitError extends Error {}

/**
 * Start a new video: a pending `video_assets` row plus a Mux direct upload.
 * Shared by both upload entry points (in-course and Video Library) - the
 * only difference between them is what happens with the returned asset id
 * afterward (linked to a module immediately, or left standalone in the
 * Library), not how the upload itself gets created.
 */
export async function beginVideoUpload(title: string): Promise<{ videoAssetId: string; uploadUrl: string }> {
  const existingCount = await countMuxAssets();
  if (existingCount >= FREE_TIER_ASSET_LIMIT) {
    throw new FreeTierLimitError(
      `Free-tier limit reached (${FREE_TIER_ASSET_LIMIT} stored videos). Remove an existing video before adding another.`
    );
  }

  const [asset] = await db.insert(videoAssets).values({ title, status: "waiting" }).returning();

  const mux = getMuxClient();
  const upload = await mux.video.uploads.create({
    cors_origin: "*",
    new_asset_settings: { playback_policies: ["signed"], video_quality: "basic" },
  });

  if (!upload.url) {
    throw new Error("Mux did not return an upload URL for the new direct upload");
  }

  await db.update(videoAssets).set({ muxUploadId: upload.id }).where(eq(videoAssets.id, asset.id));

  return { videoAssetId: asset.id, uploadUrl: upload.url };
}

export interface VideoAssetStatus {
  status: string;
  durationSeconds: number | null;
}

/**
 * Resolve a video_assets row's real Mux status, polling Mux only when the
 * DB doesn't already have a terminal answer cached. Keyed by the asset
 * itself (not a module), so this is the single status-poll implementation
 * for both a fresh in-course upload and a fresh Library upload.
 */
export async function pollVideoAssetStatus(videoAssetId: string): Promise<VideoAssetStatus | null> {
  const [asset] = await db.select().from(videoAssets).where(eq(videoAssets.id, videoAssetId));
  if (!asset) return null;

  if (asset.status === "ready" || asset.status === "errored") {
    return { status: asset.status, durationSeconds: asset.durationSeconds };
  }
  if (!asset.muxUploadId) {
    return { status: asset.status, durationSeconds: null };
  }

  const mux = getMuxClient();
  let muxAssetId: string | null | undefined;
  try {
    const upload = await mux.video.uploads.retrieve(asset.muxUploadId);
    muxAssetId = upload.asset_id;
  } catch {
    // A not-yet-processed or unknown upload id from Mux's side isn't this
    // call's failure to surface - report the DB's current status and let
    // the next poll try again.
    return { status: asset.status, durationSeconds: null };
  }

  if (!muxAssetId) {
    return { status: "waiting", durationSeconds: null };
  }

  const muxAsset = await mux.video.assets.retrieve(muxAssetId);
  if (muxAsset.status === "ready") {
    const playbackId = muxAsset.playback_ids?.[0]?.id ?? null;
    const durationSeconds = muxAsset.duration ? Math.round(muxAsset.duration) : null;
    await db
      .update(videoAssets)
      .set({ muxAssetId, muxPlaybackId: playbackId, durationSeconds, status: "ready", updatedAt: new Date() })
      .where(eq(videoAssets.id, videoAssetId));
    return { status: "ready", durationSeconds };
  }

  if (muxAsset.status === "errored") {
    await db
      .update(videoAssets)
      .set({ muxAssetId, status: "errored", updatedAt: new Date() })
      .where(eq(videoAssets.id, videoAssetId));
    return { status: "errored", durationSeconds: null };
  }

  await db
    .update(videoAssets)
    .set({ muxAssetId, status: "preparing", updatedAt: new Date() })
    .where(eq(videoAssets.id, videoAssetId));
  return { status: "preparing", durationSeconds: null };
}

export interface LibraryVideo {
  id: string;
  title: string;
  status: string;
  durationSeconds: number | null;
  muxPlaybackId: string | null;
  moduleCount: number;
  createdAt: string;
}

/**
 * The Video Library's list, reconciled against Mux's own account: any Mux
 * asset with no matching `video_assets` row (uploaded straight through
 * Mux's dashboard, outside this app) gets one created here so it shows up
 * for review/renaming like anything uploaded through the app.
 */
export async function listLibraryVideos(): Promise<LibraryVideo[]> {
  const muxAssets = await listAllMuxAssets();
  const knownAssets = await db.select().from(videoAssets);
  const knownByMuxId = new Map(knownAssets.filter((a) => a.muxAssetId).map((a) => [a.muxAssetId as string, a]));

  const missing = muxAssets.filter((m) => !knownByMuxId.has(m.id));
  if (missing.length > 0) {
    const inserted = await db
      .insert(videoAssets)
      .values(
        missing.map((m) => ({
          muxAssetId: m.id,
          muxPlaybackId: m.playbackId,
          title: "Untitled Video",
          status: m.status === "ready" ? "ready" : m.status === "errored" ? "errored" : "preparing",
          durationSeconds: m.durationSeconds,
        }))
      )
      .returning();
    for (const row of inserted) knownByMuxId.set(row.muxAssetId as string, row);
  }

  // A video_assets row with no matching Mux asset (upload never completed,
  // or the asset was deleted directly in Mux) still gets listed - its
  // pending/errored status is real information, not something to hide.
  const orphaned = knownAssets.filter((a) => !a.muxAssetId);

  const allRows = [...knownByMuxId.values(), ...orphaned];
  const usageCounts = await db
    .select({ videoAssetId: videoModuleVersions.videoAssetId, count: sql<number>`count(*)::int` })
    .from(videoModuleVersions)
    .where(inArray(videoModuleVersions.videoAssetId, allRows.map((r) => r.id)))
    .groupBy(videoModuleVersions.videoAssetId);
  const usageByAssetId = new Map(usageCounts.map((u) => [u.videoAssetId, u.count]));

  return allRows
    .map((row) => ({
      id: row.id,
      title: row.title,
      status: row.status,
      durationSeconds: row.durationSeconds,
      muxPlaybackId: row.muxPlaybackId,
      moduleCount: usageByAssetId.get(row.id) ?? 0,
      createdAt: row.createdAt.toISOString(),
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function renameVideoAsset(videoAssetId: string, title: string): Promise<void> {
  await db.update(videoAssets).set({ title, updatedAt: new Date() }).where(eq(videoAssets.id, videoAssetId));
}

export class VideoInUseError extends Error {}

/**
 * Only deletable once nothing references it - matches the chosen "stays in
 * the Library" semantics for module removal: since removing a module never
 * deletes the asset, deleting the asset here has to be the one deliberate
 * place that actually can, and only when it's truly unused.
 */
export async function deleteVideoAsset(videoAssetId: string): Promise<void> {
  const [asset] = await db.select().from(videoAssets).where(eq(videoAssets.id, videoAssetId));
  if (!asset) return;

  const [usage] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(videoModuleVersions)
    .where(eq(videoModuleVersions.videoAssetId, videoAssetId));
  if ((usage?.count ?? 0) > 0) {
    throw new VideoInUseError(`This video is used by ${usage.count} module(s). Remove it from those first.`);
  }

  await db.delete(videoAssets).where(eq(videoAssets.id, videoAssetId));

  if (asset.muxAssetId) {
    try {
      await getMuxClient().video.assets.delete(asset.muxAssetId);
    } catch (error) {
      console.error(`deleteVideoAsset: failed to delete Mux asset "${asset.muxAssetId}"; it is now orphaned`, error);
    }
  }
}

/**
 * Attach an existing Library video to a new module in a course - no upload,
 * no Mux call, just a new module/module_version pointing at the already-
 * uploaded asset.
 */
export async function attachExistingVideo(
  courseId: string,
  videoAssetId: string,
  title: string
): Promise<{ moduleId: string; moduleVersionId: string } | null> {
  const [asset] = await db.select().from(videoAssets).where(eq(videoAssets.id, videoAssetId));
  if (!asset) return null;

  return db.transaction(async (tx) => {
    const [courseModule] = await tx
      .insert(modules)
      .values({ courseId, moduleType: "video", title })
      .returning();
    const [version] = await tx
      .insert(moduleVersions)
      .values({ moduleId: courseModule.id, versionNumber: 1, status: "published", publishedAt: new Date() })
      .returning();
    await tx.insert(videoModuleVersions).values({ moduleVersionId: version.id, videoAssetId });
    await tx.update(modules).set({ currentVersionId: version.id }).where(eq(modules.id, courseModule.id));
    return { moduleId: courseModule.id, moduleVersionId: version.id };
  });
}
