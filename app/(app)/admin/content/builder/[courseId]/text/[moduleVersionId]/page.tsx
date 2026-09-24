import { notFound } from "next/navigation";
import { canCallerAccessCourse } from "@/lib/api/course-access";
import { TextEditorClient } from "./text-editor-client";

export default async function TextEditorPage(
  props: PageProps<"/admin/content/builder/[courseId]/text/[moduleVersionId]">
) {
  const { courseId, moduleVersionId } = await props.params;
  if (!(await canCallerAccessCourse(courseId))) {
    notFound();
  }
  return <TextEditorClient courseId={courseId} moduleVersionId={moduleVersionId} />;
}
