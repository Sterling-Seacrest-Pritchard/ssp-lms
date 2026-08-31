import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { listRealCourses } from "./queries";
import { db } from "./client";
import { courses, modules } from "./schema";

describe("listRealCourses", () => {
  const courseCode = `QUERIES-TEST-${randomUUID()}`;

  afterAll(async () => {
    const [course] = await db.select().from(courses).where(eq(courses.code, courseCode));
    if (course) {
      await db.delete(modules).where(eq(modules.courseId, course.id));
      await db.delete(courses).where(eq(courses.id, course.id));
    }
  });

  it("returns a course with its real module count", async () => {
    const [course] = await db
      .insert(courses)
      .values({ code: courseCode, title: "Queries Test Course" })
      .returning();
    await db.insert(modules).values([
      { courseId: course.id, moduleType: "scorm", title: "Module A" },
      { courseId: course.id, moduleType: "scorm", title: "Module B" },
    ]);

    const results = await listRealCourses();
    const found = results.find((c) => c.id === course.id);

    expect(found).toBeDefined();
    expect(found?.title).toBe("Queries Test Course");
    expect(found?.moduleCount).toBe(2);
  });
});
