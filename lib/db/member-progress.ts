import { and, eq } from "drizzle-orm";
import { db } from "./client";
import { users, enrollments, courses } from "./schema";

export interface MemberProgressRow {
  userId: string;
  displayName: string;
  email: string;
  completedCount: number;
  totalAssigned: number;
  overdueCount: number;
}

function isOverdue(dueAt: Date | null, status: string, now: Date): boolean {
  return dueAt !== null && dueAt < now && status !== "completed";
}

export async function listMemberProgress(departmentId?: string): Promise<MemberProgressRow[]> {
  const now = new Date();
  const rows = await db
    .select({
      userId: users.id,
      displayName: users.displayName,
      email: users.email,
      status: enrollments.status,
      dueAt: enrollments.dueAt,
    })
    .from(users)
    .leftJoin(enrollments, eq(enrollments.userId, users.id))
    .where(departmentId ? and(eq(users.isActive, true), eq(users.departmentId, departmentId)) : eq(users.isActive, true));

  const byUser = new Map<string, MemberProgressRow>();
  for (const row of rows) {
    const entry = byUser.get(row.userId) ?? {
      userId: row.userId,
      displayName: row.displayName,
      email: row.email,
      completedCount: 0,
      totalAssigned: 0,
      overdueCount: 0,
    };
    if (row.status !== null) {
      entry.totalAssigned++;
      if (row.status === "completed") entry.completedCount++;
      if (isOverdue(row.dueAt, row.status, now)) entry.overdueCount++;
    }
    byUser.set(row.userId, entry);
  }
  return Array.from(byUser.values());
}

export interface CourseStatusRow {
  userId: string;
  displayName: string;
  email: string;
  courseId: string;
  courseTitle: string;
  status: string;
  dueAt: string | null;
  completedAt: string | null;
  overdue: boolean;
  compliance: boolean;
}

export async function listCourseStatusRows(scope: { departmentId?: string; userId?: string }): Promise<CourseStatusRow[]> {
  const now = new Date();
  const conditions = [eq(users.isActive, true)];
  if (scope.departmentId) conditions.push(eq(users.departmentId, scope.departmentId));
  if (scope.userId) conditions.push(eq(users.id, scope.userId));

  const rows = await db
    .select({
      userId: users.id,
      displayName: users.displayName,
      email: users.email,
      courseId: courses.id,
      courseTitle: courses.title,
      status: enrollments.status,
      dueAt: enrollments.dueAt,
      completedAt: enrollments.completedAt,
      compliance: courses.compliance,
    })
    .from(enrollments)
    .innerJoin(users, eq(users.id, enrollments.userId))
    .innerJoin(courses, eq(courses.id, enrollments.courseId))
    .where(and(...conditions));

  return rows.map((row) => ({
    userId: row.userId,
    displayName: row.displayName,
    email: row.email,
    courseId: row.courseId,
    courseTitle: row.courseTitle,
    status: row.status,
    dueAt: row.dueAt ? row.dueAt.toISOString() : null,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    overdue: isOverdue(row.dueAt, row.status, now),
    compliance: row.compliance,
  }));
}
