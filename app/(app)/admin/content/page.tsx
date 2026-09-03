"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { courses as mockCourses } from "@/lib/mock-data/courses";
import type { RealCourseSummary } from "@/lib/db/queries";

export default function ContentAuthoringPage() {
  const router = useRouter();
  const [realCourses, setRealCourses] = useState<
    (RealCourseSummary & { status: string })[]
  >([]);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/courses/list")
      .then((res) => (res.ok ? res.json() : { courses: [] }))
      .then((body) => setRealCourses(body.courses ?? []))
      .catch(() => setRealCourses([]));
  }, []);

  async function handleNewCourse() {
    setCreating(true);
    setCreateError(null);
    // Every failure path has to clear `creating`, or the button stays stuck
    // spinning with no way to retry: a non-2xx response, a body that isn't the
    // JSON we expect, and a network error that rejects the fetch outright.
    try {
      const response = await fetch("/api/admin/courses", { method: "POST" });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.courseId) {
        setCreateError(body?.error ?? "Could not create a course");
        setCreating(false);
        return;
      }
      // Left `creating` on deliberately: the navigation away is the success
      // state, and re-enabling the button first invites a double-create.
      router.push(`/admin/content/builder/${body.courseId}`);
    } catch {
      setCreateError("Could not create a course");
      setCreating(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Content Authoring</h1>
          <p className="text-sm text-muted-foreground">
            Build a course from one or more modules — SCORM packages and video placeholders.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <Button onClick={handleNewCourse} disabled={creating}>
            <Plus className="h-4 w-4" />
            {creating ? "Creating…" : "New Course"}
          </Button>
          {createError && <p className="text-sm text-destructive">{createError}</p>}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">All Courses</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Modules</TableHead>
                <TableHead>Compliance</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {realCourses.map((course) => (
                <TableRow key={course.id}>
                  <TableCell className="font-medium">
                    <span className="flex items-center gap-2">
                      {course.title}
                      <Badge variant="secondary" className="text-[10px]">
                        Live
                      </Badge>
                      <Badge
                        variant={course.status === "published" ? "secondary" : "outline"}
                        className="text-[10px]"
                      >
                        {course.status === "published" ? "Published" : "Draft"}
                      </Badge>
                    </span>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {course.department ?? "General"}
                  </TableCell>
                  <TableCell>{course.moduleCount}</TableCell>
                  <TableCell>
                    {course.compliance ? (
                      <Badge variant="secondary">Required</Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Link href={`/admin/content/builder/${course.id}`}>
                      <Button variant="ghost" size="sm">
                        Edit
                      </Button>
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
              {mockCourses.map((course) => (
                <TableRow key={course.id}>
                  <TableCell className="font-medium">{course.title}</TableCell>
                  <TableCell>{course.department}</TableCell>
                  <TableCell>{course.modules.length}</TableCell>
                  <TableCell>
                    {course.compliance ? (
                      <Badge variant="secondary">Required</Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm">
                      Edit
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
