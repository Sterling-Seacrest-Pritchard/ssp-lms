import { notFound } from "next/navigation";
import { courses } from "@/lib/mock-data/courses";
import { VideoPlayer } from "@/components/video/video-player";

export default async function VideoPage(props: PageProps<"/courses/[id]/video/[moduleId]">) {
  const { id, moduleId } = await props.params;
  const course = courses.find((c) => c.id === id);
  const courseModule = course?.modules.find((m) => m.id === moduleId);

  if (!course || !courseModule || courseModule.type !== "video") {
    notFound();
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
