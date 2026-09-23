import { notFound } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { auth } from "@/auth";
import { getVideoLaunchInfo } from "@/lib/video/launch-info";
import { getLatestVideoStatus } from "@/lib/video/completion-status";
import { getUserIdByEmail } from "@/lib/db/users";
import { getEnrollmentId } from "@/lib/db/enrollments";
import { signPlaybackToken } from "@/lib/video/mux-client";
import { MuxVideoPlayer } from "@/components/video/mux-video-player";
import { ModuleNavBar } from "@/components/course/module-nav-bar";
import { NextModuleButton } from "@/components/course/next-module-button";
import { getAdjacentModules } from "@/lib/db/module-navigation";
import { isAdminRole } from "@/lib/roles";
import { UnavailableState } from "@/components/ui/unavailable-state";
import { isNextNotFoundError } from "@/lib/utils";

export default async function VideoPage(props: PageProps<"/courses/[id]/video/[moduleId]">) {
  const { id, moduleId } = await props.params;

  // `moduleId` here holds a moduleVersionId, matching the same "param named
  // moduleId but valued as a moduleVersionId" convention already established
  // by the real SCORM route (app/(app)/courses/[id]/scorm/[moduleId]/page.tsx).
  const session = await auth();
  const userEmail = session?.user?.email;
  if (!userEmail) {
    notFound();
  }
  const userId = await getUserIdByEmail(userEmail);
  if (!userId) {
    notFound();
  }

  try {
    const info = await getVideoLaunchInfo(moduleId);
    // Check enrollment against the module's OWN resolved courseId, never
    // the URL's - the URL's course id and moduleId are both
    // caller-supplied and could belong to different courses entirely.
    if (!info || info.courseId !== id) {
      notFound();
    }
    if (!isAdminRole(session?.user?.roles)) {
      const enrollmentId = await getEnrollmentId(userId, info.courseId);
      if (!enrollmentId) {
        notFound();
      }
    }

    const { next } = await getAdjacentModules(id, moduleId);

    const status = await getLatestVideoStatus(moduleId, userId);
    if (status === "completed") {
      return (
        <div className="flex h-full w-full flex-col gap-3">
          <ModuleNavBar courseId={id} isComplete={true} />
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <CheckCircle2 className="h-10 w-10 text-emerald-600" />
            <p className="text-lg font-medium">Video complete</p>
            <p className="text-sm text-muted-foreground">
              You&apos;ve already completed this video.
            </p>
            <NextModuleButton courseId={id} next={next} />
          </div>
        </div>
      );
    }

    const token = await signPlaybackToken(info.muxPlaybackId);

    return (
      <div className="flex h-full w-full flex-col gap-4">
        <MuxVideoPlayer
          playbackId={info.muxPlaybackId}
          playbackToken={token}
          durationSeconds={info.durationSeconds}
          moduleVersionId={moduleId}
          initialFurthestWatchedSeconds={0}
          courseId={id}
          next={next}
        />
      </div>
    );
  } catch (err) {
    if (isNextNotFoundError(err)) {
      throw err;
    }
    return <UnavailableState message="Could not load this video right now. Please try again in a moment." />;
  }
}
