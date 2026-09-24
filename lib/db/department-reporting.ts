import { eq } from "drizzle-orm";
import { db } from "./client";
import { users, enrollments } from "./schema";

export interface DepartmentCompletionStats {
  completed: number;
  inProgress: number;
  notStarted: number;
}

export async function getDepartmentCompletionStats(departmentId: string): Promise<DepartmentCompletionStats> {
  const rows = await db
    .select({ status: enrollments.status })
    .from(enrollments)
    .innerJoin(users, eq(users.id, enrollments.userId))
    .where(eq(users.departmentId, departmentId));

  if (rows.length === 0) {
    return { completed: 0, inProgress: 0, notStarted: 0 };
  }

  const completed = rows.filter((r) => r.status === "completed").length;
  const inProgress = rows.filter((r) => r.status === "in_progress").length;
  const notStarted = rows.length - completed - inProgress;

  return {
    completed: Math.round((completed / rows.length) * 100),
    inProgress: Math.round((inProgress / rows.length) * 100),
    notStarted: Math.round((notStarted / rows.length) * 100),
  };
}
