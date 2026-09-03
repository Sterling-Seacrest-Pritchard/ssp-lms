import { notFound } from "next/navigation";
import { getCourseForBuilder } from "@/lib/db/queries";
import { UnavailableState } from "@/components/ui/unavailable-state";
import { BuilderClient } from "./builder-client";

export default async function CourseBuilderPage(
  props: PageProps<"/admin/content/builder/[courseId]">
) {
  const { courseId } = await props.params;

  let course;
  try {
    course = await getCourseForBuilder(courseId);
  } catch {
    return <UnavailableState message="Could not load this course right now. Please try again in a moment." />;
  }
  if (!course) {
    notFound();
  }

  return <BuilderClient initialCourse={course} />;
}
