import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "./client";
import { courses, modules, moduleVersions } from "./schema";

describe("minimal SCORM schema", () => {
  const courseCode = `TEST-${randomUUID()}`;
  let courseId: string | undefined;
  let moduleId: string | undefined;

  afterAll(async () => {
    // Child rows must be deleted before their parents — the FKs have no
    // cascade delete, so removing the course first would violate them.
    if (moduleId) {
      await db.delete(moduleVersions).where(eq(moduleVersions.moduleId, moduleId));
    }
    if (courseId) {
      await db.delete(modules).where(eq(modules.courseId, courseId));
    }
    await db.delete(courses).where(eq(courses.code, courseCode));
  });

  it("inserts a course, module, and module version, and reads them back", async () => {
    const [course] = await db
      .insert(courses)
      .values({ code: courseCode, title: "Schema Test Course" })
      .returning();
    courseId = course.id;

    const [courseModule] = await db
      .insert(modules)
      .values({ courseId: course.id, moduleType: "scorm", title: "Schema Test Module" })
      .returning();
    moduleId = courseModule.id;

    const [version] = await db
      .insert(moduleVersions)
      .values({ moduleId: courseModule.id, versionNumber: 1, status: "published" })
      .returning();

    expect(version.moduleId).toBe(courseModule.id);
    expect(courseModule.courseId).toBe(course.id);
  });
});
