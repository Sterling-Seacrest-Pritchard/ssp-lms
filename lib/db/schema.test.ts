import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "./client";
import { courses, modules, moduleVersions, departments } from "./schema";

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

describe("departments seed data", () => {
  it("was seeded with the six existing mock department names by the 0004 migration", async () => {
    const rows = await db.select({ name: departments.name }).from(departments);
    const names = rows.map((r) => r.name).sort();
    expect(names).toEqual(
      ["Claims", "Compliance", "Engineering", "HR", "IT", "Underwriting"].sort()
    );
  });
});

describe("courses.department_id backfill matching (0004 migration logic)", () => {
  // Pins the exact matching semantics the 0004 migration's backfill UPDATE
  // implements, using a scratch table shaped like the pre-migration `courses`
  // table (courses.department no longer exists post-migration, so this can't
  // exercise the real table — it exercises the same case-insensitive-match
  // SQL directly).
  const tableName = `tmp_backfill_test_${randomUUID().replace(/-/g, "")}`;

  afterAll(async () => {
    await db.execute(sql.raw(`DROP TABLE IF EXISTS "${tableName}"`));
  });

  it("resolves exact and case-insensitive matches, and leaves no-match as null", async () => {
    await db.execute(
      sql.raw(`CREATE TABLE "${tableName}" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "department" text, "department_id" uuid)`)
    );
    await db.execute(
      sql.raw(`INSERT INTO "${tableName}" ("department") VALUES ('Compliance'), ('hr'), ('Not A Real Department'), (NULL)`)
    );

    await db.execute(
      sql.raw(`UPDATE "${tableName}" SET "department_id" = "departments"."id"
        FROM "departments"
        WHERE lower("${tableName}"."department") = lower("departments"."name")
          AND "${tableName}"."department_id" IS NULL`)
    );

    const rows = await db.execute<{ department: string | null; department_id: string | null }>(
      sql.raw(`SELECT "department", "department_id" FROM "${tableName}" ORDER BY "department" NULLS LAST`)
    );
    const [compliance] = await db.select({ id: departments.id }).from(departments).where(eq(departments.name, "Compliance"));
    const [hr] = await db.select({ id: departments.id }).from(departments).where(eq(departments.name, "HR"));

    const byDept = (dept: string | null) => rows.rows.find((r) => r.department === dept);
    expect(byDept("Compliance")?.department_id).toBe(compliance.id);
    expect(byDept("hr")?.department_id).toBe(hr.id);
    expect(byDept("Not A Real Department")?.department_id).toBeNull();
    expect(rows.rows.find((r) => r.department === null)?.department_id).toBeNull();
  });
});
