import { TextEditorClient } from "./text-editor-client";

export default async function TextEditorPage(
  props: PageProps<"/admin/content/builder/[courseId]/text/[moduleVersionId]">
) {
  const { courseId, moduleVersionId } = await props.params;
  return <TextEditorClient courseId={courseId} moduleVersionId={moduleVersionId} />;
}
