import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { getUserIdByEmail } from "@/lib/db/users";
import { getDepartmentAdminDepartmentIds } from "@/lib/db/department-admins";
import { listDepartments } from "@/lib/db/departments";
import { getDepartmentCompletionStats, getDepartmentCourseBreakdown } from "@/lib/db/department-reporting";
import { getDepartmentCompletionBreakdown, getMonthlyCompletions, getOrgStats } from "@/lib/db/org-reporting";
import { listMemberProgress } from "@/lib/db/member-progress";
import { isOrgAdmin } from "@/lib/roles";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { UnavailableState } from "@/components/ui/unavailable-state";
import { ReportsCharts } from "./reports-charts";

export default async function ReportsPage(props: { searchParams: Promise<{ dept?: string }> }) {
  const session = await auth();
  const userEmail = session?.user?.email;
  if (!userEmail) notFound();

  const userId = await getUserIdByEmail(userEmail);
  if (!userId) notFound();

  // Real session role, never the client-side preview toggle - an Org Admin
  // previewing the Department Admin view still sees company-wide data here,
  // same as /admin/department's own real-role resolution below it.
  if (isOrgAdmin(session.user?.roles)) {
    let stats, departmentCompletion, monthlyCompletions, members;
    try {
      [stats, departmentCompletion, monthlyCompletions, members] = await Promise.all([
        getOrgStats(),
        getDepartmentCompletionBreakdown(),
        getMonthlyCompletions(),
        listMemberProgress(),
      ]);
    } catch {
      return <UnavailableState message="Could not load reports right now. Please try again in a moment." />;
    }

    const statCards = [
      { label: "Total Employees", value: stats.totalEmployees },
      { label: "Active Learners", value: stats.activeLearners },
      { label: "Compliance Rate", value: `${stats.complianceRate}%` },
      { label: "Overdue Training", value: stats.overdueTraining },
    ];

    return (
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
          <p className="text-sm text-muted-foreground">Org-wide completion metrics.</p>
        </div>

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {statCards.map((stat) => (
            <Card key={stat.label}>
              <CardContent className="py-5">
                <p className="text-xs text-muted-foreground">{stat.label}</p>
                <p className="text-2xl font-semibold">{stat.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <ReportsCharts departmentCompletion={departmentCompletion} monthlyCompletions={monthlyCompletions} />

        <p className="text-sm text-muted-foreground">Member Progress coming up</p>
        {members.length}
      </div>
    );
  }

  let departmentIds: string[];
  try {
    departmentIds = await getDepartmentAdminDepartmentIds(userId);
  } catch {
    return <UnavailableState message="Could not load your department right now. Please try again in a moment." />;
  }

  if (departmentIds.length === 0) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col items-center gap-2 py-16 text-center">
        <h1 className="text-xl font-semibold">No department assigned yet</h1>
        <p className="text-sm text-muted-foreground">
          You&apos;re not the Department Admin of any department yet. Ask an Org Admin to add you
          from the Org Admin page.
        </p>
      </div>
    );
  }

  const { dept: selectedFromQuery } = await props.searchParams;
  const selectedDepartmentId =
    selectedFromQuery && departmentIds.includes(selectedFromQuery) ? selectedFromQuery : departmentIds[0];

  let allDepartments, deptStats, courseBreakdown, members;
  try {
    allDepartments = await listDepartments();
    deptStats = await getDepartmentCompletionStats(selectedDepartmentId);
    courseBreakdown = await getDepartmentCourseBreakdown(selectedDepartmentId);
    members = await listMemberProgress(selectedDepartmentId);
  } catch {
    return <UnavailableState message="Could not load this department's reports right now. Please try again in a moment." />;
  }

  const departmentName = allDepartments.find((d) => d.id === selectedDepartmentId)?.name ?? "Department";
  const nameById = new Map(allDepartments.map((d) => [d.id, d.name]));

  const statCards = [
    { label: "Completed", value: `${deptStats.completed}%` },
    { label: "In Progress", value: `${deptStats.inProgress}%` },
    { label: "Not Started", value: `${deptStats.notStarted}%` },
  ];

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Reports — {departmentName}</h1>
        {departmentIds.length > 1 && (
          <div className="mt-2 flex gap-2 text-sm">
            {departmentIds.map((id) => (
              <Link
                key={id}
                href={`/admin/reports?dept=${id}`}
                className={id === selectedDepartmentId ? "font-medium underline" : "text-muted-foreground hover:underline"}
              >
                {nameById.get(id) ?? id}
              </Link>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {statCards.map((stat) => (
          <Card key={stat.label}>
            <CardContent className="py-5">
              <p className="text-xs text-muted-foreground">{stat.label}</p>
              <p className="text-2xl font-semibold">{stat.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

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

      <p className="text-sm text-muted-foreground">Member Progress coming up</p>
      {members.length}
    </div>
  );
}
