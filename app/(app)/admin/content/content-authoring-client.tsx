"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { RealCourseSummary } from "@/lib/db/queries";

export function ContentAuthoringClient({
  administeredDepartments,
}: {
  administeredDepartments: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [realCourses, setRealCourses] = useState<
    (RealCourseSummary & { status: string })[]
  >([]);
  const [newCourseOpen, setNewCourseOpen] = useState(false);
  const [newCourseTitle, setNewCourseTitle] = useState("");
  const [newCourseDepartmentId, setNewCourseDepartmentId] = useState<string>(
    administeredDepartments[0]?.id ?? ""
  );
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const showDepartmentPicker = administeredDepartments.length >= 2;

  useEffect(() => {
    fetch("/api/admin/courses/list")
      .then((res) => (res.ok ? res.json() : { courses: [] }))
      .then((body) => setRealCourses(body.courses ?? []))
      .catch(() => setRealCourses([]));
  }, []);

  async function handleNewCourse(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);
    // Every failure path has to clear `creating`, or the button stays stuck
    // spinning with no way to retry: a non-2xx response, a body that isn't the
    // JSON we expect, and a network error that rejects the fetch outright.
    try {
      const response = await fetch("/api/admin/courses", {
        method: "POST",
        body: JSON.stringify({
          title: newCourseTitle,
          ...(showDepartmentPicker ? { departmentId: newCourseDepartmentId } : {}),
        }),
      });
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
          <Dialog open={newCourseOpen} onOpenChange={setNewCourseOpen}>
            <DialogTrigger
              render={
                <Button type="button">
                  <Plus className="h-4 w-4" />
                  New Course
                </Button>
              }
            />
            <DialogContent>
              <DialogHeader>
                <DialogTitle>New Course</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleNewCourse} className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="new-course-title">Course title</Label>
                  <Input
                    id="new-course-title"
                    value={newCourseTitle}
                    onChange={(e) => setNewCourseTitle(e.target.value)}
                    required
                    autoFocus
                  />
                </div>
                {showDepartmentPicker && (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="new-course-department">Department</Label>
                    <Select
                      value={newCourseDepartmentId}
                      items={administeredDepartments.map((dept) => ({ value: dept.id, label: dept.name }))}
                      onValueChange={(value) => setNewCourseDepartmentId(value as string)}
                    >
                      <SelectTrigger id="new-course-department" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {administeredDepartments.map((dept) => (
                          <SelectItem key={dept.id} value={dept.id}>
                            {dept.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {createError && <p className="text-sm text-destructive">{createError}</p>}
                <Button type="submit" disabled={creating}>
                  {creating ? "Creating…" : "Create Course"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
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
              {realCourses.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                    No courses yet — create one to get started.
                  </TableCell>
                </TableRow>
              )}
              {realCourses.map((course) => (
                <TableRow key={course.id}>
                  <TableCell className="font-medium">
                    <span className="flex items-center gap-2">
                      {course.title}
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
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
