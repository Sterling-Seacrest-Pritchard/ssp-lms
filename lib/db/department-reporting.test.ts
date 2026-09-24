import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDepartmentCompletionStats } from "./department-reporting";
import { db } from "./client";
import { departments, users, courses, enrollments } from "./schema";

describe("getDepartmentCompletionStats", () => {
  it("buckets a department's enrollments by status as percentages", async () => {
    const [dept] = await db.insert(departments).values({ name: `Dept-${randomUUID()}` }).returning();
    const [course] = await db.insert(courses).values({ code: `REPORT-${randomUUID()}`, title: "x" }).returning();
    const userIds: string[] = [];
    const statuses = ["completed", "completed", "in_progress", "not_started"];
    for (const status of statuses) {
      const [user] = await db
        .insert(users)
        .values({ email: `${randomUUID()}@example.com`, displayName: "x", departmentId: dept.id })
        .returning();
      userIds.push(user.id);
      await db.insert(enrollments).values({ userId: user.id, courseId: course.id, status });
    }

    try {
      const stats = await getDepartmentCompletionStats(dept.id);
      expect(stats).toEqual({ completed: 50, inProgress: 25, notStarted: 25 });
    } finally {
      await db.delete(enrollments).where(eq(enrollments.courseId, course.id));
      await db.delete(courses).where(eq(courses.id, course.id));
      for (const id of userIds) await db.delete(users).where(eq(users.id, id));
      await db.delete(departments).where(eq(departments.id, dept.id));
    }
  });

  it("returns all zeros for a department with no enrollments", async () => {
    const [dept] = await db.insert(departments).values({ name: `Dept-${randomUUID()}` }).returning();
    try {
      expect(await getDepartmentCompletionStats(dept.id)).toEqual({ completed: 0, inProgress: 0, notStarted: 0 });
    } finally {
      await db.delete(departments).where(eq(departments.id, dept.id));
    }
  });
});
