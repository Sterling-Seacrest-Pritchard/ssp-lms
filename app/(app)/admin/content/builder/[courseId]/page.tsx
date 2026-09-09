import { notFound } from "next/navigation";
import { getCourseForBuilder } from "@/lib/db/queries";
import { listDepartments } from "@/lib/db/departments";
import { UnavailableState } from "@/components/ui/unavailable-state";
import { BuilderClient } from "./builder-client";

export default async function CourseBuilderPage(
  props: PageProps<"/admin/content/builder/[courseId]">
) {
  const { courseId } = await props.params;

  let course;
  let departments;
  try {
    course = await getCourseForBuilder(courseId);
    departments = await listDepartments();
  } catch {
    return <UnavailableState message="Could not load this course right now. Please try again in a moment." />;
  }
  if (!course) {
    notFound();
  }

  return <BuilderClient initialCourse={course} departments={departments} />;
}
