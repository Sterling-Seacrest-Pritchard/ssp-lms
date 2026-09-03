import { describe, it, expect, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { courses, modules, moduleVersions, videoModuleVersions } from "@/lib/db/schema";
import { getVideoLaunchInfo, getVideoLaunchInfoForAdmin } from "./launch-info";

describe("video launch-info", () => {
  let courseId: string | undefined;
  let moduleId: string | undefined;
  let versionId: string | undefined;

  afterEach(async () => {
    if (versionId) await db.delete(videoModuleVersions).where(eq(videoModuleVersions.moduleVersionId, versionId));
    if (moduleId) {
      await db.update(modules).set({ currentVersionId: null }).where(eq(modules.id, moduleId));
      if (versionId) await db.delete(moduleVersions).where(eq(moduleVersions.id, versionId));
      await db.delete(modules).where(eq(modules.id, moduleId));
    }
    if (courseId) await db.delete(courses).where(eq(courses.id, courseId));
    courseId = moduleId = versionId = undefined;
  });

  async function seed(courseStatus: string, videoStatus: string) {
    const [course] = await db.insert(courses).values({ code: `LAUNCH-${Date.now()}`, title: "x", status: courseStatus }).returning();
    courseId = course.id;
    const [mod] = await db.insert(modules).values({ courseId: course.id, moduleType: "video", title: "x" }).returning();
    moduleId = mod.id;
    const [version] = await db.insert(moduleVersions).values({ moduleId: mod.id, versionNumber: 1, status: "published", publishedAt: new Date() }).returning();
    versionId = version.id;
    await db.update(modules).set({ currentVersionId: version.id }).where(eq(modules.id, mod.id));
    await db.insert(videoModuleVersions).values({
      moduleVersionId: version.id,
      muxPlaybackId: "test-playback-id",
      durationSeconds: 120,
      status: videoStatus,
    });
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
});
