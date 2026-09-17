import { NextResponse } from "next/server";
import { createDraftCourse } from "@/lib/db/course-authoring";
import { badRequest, serverError } from "@/lib/api/errors";

export async function POST(request: Request) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return badRequest("Request body must be valid JSON");
    }
    const { title } = (body ?? {}) as { title?: string };
    if (!title || !title.trim()) {
      return badRequest("title is required");
    }

    const { id } = await createDraftCourse(title.trim());
    return NextResponse.json({ courseId: id });
  } catch (error) {
    return serverError(error);
  }
}
