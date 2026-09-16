import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { ensureEnrollment, getEnrollmentId } from "./enrollments";
import { db } from "./client";
import { courses, enrollments, users } from "./schema";

async function seedUserAndCourse(dueDate: Date | null = null) {
  const [user] = await db
    .insert(users)
    .values({ email: `enrollment-fn-${randomUUID()}@example.com`, displayName: "Enrollment Fn Test" })
    .returning();
  const [course] = await db
    .insert(courses)
    .values({ code: `ENROLLFN-${randomUUID()}`, title: "Enrollment Fn Course", dueDate })
    .returning();
  return { user, course };
}

describe("ensureEnrollment", () => {
  it("creates a not_started enrollment, copying the course's due date", async () => {
    const dueDate = new Date("2027-01-01T00:00:00Z");
    const { user, course } = await seedUserAndCourse(dueDate);
    try {
      await db.transaction(async (tx) => {
        await ensureEnrollment(tx, { userId: user.id, courseId: course.id });
      });
      const [row] = await db
        .select()
        .from(enrollments)
        .where(eq(enrollments.userId, user.id));
      expect(row.status).toBe("not_started");
      expect(row.dueAt?.toISOString()).toBe(dueDate.toISOString());
    } finally {
      await db.delete(enrollments).where(eq(enrollments.userId, user.id));
      await db.delete(courses).where(eq(courses.id, course.id));
      await db.delete(users).where(eq(users.id, user.id));
    }
  });

  it("is a no-op if an enrollment already exists (doesn't reset progress)", async () => {
    const { user, course } = await seedUserAndCourse();
    try {
      await db.transaction(async (tx) => {
        await ensureEnrollment(tx, { userId: user.id, courseId: course.id });
      });
      await db
        .update(enrollments)
        .set({ status: "completed" })
        .where(eq(enrollments.userId, user.id));

      await db.transaction(async (tx) => {
        await ensureEnrollment(tx, { userId: user.id, courseId: course.id });
      });

      const rows = await db.select().from(enrollments).where(eq(enrollments.userId, user.id));
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe("completed");
    } finally {
      await db.delete(enrollments).where(eq(enrollments.userId, user.id));
      await db.delete(courses).where(eq(courses.id, course.id));
      await db.delete(users).where(eq(users.id, user.id));
    }
  });
});

describe("getEnrollmentId", () => {
  it("returns the enrollment id for an enrolled (user, course) pair", async () => {
    const { user, course } = await seedUserAndCourse();
    try {
      const [enrollment] = await db
        .insert(enrollments)
        .values({ userId: user.id, courseId: course.id })
        .returning();
      expect(await getEnrollmentId(user.id, course.id)).toBe(enrollment.id);
    } finally {
      await db.delete(enrollments).where(eq(enrollments.userId, user.id));
      await db.delete(courses).where(eq(courses.id, course.id));
      await db.delete(users).where(eq(users.id, user.id));
    }
  });

  it("returns null when no enrollment exists", async () => {
    const { user, course } = await seedUserAndCourse();
    try {
      expect(await getEnrollmentId(user.id, course.id)).toBeNull();
    } finally {
      await db.delete(courses).where(eq(courses.id, course.id));
      await db.delete(users).where(eq(users.id, user.id));
    }
  });
});
