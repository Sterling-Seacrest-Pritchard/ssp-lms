"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface CourseOption {
  id: string;
  title: string;
  code: string;
}

interface DepartmentAssignedCourse {
  courseId: string;
  title: string;
  code: string;
  assignedAt: string;
}

export function DepartmentCoursesClient({ departmentId }: { departmentId: string }) {
  const [assignments, setAssignments] = useState<DepartmentAssignedCourse[] | null>(null);
  const [courses, setCourses] = useState<CourseOption[] | null>(null);
  const [selectedCourseId, setSelectedCourseId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const [assignmentsRes, coursesRes] = await Promise.all([
      fetch(`/api/admin/departments/${departmentId}/course-assignments`),
      fetch("/api/admin/courses/list"),
    ]);
    const assignmentsBody = await assignmentsRes.json();
    const coursesBody = await coursesRes.json();
    setAssignments(assignmentsBody.assignments ?? []);
    setCourses(coursesBody.courses ?? []);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [departmentId]);

  async function handleAssign() {
    if (!selectedCourseId) return;
    setBusy(true);
    setError(null);
    setResult(null);
    const response = await fetch(`/api/admin/departments/${departmentId}/course-assignments`, {
      method: "POST",
      body: JSON.stringify({ courseId: selectedCourseId }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(body.error ?? "Could not assign course");
      setBusy(false);
      return;
    }
    setResult(
      `Assigned to ${body.newlyAssigned} of ${body.memberCount} member${body.memberCount === 1 ? "" : "s"} (the rest already had it).`
    );
    setSelectedCourseId("");
    setBusy(false);
    load();
  }

  async function handleUnassign(courseId: string) {
    setBusy(true);
    setResult(null);
    await fetch(`/api/admin/departments/${departmentId}/course-assignments/${courseId}`, {
      method: "DELETE",
    });
    setBusy(false);
    load();
  }

  const assignedIds = new Set((assignments ?? []).map((a) => a.courseId));
  const availableCourses = (courses ?? []).filter((c) => !assignedIds.has(c.id));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        {assignments === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : assignments.length === 0 ? (
          <p className="text-sm text-muted-foreground">No courses assigned to this department yet.</p>
        ) : (
          assignments.map((a) => (
            <div key={a.courseId} className="flex items-center justify-between rounded-lg border px-3 py-2">
              <span className="text-sm font-medium">{a.title}</span>
              <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => handleUnassign(a.courseId)}>
                Remove
              </Button>
            </div>
          ))
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {result && <p className="text-sm text-muted-foreground">{result}</p>}

      <div className="flex gap-2">
        <select
          className="flex-1 rounded-md border bg-background px-3 py-2 text-sm"
          value={selectedCourseId}
          onChange={(e) => setSelectedCourseId(e.target.value)}
        >
          <option value="">Choose a course…</option>
          {availableCourses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
        <Button type="button" onClick={handleAssign} disabled={!selectedCourseId || busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Assign to Department
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Assigns this course to every current member of the department, and to anyone added to the
        department later. Removing a course here only stops future members from getting it — it
        won&apos;t un-assign it from people who already have it.
      </p>
    </div>
  );
}
