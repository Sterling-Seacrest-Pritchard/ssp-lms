import { Card, CardContent } from "@/components/ui/card";
import { UnavailableState } from "@/components/ui/unavailable-state";
import { getDepartmentCompletionBreakdown, getMonthlyCompletions, getOrgStats } from "@/lib/db/org-reporting";
import { ReportsCharts } from "./reports-charts";

export default async function ReportsPage() {
  let stats, departmentCompletion, monthlyCompletions;
  try {
    [stats, departmentCompletion, monthlyCompletions] = await Promise.all([
      getOrgStats(),
      getDepartmentCompletionBreakdown(),
      getMonthlyCompletions(),
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
    </div>
  );
}
