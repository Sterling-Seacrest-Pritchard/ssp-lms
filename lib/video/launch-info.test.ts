import { describe, it, expect, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { courses, modules, moduleVersions, videoAssets, videoModuleVersions } from "@/lib/db/schema";
import {
  getReadyVideoModuleVersionIds,
  getVideoLaunchInfo,
  getVideoLaunchInfoForAdmin,
} from "./launch-info";

describe("video launch-info", () => {
  let courseId: string | undefined;
  let moduleId: string | undefined;
  let versionId: string | undefined;
  let videoAssetId: string | undefined;

  afterEach(async () => {
    if (versionId) await db.delete(videoModuleVersions).where(eq(videoModuleVersions.moduleVersionId, versionId));
    if (videoAssetId) await db.delete(videoAssets).where(eq(videoAssets.id, videoAssetId));
    if (moduleId) {
      await db.update(modules).set({ currentVersionId: null }).where(eq(modules.id, moduleId));
      if (versionId) await db.delete(moduleVersions).where(eq(moduleVersions.id, versionId));
      await db.delete(modules).where(eq(modules.id, moduleId));
    }
    if (courseId) await db.delete(courses).where(eq(courses.id, courseId));
    courseId = moduleId = versionId = videoAssetId = undefined;
  });

  async function seed(courseStatus: string, videoStatus: string) {
    const [course] = await db.insert(courses).values({ code: `LAUNCH-${Date.now()}`, title: "x", status: courseStatus }).returning();
    courseId = course.id;
    const [mod] = await db.insert(modules).values({ courseId: course.id, moduleType: "video", title: "x" }).returning();
    moduleId = mod.id;
    const [version] = await db.insert(moduleVersions).values({ moduleId: mod.id, versionNumber: 1, status: "published", publishedAt: new Date() }).returning();
    versionId = version.id;
    await db.update(modules).set({ currentVersionId: version.id }).where(eq(modules.id, mod.id));
    const [asset] = await db
      .insert(videoAssets)
      .values({
        title: "x",
        muxPlaybackId: "test-playback-id",
        durationSeconds: 120,
        status: videoStatus,
      })
      .returning();
    videoAssetId = asset.id;
    await db.insert(videoModuleVersions).values({ moduleVersionId: version.id, videoAssetId: asset.id });
    return version.id;
  }

  it("returns launch info for a ready video on a published course", async () => {
    const id = await seed("published", "ready");
    const info = await getVideoLaunchInfo(id);
    expect(info).toEqual({ muxPlaybackId: "test-playback-id", durationSeconds: 120 });
  });

  it("returns null for a draft course even if the video is ready", async () => {
    const id = await seed("draft", "ready");
    const info = await getVideoLaunchInfo(id);
    expect(info).toBeNull();
  });

  it("returns null for a not-ready video even on a published course", async () => {
    const id = await seed("published", "preparing");
    const info = await getVideoLaunchInfo(id);
    expect(info).toBeNull();
  });

  it("getVideoLaunchInfoForAdmin ignores course status", async () => {
    const id = await seed("draft", "ready");
    const info = await getVideoLaunchInfoForAdmin(id);
    expect(info).toEqual({ muxPlaybackId: "test-playback-id", durationSeconds: 120 });
  });

  it("returns null for a non-UUID id", async () => {
    const info = await getVideoLaunchInfo("not-a-uuid");
    expect(info).toBeNull();
  });

  describe("getReadyVideoModuleVersionIds", () => {
    it("includes a ready video regardless of the parent course's publish status", async () => {
      const id = await seed("draft", "ready");
      expect(await getReadyVideoModuleVersionIds([id])).toEqual(new Set([id]));
    });

    it("excludes a video that is still processing", async () => {
      const id = await seed("published", "preparing");
      expect(await getReadyVideoModuleVersionIds([id])).toEqual(new Set());
    });

    it("excludes an errored video with no asset - the state Task 1's backfill left placeholders in", async () => {
      const [course] = await db
        .insert(courses)
        .values({ code: `LAUNCH-ERR-${Date.now()}`, title: "x", status: "published" })
        .returning();
      courseId = course.id;
      const [mod] = await db
        .insert(modules)
        .values({ courseId: course.id, moduleType: "video", title: "x" })
        .returning();
      moduleId = mod.id;
      const [version] = await db
        .insert(moduleVersions)
        .values({ moduleId: mod.id, versionNumber: 1, status: "published" })
        .returning();
      versionId = version.id;
      const [asset] = await db.insert(videoAssets).values({ title: "x", status: "errored" }).returning();
      videoAssetId = asset.id;
      await db.insert(videoModuleVersions).values({ moduleVersionId: version.id, videoAssetId: asset.id });

      expect(await getReadyVideoModuleVersionIds([version.id])).toEqual(new Set());
    });

    it("excludes a module version with no video row at all", async () => {
      expect(
        await getReadyVideoModuleVersionIds(["00000000-0000-0000-0000-000000000000"])
      ).toEqual(new Set());
    });

    it("drops non-UUID ids instead of handing them to Postgres, and short-circuits an empty list", async () => {
      expect(await getReadyVideoModuleVersionIds(["not-a-uuid"])).toEqual(new Set());
      expect(await getReadyVideoModuleVersionIds([])).toEqual(new Set());
    });
  });
});
