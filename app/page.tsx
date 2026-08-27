import Link from "next/link";
import { CalendarClock, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { courses, currentUser } from "@/lib/mock-data/courses";

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

export default function LearnerDashboard() {
  const dueSoon = courses.filter((c) => c.dueDate && c.status !== "completed");

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Welcome back, {currentUser.name.split(" ")[0]}
        </h1>
        <p className="text-sm text-muted-foreground">
          {currentUser.department} &middot; {courses.length} assigned courses
        </p>
      </div>

      {dueSoon.length > 0 && (
        <Card className="border-amber-300 bg-amber-50 dark:bg-amber-950/20">
          <CardContent className="flex items-center gap-3 py-4">
            <CalendarClock className="h-5 w-5 shrink-0 text-amber-600" />
            <p className="text-sm">
              You have <span className="font-medium">{dueSoon.length} courses</span>{" "}
              with upcoming due dates.
            </p>
          </CardContent>
        </Card>
      )}

      <div>
        <h2 className="mb-4 text-lg font-medium">My Courses</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {courses.map((course) => (
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
      </div>
    </div>
  );
}
