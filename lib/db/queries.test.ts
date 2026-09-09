import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { listRealCourses, getRealCourseDetail, listPublishedCourses, getCourseForBuilder } from "./queries";
import { db } from "./client";
import { courses, modules, moduleVersions, departments } from "./schema";

describe("listRealCourses", () => {
  const courseCode = `QUERIES-TEST-${randomUUID()}`;

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
      }
      await db.delete(modules).where(eq(modules.courseId, course.id));
      await db.delete(courses).where(eq(courses.id, course.id));
    }
  });

  it("counts only published modules, matching getRealCourseDetail's notion of a module", async () => {
    const [course] = await db
      .insert(courses)
      .values({ code: courseCode, title: "Queries Test Course" })
      .returning();
    // "Module B" is intentionally left unpublished (no currentVersionId) to verify
    // it's excluded from moduleCount.
    const [publishedModule] = await db
      .insert(modules)
      .values([
        { courseId: course.id, moduleType: "scorm", title: "Module A" },
        { courseId: course.id, moduleType: "scorm", title: "Module B" },
      ])
      .returning();
    const [version] = await db
      .insert(moduleVersions)
      .values({ moduleId: publishedModule.id, versionNumber: 1, status: "published" })
      .returning();
    await db
      .update(modules)
      .set({ currentVersionId: version.id })
      .where(eq(modules.id, publishedModule.id));

    const results = await listRealCourses();
    const found = results.find((c) => c.id === course.id);

    expect(found).toBeDefined();
    expect(found?.title).toBe("Queries Test Course");
    expect(found?.moduleCount).toBe(1);
  });

  it("includes a course with zero published modules, at count 0", async () => {
    const zeroModuleCourseCode = `${courseCode}-zero`;
    const [course] = await db
      .insert(courses)
      .values({ code: zeroModuleCourseCode, title: "Zero Published Modules Course" })
      .returning();
    try {
      await db
        .insert(modules)
        .values({ courseId: course.id, moduleType: "scorm", title: "Unpublished Only" });

      const results = await listRealCourses();
      const found = results.find((c) => c.id === course.id);

      expect(found).toBeDefined();
      expect(found?.moduleCount).toBe(0);
    } finally {
      await db.delete(modules).where(eq(modules.courseId, course.id));
      await db.delete(courses).where(eq(courses.id, course.id));
    }
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

  it("returns null for a draft course (not yet published)", async () => {
    const [course] = await db
      .insert(courses)
      .values({ code: `${courseCode}-draft`, title: "Draft Test Course" })
      .returning();
    try {
      const result = await getRealCourseDetail(course.id);
      expect(result).toBeNull();
    } finally {
      await db.delete(courses).where(eq(courses.id, course.id));
    }
  });

  it("returns the course with its modules, resolving each module's currentVersionId", async () => {
    const [course] = await db
      .insert(courses)
      .values({ code: courseCode, title: "Detail Test Course", status: "published" })
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
      moduleType: "scorm",
      moduleVersionId: version.id,
    });
  });

  it("carries each module's moduleType so the learner page can tell a video placeholder from a launchable SCORM module", async () => {
    const [course] = await db
      .insert(courses)
      .values({ code: `${courseCode}-types`, title: "Module Types Test", status: "published" })
      .returning();
    const [scormModule] = await db
      .insert(modules)
      .values({ courseId: course.id, moduleType: "scorm", title: "Scorm", sortOrder: 0 })
      .returning();
    const [videoModule] = await db
      .insert(modules)
      .values({ courseId: course.id, moduleType: "video", title: "Video", sortOrder: 1 })
      .returning();
    const [scormVersion] = await db
      .insert(moduleVersions)
      .values({ moduleId: scormModule.id, versionNumber: 1, status: "published" })
      .returning();
    const [videoVersion] = await db
      .insert(moduleVersions)
      .values({ moduleId: videoModule.id, versionNumber: 1, status: "published" })
      .returning();
    await db
      .update(modules)
      .set({ currentVersionId: scormVersion.id })
      .where(eq(modules.id, scormModule.id));
    await db
      .update(modules)
      .set({ currentVersionId: videoVersion.id })
      .where(eq(modules.id, videoModule.id));

    try {
      const result = await getRealCourseDetail(course.id);

      expect(result?.modules.map((m) => m.moduleType)).toEqual(["scorm", "video"]);
    } finally {
      await db
        .update(modules)
        .set({ currentVersionId: null })
        .where(inArray(modules.id, [scormModule.id, videoModule.id]));
      await db
        .delete(moduleVersions)
        .where(inArray(moduleVersions.id, [scormVersion.id, videoVersion.id]));
      await db.delete(modules).where(inArray(modules.id, [scormModule.id, videoModule.id]));
      await db.delete(courses).where(eq(courses.id, course.id));
    }
  });

  it("excludes modules with no currentVersionId (never had a version published)", async () => {
    const [course] = await db
      .insert(courses)
      .values({ code: `${courseCode}-nopub`, title: "No Publish Test", status: "published" })
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

describe("listPublishedCourses", () => {
  const courseCode = `PUBLISHED-LIST-TEST-${randomUUID()}`;

  afterAll(async () => {
    await db.delete(courses).where(eq(courses.code, courseCode));
    await db.delete(courses).where(eq(courses.code, `${courseCode}-draft`));
  });

  it("includes only published courses, with department/thumbnail/compliance/dueDate", async () => {
    const [dept] = await db.select().from(departments).where(eq(departments.name, "Compliance"));
    await db.insert(courses).values({
      code: courseCode,
      title: "Published List Test",
      status: "published",
      departmentId: dept.id,
      thumbnail: "bg-gradient-to-br from-blue-500 to-indigo-600",
      compliance: true,
      dueDate: new Date("2026-12-01T00:00:00Z"),
    });
    await db.insert(courses).values({
      code: `${courseCode}-draft`,
      title: "Draft Should Be Excluded",
    });

    const results = await listPublishedCourses();
    const found = results.find((c) => c.code === courseCode);
    const draftFound = results.find((c) => c.code === `${courseCode}-draft`);

    expect(found).toBeDefined();
    expect(found?.department).toBe("Compliance");
    expect(found?.thumbnail).toBe("bg-gradient-to-br from-blue-500 to-indigo-600");
    expect(found?.compliance).toBe(true);
    expect(found?.dueDate).toBeTruthy();
    expect(draftFound).toBeUndefined();
  });
});

describe("getCourseForBuilder", () => {
  const courseCode = `BUILDER-TEST-${randomUUID()}`;

  afterAll(async () => {
    const [course] = await db.select().from(courses).where(eq(courses.code, courseCode));
    if (course) {
      await db.delete(modules).where(eq(modules.courseId, course.id));
      await db.delete(courses).where(eq(courses.id, course.id));
    }
  });

  it("returns a draft course with its modules regardless of publish status", async () => {
    const [course] = await db
      .insert(courses)
      .values({ code: courseCode, title: "Builder Test Course" })
      .returning();
    await db.insert(modules).values({
      courseId: course.id,
      moduleType: "video",
      title: "Builder Test Module",
      sortOrder: 0,
    });

    const result = await getCourseForBuilder(course.id);

    expect(result).not.toBeNull();
    expect(result?.status).toBe("draft");
    expect(result?.modules).toHaveLength(1);
    expect(result?.modules[0].moduleType).toBe("video");
  });

  it("returns null for an unknown course id", async () => {
    const result = await getCourseForBuilder(randomUUID());
    expect(result).toBeNull();
  });
});
