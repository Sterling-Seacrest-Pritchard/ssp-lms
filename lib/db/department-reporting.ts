import { eq } from "drizzle-orm";
import { db } from "./client";
import { users, enrollments, courses } from "./schema";

export interface DepartmentCompletionStats {
  completed: number;
  inProgress: number;
  notStarted: number;
}

export function bucketStatusesAsPercentages(statuses: string[]): DepartmentCompletionStats {
  if (statuses.length === 0) {
    return { completed: 0, inProgress: 0, notStarted: 0 };
  }

  const completed = statuses.filter((s) => s === "completed").length;
  const inProgress = statuses.filter((s) => s === "in_progress").length;
  const notStarted = statuses.length - completed - inProgress;

  return {
    completed: Math.round((completed / statuses.length) * 100),
    inProgress: Math.round((inProgress / statuses.length) * 100),
    notStarted: Math.round((notStarted / statuses.length) * 100),
  };
}

export async function getDepartmentCompletionStats(departmentId: string): Promise<DepartmentCompletionStats> {
  const rows = await db
    .select({ status: enrollments.status })
    .from(enrollments)
    .innerJoin(users, eq(users.id, enrollments.userId))
    .where(eq(users.departmentId, departmentId));

  return bucketStatusesAsPercentages(rows.map((r) => r.status));
}

export interface DepartmentCourseBreakdownRow {
  courseId: string;
  courseTitle: string;
  completed: number;
  inProgress: number;
  notStarted: number;
  overdue: number;
}

export async function getDepartmentCourseBreakdown(departmentId: string): Promise<DepartmentCourseBreakdownRow[]> {
  const rows = await db
    .select({
      courseId: courses.id,
      courseTitle: courses.title,
      status: enrollments.status,
      dueAt: enrollments.dueAt,
    })
    .from(enrollments)
    .innerJoin(users, eq(users.id, enrollments.userId))
    .innerJoin(courses, eq(courses.id, enrollments.courseId))
    .where(eq(users.departmentId, departmentId))
    .orderBy(courses.title);

  const now = new Date();
  const byCourse = new Map<string, DepartmentCourseBreakdownRow>();
  for (const row of rows) {
    const entry = byCourse.get(row.courseId) ?? {
      courseId: row.courseId,
      courseTitle: row.courseTitle,
      completed: 0,
      inProgress: 0,
      notStarted: 0,
      overdue: 0,
    };
    if (row.status === "completed") entry.completed++;
    else if (row.status === "in_progress") entry.inProgress++;
    else entry.notStarted++;
    if (row.dueAt && row.dueAt < now && row.status !== "completed") entry.overdue++;
    byCourse.set(row.courseId, entry);
  }
  return Array.from(byCourse.values());
}
