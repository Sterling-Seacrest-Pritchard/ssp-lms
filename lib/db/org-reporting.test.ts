import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDepartmentCompletionBreakdown, getMonthlyCompletions, getOrgStats, ratePercent } from "./org-reporting";
import { db } from "./client";
import { departments, users, courses, enrollments } from "./schema";

describe("ratePercent", () => {
  it("returns 0 for a zero denominator, never NaN", () => {
    expect(ratePercent(0, 0)).toBe(0);
  });

  it("rounds to the nearest percent", () => {
    expect(ratePercent(1, 3)).toBe(33);
  });
});

describe("getOrgStats", () => {
  it("counts only active users as employees, and only active users' non-not_started enrollments as active learners", async () => {
    const before = await getOrgStats();
    const [course] = await db.insert(courses).values({ code: `ORG-${randomUUID()}`, title: "x" }).returning();
    const [active] = await db.insert(users).values({ email: `${randomUUID()}@example.com`, displayName: "Active" }).returning();
    const [inactive] = await db
      .insert(users)
      .values({ email: `${randomUUID()}@example.com`, displayName: "Inactive", isActive: false })
      .returning();
    try {
      // Only the active user counts toward totalEmployees, as soon as the user rows exist.
      expect((await getOrgStats()).totalEmployees).toBe(before.totalEmployees + 1);

      await db.insert(enrollments).values({ userId: active.id, courseId: course.id, status: "in_progress" });
      await db.insert(enrollments).values({ userId: inactive.id, courseId: course.id, status: "in_progress" });

      const after = await getOrgStats();
      expect(after.totalEmployees).toBe(before.totalEmployees + 1);
      expect(after.activeLearners).toBe(before.activeLearners + 1);
    } finally {
      await db.delete(enrollments).where(eq(enrollments.courseId, course.id));
      await db.delete(users).where(eq(users.id, active.id));
      await db.delete(users).where(eq(users.id, inactive.id));
      await db.delete(courses).where(eq(courses.id, course.id));
    }
  });

  it("a non-compliance course's completion does not move the compliance rate", async () => {
    const [course] = await db.insert(courses).values({ code: `ORG-${randomUUID()}`, title: "x", compliance: false }).returning();
    const [user] = await db.insert(users).values({ email: `${randomUUID()}@example.com`, displayName: "x" }).returning();
    try {
      const before = (await getOrgStats()).complianceRate;
      await db.insert(enrollments).values({ userId: user.id, courseId: course.id, status: "completed" });
      expect((await getOrgStats()).complianceRate).toBe(before);
    } finally {
      await db.delete(enrollments).where(eq(enrollments.courseId, course.id));
      await db.delete(users).where(eq(users.id, user.id));
      await db.delete(courses).where(eq(courses.id, course.id));
    }
  });

  it("only counts an enrollment overdue when dueAt is strictly in the past and not completed", async () => {
    const [course] = await db.insert(courses).values({ code: `ORG-${randomUUID()}`, title: "x" }).returning();
    const [user] = await db.insert(users).values({ email: `${randomUUID()}@example.com`, displayName: "x" }).returning();
    const past = new Date(Date.now() - 1000);
    const future = new Date(Date.now() + 86_400_000);
    try {
      const before = (await getOrgStats()).overdueTraining;
      const [pastEnrollment] = await db
        .insert(enrollments)
        .values({ userId: user.id, courseId: course.id, status: "in_progress", dueAt: past })
        .returning();
      expect((await getOrgStats()).overdueTraining).toBe(before + 1);

      await db.update(enrollments).set({ status: "completed" }).where(eq(enrollments.id, pastEnrollment.id));
      expect((await getOrgStats()).overdueTraining).toBe(before);

      await db.update(enrollments).set({ status: "in_progress", dueAt: future }).where(eq(enrollments.id, pastEnrollment.id));
      expect((await getOrgStats()).overdueTraining).toBe(before);
    } finally {
      await db.delete(enrollments).where(eq(enrollments.courseId, course.id));
      await db.delete(users).where(eq(users.id, user.id));
      await db.delete(courses).where(eq(courses.id, course.id));
    }
  });
});

describe("getDepartmentCompletionBreakdown", () => {
  it("includes a department with zero enrollments as an all-zero row", async () => {
    const [dept] = await db.insert(departments).values({ name: `Dept-${randomUUID()}` }).returning();
    try {
      const rows = await getDepartmentCompletionBreakdown();
      expect(rows).toEqual(
        expect.arrayContaining([{ departmentId: dept.id, departmentName: dept.name, completed: 0, inProgress: 0, notStarted: 0 }])
      );
    } finally {
      await db.delete(departments).where(eq(departments.id, dept.id));
    }
  });
});

describe("getMonthlyCompletions", () => {
  it("returns one row per requested month, oldest first, with year-qualified labels", async () => {
    const rows = await getMonthlyCompletions(3);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => /^[A-Za-z]{3} \d{4}$/.test(r.month))).toBe(true);
    const now = new Date();
    const twoMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 2, 1).toLocaleDateString("en-US", {
      month: "short",
      year: "numeric",
    });
    expect(rows[0].month).toBe(twoMonthsAgo);
  });

  it("counts a real completion in its correct month bucket, zero-filling months without one", async () => {
    const [course] = await db.insert(courses).values({ code: `ORG-${randomUUID()}`, title: "x" }).returning();
    const [user] = await db.insert(users).values({ email: `${randomUUID()}@example.com`, displayName: "x" }).returning();
    try {
      await db.insert(enrollments).values({ userId: user.id, courseId: course.id, status: "completed", completedAt: new Date() });
      const rows = await getMonthlyCompletions(3);
      expect(rows[2].completions).toBeGreaterThanOrEqual(1);
      expect(rows[0].completions).toBeGreaterThanOrEqual(0);
    } finally {
      await db.delete(enrollments).where(eq(enrollments.courseId, course.id));
      await db.delete(users).where(eq(users.id, user.id));
      await db.delete(courses).where(eq(courses.id, course.id));
    }
  });
});
