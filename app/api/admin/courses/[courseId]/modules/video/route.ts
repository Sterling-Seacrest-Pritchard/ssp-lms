import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { modules, moduleVersions, videoModuleVersions } from "@/lib/db/schema";
import { badRequest, isUuid, serverError } from "@/lib/api/errors";
import { getMuxClient, countMuxAssets, FREE_TIER_ASSET_LIMIT } from "@/lib/video/mux-client";

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
    const { title } = (body ?? {}) as { title?: string };
    if (!title) {
      return badRequest("title is required");
    }

    const existingCount = await countMuxAssets();
    if (existingCount >= FREE_TIER_ASSET_LIMIT) {
      return NextResponse.json(
        {
          error: `Free-tier limit reached (${FREE_TIER_ASSET_LIMIT} stored videos). Remove an existing video before adding another.`,
        },
        { status: 409 }
      );
    }

    const { moduleId, versionId } = await db.transaction(async (tx) => {
      const [courseModule] = await tx
        .insert(modules)
        .values({ courseId, moduleType: "video", title })
        .returning();
      const [version] = await tx
        .insert(moduleVersions)
        .values({ moduleId: courseModule.id, versionNumber: 1, status: "published", publishedAt: new Date() })
        .returning();
      await tx.insert(videoModuleVersions).values({ moduleVersionId: version.id, status: "waiting" });
      await tx.update(modules).set({ currentVersionId: version.id }).where(eq(modules.id, courseModule.id));
      return { moduleId: courseModule.id, versionId: version.id };
    });

    const mux = getMuxClient();
    const upload = await mux.video.uploads.create({
      cors_origin: "*",
      new_asset_settings: {
        playback_policies: ["signed"],
        video_quality: "basic",
      },
    });

    await db
      .update(videoModuleVersions)
      .set({ muxUploadId: upload.id })
      .where(eq(videoModuleVersions.moduleVersionId, versionId));

    return NextResponse.json({ moduleId, moduleVersionId: versionId, uploadUrl: upload.url });
  } catch (error) {
    return serverError(error);
  }
}
