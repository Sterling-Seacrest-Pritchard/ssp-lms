import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  assignCourse,
  DuplicateAssignmentError,
  listAssignmentsForUser,
  listUsersWithStatus,
  unassignCourse,
} from "./course-assignments";
import { db } from "./client";
import { courses, users, courseAssignments, enrollments } from "./schema";

async function seedUser(entraObjectId: string | null) {
  const [user] = await db
    .insert(users)
    .values({ entraObjectId, email: `test-${randomUUID()}@example.com`, displayName: "Test User" })
    .returning();
  return user;
}

async function seedCourse() {
  const [course] = await db.insert(courses).values({ code: `ASSIGN-${randomUUID()}`, title: "Test Course" }).returning();
  return course;
}

describe("listUsersWithStatus", () => {
  it("reports 'active' for a claimed user and 'pending' for a synced-but-unclaimed one", async () => {
    const active = await seedUser(randomUUID());
    const pending = await seedUser(null);
    try {
      const rows = await listUsersWithStatus();
      const activeRow = rows.find((r) => r.id === active.id);
      const pendingRow = rows.find((r) => r.id === pending.id);
      expect(activeRow?.status).toBe("active");
      expect(pendingRow?.status).toBe("pending");
    } finally {
      await db.delete(users).where(eq(users.id, active.id));
      await db.delete(users).where(eq(users.id, pending.id));
    }
  });
});

describe("assignCourse / listAssignmentsForUser / unassignCourse", () => {
  it("assigns a course, lists it, then unassigns it", async () => {
    const user = await seedUser(randomUUID());
    const course = await seedCourse();
    try {
      await assignCourse(course.id, user.id, "admin@example.com");

      const assignments = await listAssignmentsForUser(user.id);
      expect(assignments).toHaveLength(1);
      expect(assignments[0].courseId).toBe(course.id);
      expect(assignments[0].title).toBe("Test Course");

      await unassignCourse(course.id, user.id);
      expect(await listAssignmentsForUser(user.id)).toHaveLength(0);
    } finally {
      await db.delete(enrollments).where(eq(enrollments.userId, user.id));
      await db.delete(courseAssignments).where(eq(courseAssignments.userId, user.id));
      await db.delete(courses).where(eq(courses.id, course.id));
      await db.delete(users).where(eq(users.id, user.id));
    }
  });

  it("rejects assigning the same course to the same user twice", async () => {
    const user = await seedUser(randomUUID());
    const course = await seedCourse();
    try {
      await assignCourse(course.id, user.id, "admin@example.com");
      await expect(assignCourse(course.id, user.id, "admin@example.com")).rejects.toThrow(
        DuplicateAssignmentError
      );
    } finally {
      await db.delete(enrollments).where(eq(enrollments.userId, user.id));
      await db.delete(courseAssignments).where(eq(courseAssignments.userId, user.id));
      await db.delete(courses).where(eq(courses.id, course.id));
      await db.delete(users).where(eq(users.id, user.id));
    }
  });

  it("returns an empty list for a non-UUID user id instead of throwing", async () => {
    expect(await listAssignmentsForUser("not-a-uuid")).toEqual([]);
  });

  it("creates a not_started enrollment in the same transaction as the assignment", async () => {
    const user = await seedUser(randomUUID());
    const course = await seedCourse();
    try {
      await assignCourse(course.id, user.id, "admin@example.com");

      const [enrollment] = await db
        .select()
        .from(enrollments)
        .where(and(eq(enrollments.userId, user.id), eq(enrollments.courseId, course.id)));
      expect(enrollment).toBeDefined();
      expect(enrollment.status).toBe("not_started");
    } finally {
      await db.delete(enrollments).where(eq(enrollments.userId, user.id));
      await db.delete(courseAssignments).where(eq(courseAssignments.userId, user.id));
      await db.delete(courses).where(eq(courses.id, course.id));
      await db.delete(users).where(eq(users.id, user.id));
    }
  });

  it("unassigning a course does NOT delete the enrollment or reset its progress", async () => {
    const user = await seedUser(randomUUID());
    const course = await seedCourse();
    try {
      await assignCourse(course.id, user.id, "admin@example.com");
      await db.update(enrollments).set({ status: "in_progress" }).where(eq(enrollments.userId, user.id));

      await unassignCourse(course.id, user.id);

      const [enrollment] = await db
        .select()
        .from(enrollments)
        .where(and(eq(enrollments.userId, user.id), eq(enrollments.courseId, course.id)));
      expect(enrollment).toBeDefined();
      expect(enrollment.status).toBe("in_progress");
    } finally {
      await db.delete(enrollments).where(eq(enrollments.userId, user.id));
      await db.delete(courseAssignments).where(eq(courseAssignments.userId, user.id));
      await db.delete(courses).where(eq(courses.id, course.id));
      await db.delete(users).where(eq(users.id, user.id));
    }
  });
});
