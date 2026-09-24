import { and, eq, notInArray } from "drizzle-orm";
import { db } from "./client";
import { departmentAdmins, users } from "./schema";
import { DuplicateAssignmentError } from "./course-assignments";

export async function assignDepartmentAdmin(
  userId: string,
  departmentId: string,
  assignedBy: string | null
): Promise<void> {
  try {
    await db.insert(departmentAdmins).values({ userId, departmentId, assignedBy });
  } catch (error) {
    const pgCode = (error as { cause?: { code?: string } })?.cause?.code;
    if (pgCode === "23505") {
      throw new DuplicateAssignmentError("This user already administers this department");
    }
    throw error;
  }
}

export async function removeDepartmentAdmin(userId: string, departmentId: string): Promise<void> {
  await db
    .delete(departmentAdmins)
    .where(and(eq(departmentAdmins.userId, userId), eq(departmentAdmins.departmentId, departmentId)));
}

export async function listAdminsForDepartment(
  departmentId: string
): Promise<{ userId: string; displayName: string; email: string; assignedAt: string }[]> {
  const rows = await db
    .select({
      userId: users.id,
      displayName: users.displayName,
      email: users.email,
      assignedAt: departmentAdmins.assignedAt,
    })
    .from(departmentAdmins)
    .innerJoin(users, eq(users.id, departmentAdmins.userId))
    .where(eq(departmentAdmins.departmentId, departmentId))
    .orderBy(departmentAdmins.assignedAt);
  return rows.map((r) => ({ ...r, assignedAt: r.assignedAt.toISOString() }));
}

export async function getDepartmentAdminDepartmentIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ departmentId: departmentAdmins.departmentId })
    .from(departmentAdmins)
    .where(eq(departmentAdmins.userId, userId));
  return rows.map((r) => r.departmentId);
}

export async function listDepartmentAdminEligibleUsers(
  departmentId: string
): Promise<{ id: string; email: string; displayName: string }[]> {
  const alreadyAdminIds = (
    await db
      .select({ userId: departmentAdmins.userId })
      .from(departmentAdmins)
      .where(eq(departmentAdmins.departmentId, departmentId))
  ).map((r) => r.userId);

  const conditions = [eq(users.entraRole, "Department Admin")];
  if (alreadyAdminIds.length > 0) {
    conditions.push(notInArray(users.id, alreadyAdminIds));
  }

  return db
    .select({ id: users.id, email: users.email, displayName: users.displayName })
    .from(users)
    .where(and(...conditions))
    .orderBy(users.displayName);
}
