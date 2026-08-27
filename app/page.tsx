import Link from "next/link";
import {
  CalendarClock,
  Bell,
  BookOpen,
  Settings,
  ArrowRight,
  ShieldCheck,
  UserPlus,
  CheckCircle2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { courses, currentUser } from "@/lib/mock-data/courses";
import { updates, type UpdateType } from "@/lib/mock-data/updates";

const updateIcon: Record<UpdateType, typeof Bell> = {
  "due-soon": CalendarClock,
  "new-assignment": UserPlus,
  completed: CheckCircle2,
  reminder: Bell,
};

const quickLinks = [
  { href: "/courses", label: "All Courses", icon: BookOpen },
  { href: "/settings", label: "Settings", icon: Settings },
];

export default function HomePage() {
  const activeCourses = courses
    .filter((c) => c.status !== "completed")
    .sort((a, b) => b.progress - a.progress)
    .slice(0, 3);

  const dueSoonCount = courses.filter(
    (c) => c.dueDate && c.status !== "completed"
  ).length;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Welcome back, {currentUser.name.split(" ")[0]}
        </h1>
        <p className="text-sm text-muted-foreground">
          {currentUser.department} &middot; {activeCourses.length} courses in progress
        </p>
      </div>

      {dueSoonCount > 0 && (
        <Card className="border-amber-300 bg-amber-50 dark:bg-amber-950/20">
          <CardContent className="flex items-center gap-3 py-4">
            <CalendarClock className="h-5 w-5 shrink-0 text-amber-600" />
            <p className="text-sm">
              You have <span className="font-medium">{dueSoonCount} courses</span>{" "}
              with upcoming due dates.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {quickLinks.map((link) => {
          const Icon = link.icon;
          return (
            <Link key={link.href} href={link.href}>
              <Card className="transition-shadow hover:shadow-md">
                <CardContent className="flex items-center gap-3 py-4">
                  <Icon className="h-5 w-5 shrink-0 text-primary" />
                  <span className="text-sm font-medium">{link.label}</span>
                  <ArrowRight className="ml-auto h-4 w-4 shrink-0 text-muted-foreground" />
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-medium">Continue Learning</h2>
            <Link href="/courses" className="text-sm text-muted-foreground hover:underline">
              View all &rarr;
            </Link>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {activeCourses.map((course) => (
              <Link key={course.id} href={`/courses/${course.id}`}>
                <Card className="h-full transition-shadow hover:shadow-md">
                  <div className={`h-20 rounded-t-xl ${course.thumbnail}`} />
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
                  <CardContent className="flex flex-col gap-2">
                    <Progress value={course.progress} />
                    <span className="text-xs text-muted-foreground">
                      {course.progress}% complete
                      {course.dueDate ? ` · Due ${course.dueDate}` : ""}
                    </span>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </div>

        <div>
          <h2 className="mb-4 text-lg font-medium">Updates</h2>
          <Card>
            <CardContent className="flex flex-col divide-y py-0">
              {updates.map((update) => {
                const Icon = updateIcon[update.type];
                const content = (
                  <div className="flex items-start gap-3 py-4 first:pt-4 last:pb-4">
                    <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium leading-snug">{update.title}</p>
                      <p className="text-xs text-muted-foreground">{update.description}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{update.date}</p>
                    </div>
                  </div>
                );
                return update.courseId ? (
                  <Link key={update.id} href={`/courses/${update.courseId}`} className="hover:bg-muted/50">
                    {content}
                  </Link>
                ) : (
                  <div key={update.id}>{content}</div>
                );
              })}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
