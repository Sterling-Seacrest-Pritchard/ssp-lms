import { notFound } from "next/navigation";
import { canCallerAccessCourse } from "@/lib/api/course-access";
import { QuizEditorClient } from "./quiz-editor-client";

export default async function QuizEditorPage(
  props: PageProps<"/admin/content/builder/[courseId]/quiz/[moduleVersionId]">
) {
  const { courseId, moduleVersionId } = await props.params;
  if (!(await canCallerAccessCourse(courseId))) {
    notFound();
  }
  return <QuizEditorClient courseId={courseId} moduleVersionId={moduleVersionId} />;
}
