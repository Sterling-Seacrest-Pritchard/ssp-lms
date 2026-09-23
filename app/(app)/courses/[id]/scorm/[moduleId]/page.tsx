import { notFound } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { auth } from "@/auth";
import { getScormLaunchInfo } from "@/lib/scorm/launch-info";
import { getLatestLessonStatus } from "@/lib/scorm/completion-status";
import { getUserIdByEmail } from "@/lib/db/users";
import { getEnrollmentId } from "@/lib/db/enrollments";
import { isAdminRole } from "@/lib/roles";
import { ScormPlayer } from "@/components/scorm/scorm-player";
import { ModuleNavBar } from "@/components/course/module-nav-bar";
import { NextModuleButton } from "@/components/course/next-module-button";
import { getAdjacentModules } from "@/lib/db/module-navigation";
import { UnavailableState } from "@/components/ui/unavailable-state";
import { isNextNotFoundError } from "@/lib/utils";

const FINISHED_STATUSES = new Set(["completed", "passed"]);

export default async function LearnerScormPage(
  props: PageProps<"/courses/[id]/scorm/[moduleId]">
) {
  const { id: courseId, moduleId } = await props.params;

  const session = await auth();
  const userEmail = session?.user?.email;
  if (!userEmail) {
    notFound();
  }
  const userId = await getUserIdByEmail(userEmail);
  if (!userId) {
    notFound();
  }

  let info, lessonStatus, next;
  try {
    info = await getScormLaunchInfo(moduleId);
    // Check enrollment against the module's OWN resolved courseId, never the
    // URL's - the URL's courseId and moduleId are both caller-supplied and
    // could belong to different courses entirely.
    if (!info || info.courseId !== courseId) {
      notFound();
    }
    if (!isAdminRole(session.user?.roles)) {
      const enrollmentId = await getEnrollmentId(userId, info.courseId);
      if (!enrollmentId) {
        notFound();
      }
    }

    // A SCORM SCO's own runtime typically refuses to re-initialize once a prior
    // attempt already reached a terminal status ("LMS is already finished"),
    // so relaunching one is a dead end. Show a finished state instead of
    // creating another attempt and loading the content again.
    lessonStatus = await getLatestLessonStatus(moduleId, userId);
    next = (await getAdjacentModules(courseId, moduleId)).next;
  } catch (err) {
    if (isNextNotFoundError(err)) {
      throw err;
    }
    return <UnavailableState message="Could not load this module right now. Please try again in a moment." />;
  }

  if (lessonStatus && FINISHED_STATUSES.has(lessonStatus)) {
    return (
      <div className="flex h-full w-full flex-col gap-3">
        <ModuleNavBar courseId={courseId} isComplete={true} />
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <CheckCircle2 className="h-10 w-10 text-emerald-600" />
          <p className="text-lg font-medium">Module complete</p>
          <p className="text-sm text-muted-foreground">
            You&apos;ve already completed this module.
          </p>
          <NextModuleButton courseId={courseId} next={next} />
        </div>
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
        courseId={courseId}
        next={next}
      />
    </div>
  );
}
