import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { UnavailableState } from "@/components/ui/unavailable-state";
import { getDepartmentWithMembers } from "@/lib/db/departments";
import { type DepartmentCourseBreakdownRow } from "@/lib/db/department-reporting";
import { DepartmentCoursesClient } from "@/app/(app)/admin/org/departments/[id]/department-courses-client";
import { RosterClient } from "@/app/(app)/admin/org/departments/[id]/roster-client";

export async function DepartmentView({
  departmentIds,
  selectedDepartmentId,
  eligibleUsers,
  courseBreakdown,
}: {
  departmentIds: string[];
  selectedDepartmentId: string;
  eligibleUsers: { id: string; email: string; displayName: string; currentDepartmentName: string | null }[];
  courseBreakdown: DepartmentCourseBreakdownRow[];
}) {
  let department;
  try {
    department = await getDepartmentWithMembers(selectedDepartmentId);
    if (!department) notFound();
  } catch {
    return <UnavailableState message="Could not load this department right now. Please try again in a moment." />;
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{department.name}</h1>
        {departmentIds.length > 1 && (
          <div className="mt-2 flex gap-2 text-sm">
            {departmentIds.map((id) => (
              <Link
                key={id}
                href={`/admin/department?dept=${id}`}
                className={id === selectedDepartmentId ? "font-medium underline" : "text-muted-foreground hover:underline"}
              >
                {id === selectedDepartmentId ? department.name : id}
              </Link>
            ))}
          </div>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Users</CardTitle>
        </CardHeader>
        <CardContent>
          <RosterClient
            departmentId={selectedDepartmentId}
            members={department.members}
            eligibleUsers={eligibleUsers}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Courses</CardTitle>
        </CardHeader>
        <CardContent>
          <DepartmentCoursesClient departmentId={selectedDepartmentId} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Course Completion</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Course</TableHead>
                <TableHead className="text-right">Completed</TableHead>
                <TableHead className="text-right">In Progress</TableHead>
                <TableHead className="text-right">Not Started</TableHead>
                <TableHead className="text-right">Overdue</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {courseBreakdown.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                    No course activity yet.
                  </TableCell>
                </TableRow>
              ) : (
                courseBreakdown.map((row) => (
                  <TableRow key={row.courseId}>
                    <TableCell className="font-medium">{row.courseTitle}</TableCell>
                    <TableCell className="text-right">{row.completed}</TableCell>
                    <TableCell className="text-right">{row.inProgress}</TableCell>
                    <TableCell className="text-right">{row.notStarted}</TableCell>
                    <TableCell className="text-right">{row.overdue}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
