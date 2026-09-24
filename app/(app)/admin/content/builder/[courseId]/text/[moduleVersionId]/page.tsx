import { notFound } from "next/navigation";
import { getModuleVersionCourseId } from "@/lib/db/modules";
import { canCallerAccessCourse } from "@/lib/api/course-access";
import { TextEditorClient } from "./text-editor-client";

export default async function TextEditorPage(
  props: PageProps<"/admin/content/builder/[courseId]/text/[moduleVersionId]">
) {
  const { courseId, moduleVersionId } = await props.params;
  // Resolve the module version's REAL parent course ourselves - never trust
  // the URL's courseId path param, which a Department Admin could set to
  // their own course while pointing moduleVersionId at a foreign one.
  const realCourseId = await getModuleVersionCourseId(moduleVersionId);
  if (!realCourseId || !(await canCallerAccessCourse(realCourseId))) {
    notFound();
  }
  return <TextEditorClient courseId={courseId} moduleVersionId={moduleVersionId} />;
}
