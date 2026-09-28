import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { UnavailableState } from "@/components/ui/unavailable-state";
import { getDepartmentWithMembers } from "@/lib/db/departments";
import { getDepartmentCompletionStats } from "@/lib/db/department-reporting";
import { DepartmentCoursesClient } from "@/app/(app)/admin/org/departments/[id]/department-courses-client";
import { RosterClient } from "@/app/(app)/admin/org/departments/[id]/roster-client";

export async function DepartmentView({
  departmentIds,
  selectedDepartmentId,
  eligibleUsers,
}: {
  departmentIds: string[];
  selectedDepartmentId: string;
  eligibleUsers: { id: string; email: string; displayName: string; currentDepartmentName: string | null }[];
}) {
  let department, stats;
  try {
    department = await getDepartmentWithMembers(selectedDepartmentId);
    if (!department) notFound();
    stats = await getDepartmentCompletionStats(selectedDepartmentId);
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
          <CardTitle className="text-base">Completion</CardTitle>
        </CardHeader>
        <CardContent className="flex gap-6 text-sm">
          <span>Completed: <span className="font-medium">{stats.completed}%</span></span>
          <span>In progress: <span className="font-medium">{stats.inProgress}%</span></span>
          <span>Not started: <span className="font-medium">{stats.notStarted}%</span></span>
        </CardContent>
      </Card>

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
    </div>
  );
}
