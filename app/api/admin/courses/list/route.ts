import { NextResponse } from "next/server";
import { listRealCourses, getCourseForBuilder } from "@/lib/db/queries";
import { serverError } from "@/lib/api/errors";

export async function GET() {
  try {
    const summaries = await listRealCourses();
    const withStatus = await Promise.all(
      summaries.map(async (course) => {
        const detail = await getCourseForBuilder(course.id);
        return { ...course, status: detail?.status ?? "draft" };
      })
    );
    return NextResponse.json({ courses: withStatus });
  } catch (error) {
    return serverError(error);
  }
}
