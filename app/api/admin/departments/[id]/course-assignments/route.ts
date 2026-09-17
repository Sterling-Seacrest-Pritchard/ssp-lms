import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { badRequest, isUuid, serverError } from "@/lib/api/errors";
import {
  assignCourseToDepartment,
  listCourseAssignmentsForDepartment,
} from "@/lib/db/department-course-assignments";
import { DuplicateAssignmentError } from "@/lib/db/course-assignments";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!isUuid(id)) {
      return badRequest("id must be a UUID");
    }
    const assignments = await listCourseAssignmentsForDepartment(id);
    return NextResponse.json({ assignments });
  } catch (error) {
    return serverError(error);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!isUuid(id)) {
      return badRequest("id must be a UUID");
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return badRequest("Request body must be valid JSON");
    }
    const { courseId } = (body ?? {}) as { courseId?: string };
    if (!courseId || !isUuid(courseId)) {
      return badRequest("courseId must be a UUID");
    }

    const session = await auth();
    try {
      const result = await assignCourseToDepartment(courseId, id, session?.user?.email ?? null);
      return NextResponse.json(result);
    } catch (error) {
      if (error instanceof DuplicateAssignmentError) {
        return NextResponse.json({ error: error.message }, { status: 409 });
      }
      throw error;
    }
  } catch (error) {
    return serverError(error);
  }
}
