import { NextRequest, NextResponse } from "next/server";
import { badRequest, serverError } from "@/lib/api/errors";
import { beginVideoUpload, FreeTierLimitError, listLibraryVideos } from "@/lib/video/assets";

export async function GET() {
  try {
    const videos = await listLibraryVideos();
    return NextResponse.json({ videos });
  } catch (error) {
    return serverError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
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

    try {
      const upload = await beginVideoUpload(title);
      return NextResponse.json(upload);
    } catch (error) {
      if (error instanceof FreeTierLimitError) {
        return NextResponse.json({ error: error.message }, { status: 409 });
      }
      throw error;
    }
  } catch (error) {
    return serverError(error);
  }
}
