import { and, eq, gte, isNotNull, lt, ne, sql } from "drizzle-orm";
import { db } from "./client";
import { users, enrollments, courses, departments } from "./schema";
import { bucketStatusesAsPercentages } from "./department-reporting";

export function ratePercent(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : Math.round((numerator / denominator) * 100);
}

export interface OrgStats {
  totalEmployees: number;
  activeLearners: number;
  complianceRate: number;
  overdueTraining: number;
}

export async function getOrgStats(): Promise<OrgStats> {
  const [{ totalEmployees }] = await db
    .select({ totalEmployees: sql<number>`count(*)::int` })
    .from(users)
    .where(eq(users.isActive, true));

  const [{ activeLearners }] = await db
    .select({ activeLearners: sql<number>`count(distinct ${users.id})::int` })
    .from(enrollments)
    .innerJoin(users, eq(users.id, enrollments.userId))
    .where(and(eq(users.isActive, true), ne(enrollments.status, "not_started")));

  const complianceRows = await db
    .select({ status: enrollments.status })
    .from(enrollments)
    .innerJoin(courses, eq(courses.id, enrollments.courseId))
    .where(eq(courses.compliance, true));
  const completedCompliance = complianceRows.filter((r) => r.status === "completed").length;
  const complianceRate = ratePercent(completedCompliance, complianceRows.length);

  const [{ overdueTraining }] = await db
    .select({ overdueTraining: sql<number>`count(*)::int` })
    .from(enrollments)
    .where(and(isNotNull(enrollments.dueAt), lt(enrollments.dueAt, new Date()), ne(enrollments.status, "completed")));

  return { totalEmployees, activeLearners, complianceRate, overdueTraining };
}

export interface DepartmentCompletionRow {
  departmentId: string;
  departmentName: string;
  completed: number;
  inProgress: number;
  notStarted: number;
}

export async function getDepartmentCompletionBreakdown(): Promise<DepartmentCompletionRow[]> {
  const depts = await db.select({ id: departments.id, name: departments.name }).from(departments).orderBy(departments.name);
  const rows = await db
    .select({ departmentId: users.departmentId, status: enrollments.status })
    .from(enrollments)
    .innerJoin(users, eq(users.id, enrollments.userId))
    .where(isNotNull(users.departmentId));

  const statusesByDept = new Map<string, string[]>();
  for (const row of rows) {
    const list = statusesByDept.get(row.departmentId!) ?? [];
    list.push(row.status);
    statusesByDept.set(row.departmentId!, list);
  }

  return depts.map((dept) => ({
    departmentId: dept.id,
    departmentName: dept.name,
    ...bucketStatusesAsPercentages(statusesByDept.get(dept.id) ?? []),
  }));
}

export interface MonthlyCompletionRow {
  month: string;
  completions: number;
}

export async function getMonthlyCompletions(months = 6): Promise<MonthlyCompletionRow[]> {
  const now = new Date();
  const buckets = Array.from({ length: months }, (_, i) => {
    const offset = months - 1 - i;
    const d = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    return {
      key: `${d.getFullYear()}-${d.getMonth()}`,
      label: d.toLocaleDateString("en-US", { month: "short", year: "numeric" }),
      date: d,
    };
  });

  const rows = await db
    .select({ completedAt: enrollments.completedAt })
    .from(enrollments)
    .where(and(isNotNull(enrollments.completedAt), gte(enrollments.completedAt, buckets[0].date)));

  const counts = new Map<string, number>();
  for (const row of rows) {
    const d = row.completedAt!;
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return buckets.map((b) => ({ month: b.label, completions: counts.get(b.key) ?? 0 }));
}
