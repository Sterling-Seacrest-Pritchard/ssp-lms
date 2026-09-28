"use client";

import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { DepartmentCompletionRow, MonthlyCompletionRow } from "@/lib/db/org-reporting";

export function ReportsCharts({
  departmentCompletion,
  monthlyCompletions,
}: {
  departmentCompletion: DepartmentCompletionRow[];
  monthlyCompletions: MonthlyCompletionRow[];
}) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Completion by Department</CardTitle>
        </CardHeader>
        <CardContent className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={departmentCompletion}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="departmentName" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip />
              <Legend />
              <Bar dataKey="completed" stackId="a" fill="#2563eb" name="Completed" />
              <Bar dataKey="inProgress" stackId="a" fill="#93c5fd" name="In Progress" />
              <Bar dataKey="notStarted" stackId="a" fill="#e2e8f0" name="Not Started" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Monthly Completions</CardTitle>
        </CardHeader>
        <CardContent className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={monthlyCompletions}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip />
              <Line type="monotone" dataKey="completions" stroke="#2563eb" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}
