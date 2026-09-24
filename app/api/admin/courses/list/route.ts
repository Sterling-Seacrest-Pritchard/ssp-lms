import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { listRealCourses, getCourseForBuilder } from "@/lib/db/queries";
import { getUserIdByEmail } from "@/lib/db/users";
import { getDepartmentAdminDepartmentIds } from "@/lib/db/department-admins";
import { isOrgAdmin } from "@/lib/roles";
import { serverError } from "@/lib/api/errors";

export async function GET() {
  try {
    const session = await auth();
    let departmentIds: string[] | undefined;
    if (!isOrgAdmin(session?.user?.roles)) {
      const userId = session?.user?.email ? await getUserIdByEmail(session.user.email) : null;
      departmentIds = userId ? await getDepartmentAdminDepartmentIds(userId) : [];
    }

    const summaries = await listRealCourses(departmentIds);
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
