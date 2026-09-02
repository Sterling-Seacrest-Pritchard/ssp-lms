import { notFound } from "next/navigation";
import { getCourseForBuilder } from "@/lib/db/queries";
import { BuilderClient } from "./builder-client";

export default async function CourseBuilderPage(
  props: PageProps<"/admin/content/builder/[courseId]">
) {
  const { courseId } = await props.params;
  const course = await getCourseForBuilder(courseId);
  if (!course) {
    notFound();
  }

  return <BuilderClient initialCourse={course} />;
}
