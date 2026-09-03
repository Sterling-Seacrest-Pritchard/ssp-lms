import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, Circle, PlayCircle, FileText, HelpCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { courses } from "@/lib/mock-data/courses";
import { getRealCourseDetail } from "@/lib/db/queries";
import { getLatestLessonStatus } from "@/lib/scorm/completion-status";
import { getLatestVideoStatus } from "@/lib/video/completion-status";
import { getTrackedModuleVersionIds } from "@/lib/scorm/course-progress";
import { auth } from "@/auth";

const moduleIcon = {
  video: PlayCircle,
  reading: FileText,
  quiz: HelpCircle,
};

export default async function CourseDetailPage(props: PageProps<"/courses/[id]">) {
  const { id } = await props.params;
  const course = courses.find((c) => c.id === id);

  if (!course) {
    const realCourse = await getRealCourseDetail(id);
    if (!realCourse) {
      notFound();
    }

    const session = await auth();
    const userId = session?.user?.email;

    // A module is only launchable if it has a player AND something to play.
    // For video that means the Mux asset is actually `ready` - one still
    // uploading/processing, or `errored`, has no playable video, so it is
    // shown as not-yet-available and kept out of the progress fraction:
    // counting it would pin this course below 100% forever. Resolved for the
    // whole course in one query, and it is the same rule
    // `getCourseProgressForLearner` applies to the course list card.
    const trackedIds = await getTrackedModuleVersionIds(realCourse.modules);

    const modulesWithStatus = await Promise.all(
      realCourse.modules.map(async (module) => {
        const launchable = trackedIds.has(module.moduleVersionId);
        // Video and SCORM report completion differently: video's only
        // finished status is "completed", while SCORM also treats "passed"
        // as finished. Mirrors the same per-type split already used by
        // `isModuleFinishedForUser` in lib/scorm/course-progress.ts.
        let done = false;
        if (userId && launchable) {
          if (module.moduleType === "video") {
            const videoStatus = await getLatestVideoStatus(module.moduleVersionId, userId);
            done = videoStatus === "completed";
          } else {
            const lessonStatus = await getLatestLessonStatus(module.moduleVersionId, userId);
            done = lessonStatus === "completed" || lessonStatus === "passed";
          }
        }
        return {
          ...module,
          launchable,
          done,
        };
      })
    );
    const trackedModules = modulesWithStatus.filter((m) => m.launchable);
    const completedCount = trackedModules.filter((m) => m.done).length;
    const progress =
      trackedModules.length === 0
        ? 0
        : Math.round((completedCount / trackedModules.length) * 100);

    return (
      <div className="mx-auto flex max-w-4xl flex-col gap-6">
        <div>
          <Link href="/courses" className="text-sm text-muted-foreground hover:underline">
            &larr; Back to Courses
          </Link>
          <div className={`mt-4 h-32 rounded-xl ${realCourse.thumbnail ?? "bg-gradient-to-br from-blue-500 to-indigo-600"}`} />
          <div className="mt-4 flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">{realCourse.title}</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {realCourse.department ?? "General"}
                {realCourse.dueDate && ` · Due ${realCourse.dueDate.slice(0, 10)}`}
              </p>
            </div>
            {realCourse.compliance && <Badge variant="secondary">Compliance required</Badge>}
          </div>
          <div className="mt-4 flex items-center gap-3">
            <Progress value={progress} className="flex-1" />
            <span className="text-sm font-medium">{progress}%</span>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Modules</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col divide-y">
            {modulesWithStatus.length === 0 ? (
              <p className="py-3 text-sm text-muted-foreground">
                This course has no published modules yet.
              </p>
            ) : (
              modulesWithStatus.map((module) => (
                <div
                  key={module.id}
                  className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
                >
                  {module.done ? (
                    <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
                  ) : (
                    <Circle className="h-5 w-5 shrink-0 text-muted-foreground" />
                  )}
                  {!module.launchable && (
                    <PlayCircle className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  <div className="flex-1">
                    <p className="text-sm font-medium">{module.title}</p>
                    {!module.launchable && (
                      <p className="text-xs text-muted-foreground">
                        Video module &middot; not available yet
                      </p>
                    )}
                  </div>
                  {module.launchable ? (
                    <Link
                      href={
                        module.moduleType === "video"
                          ? `/courses/${realCourse.id}/video/${module.moduleVersionId}`
                          : `/courses/${realCourse.id}/scorm/${module.moduleVersionId}`
                      }
                    >
                      <Button variant={module.done ? "outline" : "default"} size="sm">
                        {module.done ? "Review" : "Start"}
                      </Button>
                    </Link>
                  ) : (
                    <Button variant="outline" size="sm" disabled>
                      Coming soon
                    </Button>
                  )}
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div>
        <Link href="/courses" className="text-sm text-muted-foreground hover:underline">
          &larr; Back to Courses
        </Link>
        <div className={`mt-4 h-32 rounded-xl ${course.thumbnail}`} />
        <div className="mt-4 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{course.title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {course.department} {course.dueDate && `· Due ${course.dueDate}`}
            </p>
          </div>
          {course.compliance && <Badge variant="secondary">Compliance required</Badge>}
        </div>
        <p className="mt-3 text-sm text-muted-foreground">{course.description}</p>
        <div className="mt-4 flex items-center gap-3">
          <Progress value={course.progress} className="flex-1" />
          <span className="text-sm font-medium">{course.progress}%</span>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Modules</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col divide-y">
          {course.modules.map((module) => {
            const Icon = moduleIcon[module.type];
            const done = module.status === "completed";
            return (
              <div key={module.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                {done ? (
                  <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
                ) : (
                  <Circle className="h-5 w-5 shrink-0 text-muted-foreground" />
                )}
                <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="flex-1">
                  <p className="text-sm font-medium">{module.title}</p>
                  <p className="text-xs text-muted-foreground capitalize">
                    {module.type} &middot; {module.durationMinutes} min
                  </p>
                </div>
                {module.type === "quiz" || module.type === "video" ? (
                  <Link
                    href={`/courses/${course.id}/${module.type}/${module.id}`}
                  >
                    <Button variant={done ? "outline" : "default"} size="sm">
                      {done ? "Review" : module.status === "in-progress" ? "Continue" : "Start"}
                    </Button>
                  </Link>
                ) : (
                  <Button variant={done ? "outline" : "default"} size="sm">
                    {done ? "Review" : module.status === "in-progress" ? "Continue" : "Start"}
                  </Button>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
