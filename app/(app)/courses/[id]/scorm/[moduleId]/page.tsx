import { notFound } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { auth } from "@/auth";
import { getScormLaunchInfo } from "@/lib/scorm/launch-info";
import { getLatestLessonStatus } from "@/lib/scorm/completion-status";
import { ScormPlayer } from "@/components/scorm/scorm-player";

const FINISHED_STATUSES = new Set(["completed", "passed"]);

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

  // A SCORM SCO's own runtime typically refuses to re-initialize once a prior
  // attempt already reached a terminal status ("LMS is already finished"),
  // so relaunching one is a dead end. Show a finished state instead of
  // creating another attempt and loading the content again.
  const lessonStatus = await getLatestLessonStatus(moduleId, userId);
  if (lessonStatus && FINISHED_STATUSES.has(lessonStatus)) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-center">
        <CheckCircle2 className="h-10 w-10 text-emerald-600" />
        <p className="text-lg font-medium">Module complete</p>
        <p className="text-sm text-muted-foreground">
          You&apos;ve already completed this module.
        </p>
      </div>
    );
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
