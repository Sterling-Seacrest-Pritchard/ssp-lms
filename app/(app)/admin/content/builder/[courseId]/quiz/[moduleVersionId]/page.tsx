import { notFound } from "next/navigation";
import { getModuleVersionCourseId } from "@/lib/db/modules";
import { canCallerAccessCourse } from "@/lib/api/course-access";
import { QuizEditorClient } from "./quiz-editor-client";

export default async function QuizEditorPage(
  props: PageProps<"/admin/content/builder/[courseId]/quiz/[moduleVersionId]">
) {
  const { courseId, moduleVersionId } = await props.params;
  // Resolve the module version's REAL parent course ourselves - never trust
  // the URL's courseId path param, which a Department Admin could set to
  // their own course while pointing moduleVersionId at a foreign one.
  const realCourseId = await getModuleVersionCourseId(moduleVersionId);
  if (!realCourseId || !(await canCallerAccessCourse(realCourseId))) {
    notFound();
  }
  return <QuizEditorClient courseId={courseId} moduleVersionId={moduleVersionId} />;
}
