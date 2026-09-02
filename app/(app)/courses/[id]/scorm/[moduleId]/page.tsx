import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { getScormLaunchInfo } from "@/lib/scorm/launch-info";
import { ScormPlayer } from "@/components/scorm/scorm-player";

export default async function LearnerScormPage(
  props: PageProps<"/courses/[id]/scorm/[moduleId]">
) {
  const { moduleId } = await props.params;

  const session = await auth();
  const userId = session?.user?.email;
  if (!userId) {
    notFound();
  }

  const info = await getScormLaunchInfo(moduleId);
  if (!info) {
    notFound();
  }

  const contentUrl = `/api/scorm/content/${moduleId}/${info.launchUrl}`;

  return (
    <div className="flex h-full w-full flex-col gap-4">
      <ScormPlayer
        moduleVersionId={moduleId}
        contentUrl={contentUrl}
        scormVersion={info.scormVersion}
        userId={userId}
      />
    </div>
  );
}
