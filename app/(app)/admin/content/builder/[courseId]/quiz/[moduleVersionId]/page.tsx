import { QuizEditorClient } from "./quiz-editor-client";

export default async function QuizEditorPage(
  props: PageProps<"/admin/content/builder/[courseId]/quiz/[moduleVersionId]">
) {
  const { courseId, moduleVersionId } = await props.params;
  return <QuizEditorClient courseId={courseId} moduleVersionId={moduleVersionId} />;
}
