import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createDraftCourse } from "@/lib/db/course-authoring";
import { badRequest, serverError } from "@/lib/api/errors";
import { resolveCourseCreationDepartmentId } from "@/lib/api/course-access";

export async function POST(request: Request) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return badRequest("Request body must be valid JSON");
    }
    const { title, departmentId: requestedDepartmentId } = (body ?? {}) as {
      title?: string;
      departmentId?: string;
    };
    if (!title || !title.trim()) {
      return badRequest("title is required");
    }

    const session = await auth();
    const scoped = await resolveCourseCreationDepartmentId(session, requestedDepartmentId ?? null);
    if ("error" in scoped) {
      return badRequest(scoped.error);
    }

    const { id } = await createDraftCourse(title.trim(), scoped.departmentId);
    return NextResponse.json({ courseId: id });
  } catch (error) {
    return serverError(error);
  }
}
