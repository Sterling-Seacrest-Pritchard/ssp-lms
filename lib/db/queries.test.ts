import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { listRealCourses, getRealCourseDetail } from "./queries";
import { db } from "./client";
import { courses, modules, moduleVersions } from "./schema";

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

describe("getRealCourseDetail", () => {
  const courseCode = `QUERIES-DETAIL-TEST-${randomUUID()}`;

  afterAll(async () => {
    const [course] = await db.select().from(courses).where(eq(courses.code, courseCode));
    if (course) {
      const mods = await db.select().from(modules).where(eq(modules.courseId, course.id));
      const moduleIds = mods.map((m) => m.id);
      if (moduleIds.length) {
        for (const moduleId of moduleIds) {
          await db.update(modules).set({ currentVersionId: null }).where(eq(modules.id, moduleId));
        }
        const versions = await db
          .select()
          .from(moduleVersions)
          .where(inArray(moduleVersions.moduleId, moduleIds));
        if (versions.length) {
          await db.delete(moduleVersions).where(inArray(moduleVersions.id, versions.map((v) => v.id)));
        }
        await db.delete(modules).where(inArray(modules.id, moduleIds));
      }
      await db.delete(courses).where(eq(courses.id, course.id));
    }
  });

  it("returns null for an unknown course id", async () => {
    const result = await getRealCourseDetail(randomUUID());
    expect(result).toBeNull();
  });

  it("returns the course with its modules, resolving each module's currentVersionId", async () => {
    const [course] = await db
      .insert(courses)
      .values({ code: courseCode, title: "Detail Test Course" })
      .returning();
    const [courseModule] = await db
      .insert(modules)
      .values({ courseId: course.id, moduleType: "scorm", title: "Detail Test Module" })
      .returning();
    const [version] = await db
      .insert(moduleVersions)
      .values({ moduleId: courseModule.id, versionNumber: 1, status: "published" })
      .returning();
    await db
      .update(modules)
      .set({ currentVersionId: version.id })
      .where(eq(modules.id, courseModule.id));

    const result = await getRealCourseDetail(course.id);

    expect(result).not.toBeNull();
    expect(result?.title).toBe("Detail Test Course");
    expect(result?.modules).toHaveLength(1);
    expect(result?.modules[0]).toEqual({
      id: courseModule.id,
      title: "Detail Test Module",
      moduleVersionId: version.id,
    });
  });

  it("excludes modules with no currentVersionId (never had a version published)", async () => {
    const [course] = await db
      .insert(courses)
      .values({ code: `${courseCode}-nopub`, title: "No Publish Test" })
      .returning();
    try {
      await db
        .insert(modules)
        .values({ courseId: course.id, moduleType: "scorm", title: "Unpublished Module" });

      const result = await getRealCourseDetail(course.id);

      expect(result?.modules).toHaveLength(0);
    } finally {
      await db.delete(modules).where(eq(modules.courseId, course.id));
      await db.delete(courses).where(eq(courses.id, course.id));
    }
  });
});
