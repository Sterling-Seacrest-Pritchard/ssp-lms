import { eq, ne, isNull, or, sql } from "drizzle-orm";
import { db } from "./client";
import { departments, users } from "./schema";

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
): Promise<{ id: string; email: string; displayName: string }[]> {
  return db
    .select({ id: users.id, email: users.email, displayName: users.displayName })
    .from(users)
    .where(or(isNull(users.departmentId), ne(users.departmentId, departmentId)))
    .orderBy(users.displayName);
}

export async function setUserDepartment(userId: string, departmentId: string | null): Promise<void> {
  await db.update(users).set({ departmentId, updatedAt: new Date() }).where(eq(users.id, userId));
}
