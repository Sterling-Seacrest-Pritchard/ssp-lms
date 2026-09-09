import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { courses, modules, moduleVersions, videoAssets, videoModuleVersions } from "@/lib/db/schema";
import { isUuid } from "@/lib/api/errors";

export interface VideoLaunchInfo {
  muxPlaybackId: string;
  durationSeconds: number;
}

interface VideoLaunchInfoRow extends VideoLaunchInfo {
  courseStatus: string;
  videoStatus: string;
}

/**
 * Resolve a module version to its Mux playback details, WITHOUT checking the
 * parent course's publish status. Admin-only surfaces use this - never call
 * it from a learner-facing surface, use `getVideoLaunchInfo` there. Mirrors
 * `lib/scorm/launch-info.ts`'s identical split.
 */
export async function getVideoLaunchInfoForAdmin(
  moduleVersionId: string
): Promise<VideoLaunchInfo | null> {
  const row = await loadLaunchInfoRow(moduleVersionId);
  if (!row) return null;
  return { muxPlaybackId: row.muxPlaybackId, durationSeconds: row.durationSeconds };
}

/**
 * Resolve a module version to its Mux playback details, for a learner.
 * Returns null unless the parent course is published AND the asset is
 * ready - an unfinished upload is not launchable even on a published
 * course.
 */
export async function getVideoLaunchInfo(
  moduleVersionId: string
): Promise<VideoLaunchInfo | null> {
  const row = await loadLaunchInfoRow(moduleVersionId);
  if (!row || row.courseStatus !== "published" || row.videoStatus !== "ready") return null;
  return { muxPlaybackId: row.muxPlaybackId, durationSeconds: row.durationSeconds };
}

/**
 * Of the given module version ids, the subset whose Mux asset is actually
 * playable - i.e. the ones that would satisfy `getVideoLaunchInfo`'s
 * asset-side checks (`status === "ready"`, with a real playback id and
 * duration). One query for the whole batch, so a course page doesn't fan out
 * per module.
 *
 * The parent course's publish status is deliberately NOT checked here:
 * callers use this to decide whether a video module *inside an already
 * resolved course* is launchable/tracked, and they've already established
 * that course's visibility. Learner surfaces that resolve a single module
 * from a URL must still go through `getVideoLaunchInfo`, which does check it.
 */
export async function getReadyVideoModuleVersionIds(
  moduleVersionIds: string[]
): Promise<Set<string>> {
  const ids = moduleVersionIds.filter(isUuid);
  if (ids.length === 0) return new Set();

  const rows = await db
    .select({ moduleVersionId: videoModuleVersions.moduleVersionId })
    .from(videoModuleVersions)
    .innerJoin(videoAssets, eq(videoAssets.id, videoModuleVersions.videoAssetId))
    .where(
      and(
        inArray(videoModuleVersions.moduleVersionId, ids),
        eq(videoAssets.status, "ready"),
        isNotNull(videoAssets.muxPlaybackId),
        isNotNull(videoAssets.durationSeconds)
      )
    );

  return new Set(rows.map((r) => r.moduleVersionId));
}

async function loadLaunchInfoRow(moduleVersionId: string): Promise<VideoLaunchInfoRow | null> {
  if (!isUuid(moduleVersionId)) return null;

  const [row] = await db
    .select({
      muxPlaybackId: videoAssets.muxPlaybackId,
      durationSeconds: videoAssets.durationSeconds,
      videoStatus: videoAssets.status,
      courseStatus: courses.status,
    })
    .from(videoModuleVersions)
    .innerJoin(videoAssets, eq(videoAssets.id, videoModuleVersions.videoAssetId))
    .innerJoin(moduleVersions, eq(moduleVersions.id, videoModuleVersions.moduleVersionId))
    .innerJoin(modules, eq(modules.id, moduleVersions.moduleId))
    .innerJoin(courses, eq(courses.id, modules.courseId))
    .where(eq(videoModuleVersions.moduleVersionId, moduleVersionId));

  if (!row || !row.muxPlaybackId || row.durationSeconds === null) return null;
  return {
    muxPlaybackId: row.muxPlaybackId,
    durationSeconds: row.durationSeconds,
    videoStatus: row.videoStatus,
    courseStatus: row.courseStatus,
  };
}
