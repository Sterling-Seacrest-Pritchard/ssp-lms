import Link from "next/link";
import { ShieldCheck, CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { courses } from "@/lib/mock-data/courses";

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

export default function CoursesPage() {
  const active = courses.filter((c) => c.status !== "completed");
  const finished = courses.filter((c) => c.status === "completed");

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
                <Card className="h-full transition-shadow hover:shadow-md">
                  <div className={`h-24 rounded-t-xl ${course.thumbnail}`} />
                  <CardHeader>
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-base leading-snug">
                        {course.title}
                      </CardTitle>
                      {course.compliance && (
                        <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-600" />
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">{course.department}</p>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-3">
                    <p className="line-clamp-2 text-sm text-muted-foreground">
                      {course.description}
                    </p>
                    <div className="flex items-center justify-between">
                      <Badge variant={statusVariant[course.status]}>
                        {statusLabel[course.status]}
                      </Badge>
                      {course.dueDate && (
                        <span className="text-xs text-muted-foreground">
                          Due {course.dueDate}
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
                        {course.department} &middot; {course.modules.length} modules
                      </p>
                    </div>
                    {course.compliance && (
                      <Badge variant="secondary">Compliance</Badge>
                    )}
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
