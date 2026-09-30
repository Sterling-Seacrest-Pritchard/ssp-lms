import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { listMemberProgress, listCourseStatusRows } from "./member-progress";
import { db } from "./client";
import { departments, users, courses, enrollments } from "./schema";

describe("listMemberProgress", () => {
  it("returns an empty array for a department with no users", async () => {
    const [dept] = await db.insert(departments).values({ name: `Dept-${randomUUID()}` }).returning();
    try {
      expect(await listMemberProgress(dept.id)).toEqual([]);
    } finally {
      await db.delete(departments).where(eq(departments.id, dept.id));
    }
  });

  it("includes a user with zero enrollments as an all-zero row, and computes counts for mixed statuses", async () => {
    const [dept] = await db.insert(departments).values({ name: `Dept-${randomUUID()}` }).returning();
    const [courseA] = await db.insert(courses).values({ code: `MP-${randomUUID()}`, title: "a" }).returning();
    const [courseB] = await db.insert(courses).values({ code: `MP-${randomUUID()}`, title: "b" }).returning();
    const [idle] = await db.insert(users).values({ email: `${randomUUID()}@example.com`, displayName: "Idle", departmentId: dept.id }).returning();
    const [busy] = await db.insert(users).values({ email: `${randomUUID()}@example.com`, displayName: "Busy", departmentId: dept.id }).returning();
    const past = new Date(Date.now() - 86_400_000);
    try {
      await db.insert(enrollments).values({ userId: busy.id, courseId: courseA.id, status: "completed" });
      await db.insert(enrollments).values({ userId: busy.id, courseId: courseB.id, status: "in_progress", dueAt: past });

      const rows = await listMemberProgress(dept.id);
      expect(rows).toEqual(
        expect.arrayContaining([
          { userId: idle.id, displayName: "Idle", email: idle.email, completedCount: 0, totalAssigned: 0, overdueCount: 0 },
          { userId: busy.id, displayName: "Busy", email: busy.email, completedCount: 1, totalAssigned: 2, overdueCount: 1 },
        ])
      );
    } finally {
      await db.delete(enrollments).where(eq(enrollments.userId, busy.id));
      await db.delete(courses).where(eq(courses.id, courseA.id));
      await db.delete(courses).where(eq(courses.id, courseB.id));
      await db.delete(users).where(eq(users.id, idle.id));
      await db.delete(users).where(eq(users.id, busy.id));
      await db.delete(departments).where(eq(departments.id, dept.id));
    }
  });

  it("excludes an inactive user", async () => {
    const [dept] = await db.insert(departments).values({ name: `Dept-${randomUUID()}` }).returning();
    const [inactive] = await db
      .insert(users)
      .values({ email: `${randomUUID()}@example.com`, displayName: "Leaver", departmentId: dept.id, isActive: false })
      .returning();
    try {
      expect(await listMemberProgress(dept.id)).toEqual([]);
    } finally {
      await db.delete(users).where(eq(users.id, inactive.id));
      await db.delete(departments).where(eq(departments.id, dept.id));
    }
  });

  it("with no departmentId, returns active users company-wide", async () => {
    const [user] = await db.insert(users).values({ email: `${randomUUID()}@example.com`, displayName: "NoDept" }).returning();
    try {
      const rows = await listMemberProgress();
      expect(rows).toEqual(
        expect.arrayContaining([{ userId: user.id, displayName: "NoDept", email: user.email, completedCount: 0, totalAssigned: 0, overdueCount: 0 }])
      );
    } finally {
      await db.delete(users).where(eq(users.id, user.id));
    }
  });
});

describe("listCourseStatusRows", () => {
  it("scoped by userId returns only that user's rows, with overdue/compliance flags", async () => {
    const [course] = await db.insert(courses).values({ code: `MP-${randomUUID()}`, title: "Compliance Course", compliance: true }).returning();
    const [user] = await db.insert(users).values({ email: `${randomUUID()}@example.com`, displayName: "x" }).returning();
    const past = new Date(Date.now() - 86_400_000);
    try {
      await db.insert(enrollments).values({ userId: user.id, courseId: course.id, status: "in_progress", dueAt: past });
      const rows = await listCourseStatusRows({ userId: user.id });
      expect(rows).toEqual([
        expect.objectContaining({
          userId: user.id,
          courseId: course.id,
          courseTitle: "Compliance Course",
          status: "in_progress",
          overdue: true,
          compliance: true,
        }),
      ]);
    } finally {
      await db.delete(enrollments).where(eq(enrollments.userId, user.id));
      await db.delete(users).where(eq(users.id, user.id));
      await db.delete(courses).where(eq(courses.id, course.id));
    }
  });

  it("scoped by departmentId returns only that department's active members' rows", async () => {
    const [deptA] = await db.insert(departments).values({ name: `Dept-${randomUUID()}` }).returning();
    const [deptB] = await db.insert(departments).values({ name: `Dept-${randomUUID()}` }).returning();
    const [course] = await db.insert(courses).values({ code: `MP-${randomUUID()}`, title: "x" }).returning();
    const [userA] = await db.insert(users).values({ email: `${randomUUID()}@example.com`, displayName: "A", departmentId: deptA.id }).returning();
    const [userB] = await db.insert(users).values({ email: `${randomUUID()}@example.com`, displayName: "B", departmentId: deptB.id }).returning();
    try {
      await db.insert(enrollments).values({ userId: userA.id, courseId: course.id, status: "not_started" });
      await db.insert(enrollments).values({ userId: userB.id, courseId: course.id, status: "not_started" });
      const rows = await listCourseStatusRows({ departmentId: deptA.id });
      expect(rows.map((r) => r.userId)).toEqual([userA.id]);
    } finally {
      await db.delete(enrollments).where(eq(enrollments.courseId, course.id));
      await db.delete(users).where(eq(users.id, userA.id));
      await db.delete(users).where(eq(users.id, userB.id));
      await db.delete(courses).where(eq(courses.id, course.id));
      await db.delete(departments).where(eq(departments.id, deptA.id));
      await db.delete(departments).where(eq(departments.id, deptB.id));
    }
  });
});
