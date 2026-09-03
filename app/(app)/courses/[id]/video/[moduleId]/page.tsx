import { notFound } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { auth } from "@/auth";
import { courses } from "@/lib/mock-data/courses";
import { VideoPlayer } from "@/components/video/video-player";
import { getVideoLaunchInfo } from "@/lib/video/launch-info";
import { getLatestVideoStatus } from "@/lib/video/completion-status";
import { signPlaybackToken } from "@/lib/video/mux-client";
import { MuxVideoPlayer } from "@/components/video/mux-video-player";

export default async function VideoPage(props: PageProps<"/courses/[id]/video/[moduleId]">) {
  const { id, moduleId } = await props.params;
  const course = courses.find((c) => c.id === id);
  const courseModule = course?.modules.find((m) => m.id === moduleId);

  if (!course || !courseModule || courseModule.type !== "video") {
    // Not a mock course/module - fall through to the real (DB-backed) video
    // module. `moduleId` here holds a moduleVersionId, matching the same
    // "param named moduleId but valued as a moduleVersionId" convention
    // already established by the real SCORM route
    // (app/(app)/courses/[id]/scorm/[moduleId]/page.tsx).
    const session = await auth();
    const userId = session?.user?.email;
    if (!userId) {
      notFound();
    }

    const info = await getVideoLaunchInfo(moduleId);
    if (!info) {
      notFound();
    }

    const status = await getLatestVideoStatus(moduleId, userId);
    if (status === "completed") {
      return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-center">
          <CheckCircle2 className="h-10 w-10 text-emerald-600" />
          <p className="text-lg font-medium">Video complete</p>
          <p className="text-sm text-muted-foreground">
            You&apos;ve already completed this video.
          </p>
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
        />
      </div>
    );
  }

  return (
    <VideoPlayer
      courseId={course.id}
      courseTitle={course.title}
      moduleTitle={courseModule.title}
      durationMinutes={courseModule.durationMinutes}
    />
  );
}
