import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { getCourseForBuilder } from "@/lib/db/queries";
import { listDepartments } from "@/lib/db/departments";
import { getUserIdByEmail } from "@/lib/db/users";
import { getDepartmentAdminDepartmentIds } from "@/lib/db/department-admins";
import { isOrgAdmin } from "@/lib/roles";
import { UnavailableState } from "@/components/ui/unavailable-state";
import { isNextNotFoundError } from "@/lib/utils";
import { BuilderClient } from "./builder-client";

export default async function CourseBuilderPage(
  props: PageProps<"/admin/content/builder/[courseId]">
) {
  const { courseId } = await props.params;

  const session = await auth();
  let course;
  let departments;
  const callerIsOrgAdmin = isOrgAdmin(session?.user?.roles);
  try {
    course = await getCourseForBuilder(courseId);
    if (!course) {
      notFound();
    }

    if (!callerIsOrgAdmin) {
      const userId = session?.user?.email ? await getUserIdByEmail(session.user.email) : null;
      const administeredIds = userId ? await getDepartmentAdminDepartmentIds(userId) : [];
      // A Department Admin editing a course outside every department they
      // administer (including a global, departmentId-null course) is the
      // same anti-IDOR shape as the learner module pages' courseId
      // cross-check - never trust the URL alone.
      if (!course.departmentId || !administeredIds.includes(course.departmentId)) {
        notFound();
      }
      const allDepartments = await listDepartments();
      departments = allDepartments.filter((d) => administeredIds.includes(d.id));
    } else {
      departments = await listDepartments();
    }
  } catch (err) {
    if (isNextNotFoundError(err)) {
      throw err;
    }
    return <UnavailableState message="Could not load this course right now. Please try again in a moment." />;
  }

  return <BuilderClient initialCourse={course} departments={departments} isOrgAdminCaller={callerIsOrgAdmin} />;
}
