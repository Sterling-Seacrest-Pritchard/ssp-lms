import { NextResponse } from "next/server";
import { createDraftCourse } from "@/lib/db/course-authoring";
import { serverError } from "@/lib/api/errors";

export async function POST(_request: Request) {
  try {
    const { id } = await createDraftCourse();
    return NextResponse.json({ courseId: id });
  } catch (error) {
    return serverError(error);
  }
}
