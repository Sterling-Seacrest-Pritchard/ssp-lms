import Link from "next/link";
import { ShieldCheck, CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { courses } from "@/lib/mock-data/courses";
import { listPublishedCourses, type RealCourseSummary } from "@/lib/db/queries";
import { getCourseProgressForLearner } from "@/lib/scorm/course-progress";
import { auth } from "@/auth";

const statusLabel: Record<string, string> = {
  "not-started": "Not started",
  "in-progress": "In progress",
  completed: "Completed",
};

const statusVariant: Record<string, "secondary" | "default" | "outline"> = {
  "not-started": "outline",
  "in-progress": "default",
  completed: "secondary",
};

const THUMBNAIL_ROTATION = [
  "bg-gradient-to-br from-blue-500 to-indigo-600",
  "bg-gradient-to-br from-emerald-500 to-teal-600",
  "bg-gradient-to-br from-violet-500 to-purple-600",
  "bg-gradient-to-br from-rose-500 to-orange-500",
  "bg-gradient-to-br from-amber-500 to-yellow-500",
];

function autoThumbnailFor(courseId: string): string {
  let hash = 0;
  for (const char of courseId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return THUMBNAIL_ROTATION[hash % THUMBNAIL_ROTATION.length];
}

interface RenderableCourse {
  id: string;
  title: string;
  department: string;
  thumbnail: string;
  compliance: boolean;
  dueDate: string | null;
  status: "not-started" | "in-progress" | "completed";
  progress: number;
  moduleCount: number;
}

export default async function CoursesPage() {
  const mockActive = courses.filter((c) => c.status !== "completed");
  const mockFinished = courses.filter((c) => c.status === "completed");

  let realCourses: RenderableCourse[] = [];
  try {
    const session = await auth();
    const userId = session?.user?.email;
    if (userId) {
      const published: RealCourseSummary[] = await listPublishedCourses();
      realCourses = await Promise.all(
        published.map(async (course) => {
          const { status, progress } = await getCourseProgressForLearner(course.id, userId);
          return {
            id: course.id,
            title: course.title,
            department: course.department ?? "General",
            thumbnail: course.thumbnail ?? autoThumbnailFor(course.id),
            compliance: course.compliance,
            dueDate: course.dueDate,
            status,
            progress,
            moduleCount: course.moduleCount,
          };
        })
      );
    }
  } catch {
    // Real courses are additive; if the DB is unreachable, still render the mock sections.
  }

  const realActive = realCourses.filter((c) => c.status !== "completed");
  const realFinished = realCourses.filter((c) => c.status === "completed");
  const active: Array<(typeof courses)[number] | RenderableCourse> = [...mockActive, ...realActive];
  const finished: Array<(typeof courses)[number] | RenderableCourse> = [
    ...mockFinished,
    ...realFinished,
  ];

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">My Courses</h1>
        <p className="text-sm text-muted-foreground">
          {active.length} in progress &middot; {finished.length} finished
        </p>
      </div>

      <div>
        <h2 className="mb-4 text-lg font-medium">Active</h2>
        {active.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing in progress right now — nice work staying caught up.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {active.map((course) => (
              <Link key={course.id} href={`/courses/${course.id}`}>
                <Card className="h-full pt-0 transition-shadow hover:shadow-md">
                  <div className={`h-24 rounded-t-xl ${course.thumbnail}`} />
                  <CardHeader>
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-base leading-snug">{course.title}</CardTitle>
                      {course.compliance && (
                        <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-600" />
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">{course.department}</p>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-3">
                    {"description" in course && (
                      <p className="line-clamp-2 text-sm text-muted-foreground">
                        {course.description}
                      </p>
                    )}
                    <div className="flex items-center justify-between">
                      <Badge variant={statusVariant[course.status]}>
                        {statusLabel[course.status]}
                      </Badge>
                      {course.dueDate && (
                        <span className="text-xs text-muted-foreground">
                          Due {course.dueDate.slice(0, 10)}
                        </span>
                      )}
                    </div>
                    <Progress value={course.progress} />
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>

      <div>
        <h2 className="mb-4 text-lg font-medium">Finished</h2>
        {finished.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing completed yet.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {finished.map((course) => (
              <Link key={course.id} href={`/courses/${course.id}`}>
                <Card className="transition-shadow hover:shadow-md">
                  <CardContent className="flex items-center gap-4 py-4">
                    <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
                    <div className="flex-1">
                      <p className="text-sm font-medium">{course.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {course.department} &middot;{" "}
                        {"modules" in course ? course.modules.length : course.moduleCount} modules
                      </p>
                    </div>
                    {course.compliance && <Badge variant="secondary">Compliance</Badge>}
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
