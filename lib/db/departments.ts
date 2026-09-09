import { eq, ne, isNull, or, and, sql } from "drizzle-orm";
import { db } from "./client";
import { departments, users } from "./schema";
import { isUuid } from "@/lib/api/errors";

export async function listDepartments(): Promise<{ id: string; name: string }[]> {
  return db.select({ id: departments.id, name: departments.name }).from(departments).orderBy(departments.name);
}

export async function listDepartmentsWithCounts(): Promise<
  { id: string; name: string; memberCount: number }[]
> {
  const rows = await db
    .select({
      id: departments.id,
      name: departments.name,
      memberCount: sql<number>`count(${users.id})::int`,
    })
    .from(departments)
    .leftJoin(users, eq(users.departmentId, departments.id))
    .groupBy(departments.id, departments.name)
    .orderBy(departments.name);
  return rows;
}

export async function createDepartment(name: string): Promise<{ id: string; name: string }> {
  const [dept] = await db.insert(departments).values({ name }).returning({ id: departments.id, name: departments.name });
  return dept;
}

export async function getDepartmentWithMembers(
  departmentId: string
): Promise<{ id: string; name: string; members: { id: string; email: string; displayName: string }[] } | null> {
  if (!isUuid(departmentId)) return null;

  const [dept] = await db.select().from(departments).where(eq(departments.id, departmentId));
  if (!dept) return null;

  const members = await db
    .select({ id: users.id, email: users.email, displayName: users.displayName })
    .from(users)
    .where(eq(users.departmentId, departmentId))
    .orderBy(users.displayName);

  return { id: dept.id, name: dept.name, members };
}

export async function listUsersNotInDepartment(
  departmentId: string
): Promise<{ id: string; email: string; displayName: string; currentDepartmentName: string | null }[]> {
  return db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      currentDepartmentName: departments.name,
    })
    .from(users)
    .leftJoin(departments, eq(departments.id, users.departmentId))
    .where(or(isNull(users.departmentId), ne(users.departmentId, departmentId)))
    .orderBy(users.displayName);
}

export async function setUserDepartment(userId: string, departmentId: string | null): Promise<void> {
  await db.update(users).set({ departmentId, updatedAt: new Date() }).where(eq(users.id, userId));
}

export async function clearUserDepartment(userId: string, departmentId: string): Promise<void> {
  // Only clear the user's department if they currently belong to *this*
  // department, so a stale/racing UI can't clear a user out of a
  // different department they were moved into in the meantime.
  await db
    .update(users)
    .set({ departmentId: null, updatedAt: new Date() })
    .where(and(eq(users.id, userId), eq(users.departmentId, departmentId)));
}
