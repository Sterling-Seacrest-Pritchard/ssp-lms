import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  assignCourseToDepartment,
  assignDepartmentCoursesToUser,
  listCourseAssignmentsForDepartment,
  unassignCourseFromDepartment,
} from "./department-course-assignments";
import { DuplicateAssignmentError } from "./course-assignments";
import { db } from "./client";
import { courses, users, departments, courseAssignments, departmentCourseAssignments, enrollments } from "./schema";

async function seedDepartment() {
  const [department] = await db
    .insert(departments)
    .values({ name: `Dept-${randomUUID()}` })
    .returning();
  return department;
}

async function seedUser(departmentId: string | null) {
  const [user] = await db
    .insert(users)
    .values({ email: `test-${randomUUID()}@example.com`, displayName: "Test User", departmentId })
    .returning();
  return user;
}

async function seedCourse() {
  const [course] = await db.insert(courses).values({ code: `DEPT-ASSIGN-${randomUUID()}`, title: "Test Course" }).returning();
  return course;
}

async function cleanup(userIds: string[], courseIds: string[], departmentId: string) {
  await db.delete(enrollments).where(eq(enrollments.courseId, courseIds[0]));
  await db.delete(courseAssignments).where(eq(courseAssignments.courseId, courseIds[0]));
  await db.delete(departmentCourseAssignments).where(eq(departmentCourseAssignments.departmentId, departmentId));
  for (const userId of userIds) {
    await db.delete(users).where(eq(users.id, userId));
  }
  for (const courseId of courseIds) {
    await db.delete(courses).where(eq(courses.id, courseId));
  }
  await db.delete(departments).where(eq(departments.id, departmentId));
}

describe("assignCourseToDepartment", () => {
  it("assigns a course to every current member of the department", async () => {
    const department = await seedDepartment();
    const memberA = await seedUser(department.id);
    const memberB = await seedUser(department.id);
    const outsider = await seedUser(null);
    const course = await seedCourse();

    try {
      const result = await assignCourseToDepartment(course.id, department.id, "admin@example.com");
      expect(result).toEqual({ memberCount: 2, newlyAssigned: 2 });

      const assignedUserIds = (
        await db.select({ userId: courseAssignments.userId }).from(courseAssignments).where(eq(courseAssignments.courseId, course.id))
      ).map((r) => r.userId);
      expect(assignedUserIds).toContain(memberA.id);
      expect(assignedUserIds).toContain(memberB.id);
      expect(assignedUserIds).not.toContain(outsider.id);

      const departmentAssignments = await listCourseAssignmentsForDepartment(department.id);
      expect(departmentAssignments).toHaveLength(1);
      expect(departmentAssignments[0].courseId).toBe(course.id);
    } finally {
      await cleanup([memberA.id, memberB.id, outsider.id], [course.id], department.id);
    }
  });

  it("skips (does not error on) a member who was already individually assigned the course", async () => {
    const department = await seedDepartment();
    const member = await seedUser(department.id);
    const course = await seedCourse();

    try {
      await db.insert(courseAssignments).values({ courseId: course.id, userId: member.id, assignedBy: "admin@example.com" });

      const result = await assignCourseToDepartment(course.id, department.id, "admin@example.com");
      expect(result).toEqual({ memberCount: 1, newlyAssigned: 0 });

      const rows = await db.select().from(courseAssignments).where(eq(courseAssignments.courseId, course.id));
      expect(rows).toHaveLength(1);
    } finally {
      await cleanup([member.id], [course.id], department.id);
    }
  });

  it("rejects assigning the same course to the same department twice", async () => {
    const department = await seedDepartment();
    const course = await seedCourse();
    try {
      await assignCourseToDepartment(course.id, department.id, "admin@example.com");
      await expect(assignCourseToDepartment(course.id, department.id, "admin@example.com")).rejects.toThrow(
        DuplicateAssignmentError
      );
    } finally {
      await cleanup([], [course.id], department.id);
    }
  });
});

describe("assignDepartmentCoursesToUser", () => {
  it("gives a newly-added department member every course already assigned to the department", async () => {
    const department = await seedDepartment();
    const course = await seedCourse();
    const newMember = await seedUser(department.id);

    try {
      await assignCourseToDepartment(course.id, department.id, "admin@example.com");
      // Simulate a SECOND user joining after the department already has the course.
      const laterMember = await seedUser(null);
      await db.update(users).set({ departmentId: department.id }).where(eq(users.id, laterMember.id));

      await assignDepartmentCoursesToUser(laterMember.id, department.id);

      const [assignment] = await db
        .select()
        .from(courseAssignments)
        .where(eq(courseAssignments.userId, laterMember.id));
      expect(assignment).toBeDefined();
      expect(assignment.courseId).toBe(course.id);

      await cleanup([newMember.id, laterMember.id], [course.id], department.id);
    } catch (err) {
      await cleanup([newMember.id], [course.id], department.id);
      throw err;
    }
  });

  it("does not error when the user already has one of the department's courses", async () => {
    const department = await seedDepartment();
    const course = await seedCourse();
    const member = await seedUser(department.id);

    try {
      await assignCourseToDepartment(course.id, department.id, "admin@example.com");
      // Member already has it from the bulk assign above - calling this again
      // (e.g. a second, redundant department-join hook) must not throw.
      await expect(assignDepartmentCoursesToUser(member.id, department.id)).resolves.toBeUndefined();
    } finally {
      await cleanup([member.id], [course.id], department.id);
    }
  });
});

describe("unassignCourseFromDepartment", () => {
  it("removes the department-level record without touching existing member assignments", async () => {
    const department = await seedDepartment();
    const member = await seedUser(department.id);
    const course = await seedCourse();

    try {
      await assignCourseToDepartment(course.id, department.id, "admin@example.com");
      await unassignCourseFromDepartment(course.id, department.id);

      expect(await listCourseAssignmentsForDepartment(department.id)).toHaveLength(0);
      const rows = await db.select().from(courseAssignments).where(eq(courseAssignments.userId, member.id));
      expect(rows).toHaveLength(1);
    } finally {
      await cleanup([member.id], [course.id], department.id);
    }
  });
});
