import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { courses, modules, moduleVersions, videoModuleVersions } from "@/lib/db/schema";
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

async function loadLaunchInfoRow(moduleVersionId: string): Promise<VideoLaunchInfoRow | null> {
  if (!isUuid(moduleVersionId)) return null;

  const [row] = await db
    .select({
      muxPlaybackId: videoModuleVersions.muxPlaybackId,
      durationSeconds: videoModuleVersions.durationSeconds,
      videoStatus: videoModuleVersions.status,
      courseStatus: courses.status,
    })
    .from(videoModuleVersions)
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
