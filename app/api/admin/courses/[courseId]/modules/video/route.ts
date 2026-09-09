import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { modules, moduleVersions, videoModuleVersions } from "@/lib/db/schema";
import { badRequest, isUuid, serverError } from "@/lib/api/errors";
import { beginVideoUpload, FreeTierLimitError } from "@/lib/video/assets";

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

    let upload: { videoAssetId: string; uploadUrl: string };
    try {
      upload = await beginVideoUpload(title);
    } catch (error) {
      if (error instanceof FreeTierLimitError) {
        return NextResponse.json({ error: error.message }, { status: 409 });
      }
      throw error;
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
      await tx
        .insert(videoModuleVersions)
        .values({ moduleVersionId: version.id, videoAssetId: upload.videoAssetId });
      await tx.update(modules).set({ currentVersionId: version.id }).where(eq(modules.id, courseModule.id));
      return { moduleId: courseModule.id, versionId: version.id };
    });

    return NextResponse.json({
      moduleId,
      moduleVersionId: versionId,
      videoAssetId: upload.videoAssetId,
      uploadUrl: upload.uploadUrl,
    });
  } catch (error) {
    return serverError(error);
  }
}
