import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "./client";
import {
  courses,
  enrollments,
  moduleProgress,
  modules,
  moduleVersions,
  departments,
  users,
  moduleAttempts,
  quizModuleVersions,
  quizQuestions,
  quizChoices,
  quizAttemptAnswers,
  textModuleVersions,
} from "./schema";

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
    const names = rows.map((r) => r.name);
    expect(names).toEqual(
      expect.arrayContaining(["Claims", "Compliance", "Engineering", "HR", "IT", "Underwriting"])
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

  it("resolves exact, case-insensitive, and whitespace-padded matches, and leaves no-match as null", async () => {
    await db.execute(
      sql.raw(`CREATE TABLE "${tableName}" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "department" text, "department_id" uuid)`)
    );
    await db.execute(
      sql.raw(`INSERT INTO "${tableName}" ("department") VALUES ('Compliance'), ('hr'), ('  HR  '), ('Not A Real Department'), (NULL)`)
    );

    await db.execute(
      sql.raw(`UPDATE "${tableName}" SET "department_id" = "departments"."id"
        FROM "departments"
        WHERE lower(btrim("${tableName}"."department")) = lower(btrim("departments"."name"))
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
    expect(byDept("  HR  ")?.department_id).toBe(hr.id);
    expect(byDept("Not A Real Department")?.department_id).toBeNull();
    expect(rows.rows.find((r) => r.department === null)?.department_id).toBeNull();
  });
});

describe("enrollments", () => {
  it("enforces one enrollment per (user, course) pair", async () => {
    const [user] = await db
      .insert(users)
      .values({ email: `enroll-test-${randomUUID()}@example.com`, displayName: "Enroll Test" })
      .returning();
    const [course] = await db
      .insert(courses)
      .values({ code: `ENROLL-${randomUUID()}`, title: "Enroll Test Course" })
      .returning();
    try {
      await db.insert(enrollments).values({ userId: user.id, courseId: course.id });
      await expect(db.insert(enrollments).values({ userId: user.id, courseId: course.id })).rejects.toThrow();
    } finally {
      await db.delete(enrollments).where(eq(enrollments.userId, user.id));
      await db.delete(courses).where(eq(courses.id, course.id));
      await db.delete(users).where(eq(users.id, user.id));
    }
  });

  it("defaults status to not_started and source to assigned", async () => {
    const [user] = await db
      .insert(users)
      .values({ email: `enroll-default-${randomUUID()}@example.com`, displayName: "Enroll Default" })
      .returning();
    const [course] = await db
      .insert(courses)
      .values({ code: `ENROLL-DEFAULT-${randomUUID()}`, title: "Enroll Default Course" })
      .returning();
    try {
      const [row] = await db.insert(enrollments).values({ userId: user.id, courseId: course.id }).returning();
      expect(row.status).toBe("not_started");
      expect(row.source).toBe("assigned");
    } finally {
      await db.delete(enrollments).where(eq(enrollments.userId, user.id));
      await db.delete(courses).where(eq(courses.id, course.id));
      await db.delete(users).where(eq(users.id, user.id));
    }
  });
});

describe("moduleProgress", () => {
  it("enforces one progress row per (enrollment, module) pair", async () => {
    const [user] = await db
      .insert(users)
      .values({ email: `progress-test-${randomUUID()}@example.com`, displayName: "Progress Test" })
      .returning();
    const [course] = await db
      .insert(courses)
      .values({ code: `PROGRESS-${randomUUID()}`, title: "Progress Test Course" })
      .returning();
    const [mod] = await db
      .insert(modules)
      .values({ courseId: course.id, moduleType: "scorm", title: "Module 1" })
      .returning();
    const [enrollment] = await db.insert(enrollments).values({ userId: user.id, courseId: course.id }).returning();
    try {
      await db.insert(moduleProgress).values({ enrollmentId: enrollment.id, moduleId: mod.id });
      await expect(
        db.insert(moduleProgress).values({ enrollmentId: enrollment.id, moduleId: mod.id })
      ).rejects.toThrow();
    } finally {
      await db.delete(moduleProgress).where(eq(moduleProgress.enrollmentId, enrollment.id));
      await db.delete(enrollments).where(eq(enrollments.id, enrollment.id));
      await db.delete(modules).where(eq(modules.id, mod.id));
      await db.delete(courses).where(eq(courses.id, course.id));
      await db.delete(users).where(eq(users.id, user.id));
    }
  });
});

describe("quiz schema", () => {
  it("supports a full quiz module version with questions, choices, and a scored attempt answer", async () => {
    const [user] = await db
      .insert(users)
      .values({ email: `quiz-schema-${randomUUID()}@example.com`, displayName: "Quiz Schema Test" })
      .returning();
    const [course] = await db
      .insert(courses)
      .values({ code: `QUIZ-SCHEMA-${randomUUID()}`, title: "Quiz Schema Course" })
      .returning();
    const [mod] = await db
      .insert(modules)
      .values({ courseId: course.id, moduleType: "quiz", title: "Quiz Module" })
      .returning();
    const [version] = await db
      .insert(moduleVersions)
      .values({ moduleId: mod.id, versionNumber: 1, status: "draft" })
      .returning();
    const [quizVersion] = await db
      .insert(quizModuleVersions)
      .values({ moduleVersionId: version.id, passingScorePct: 70 })
      .returning();
    const [question] = await db
      .insert(quizQuestions)
      .values({
        quizModuleVersionId: quizVersion.moduleVersionId,
        sortOrder: 0,
        questionType: "single_choice",
        prompt: "2 + 2?",
        points: 1,
      })
      .returning();
    const [choiceA] = await db
      .insert(quizChoices)
      .values({ questionId: question.id, sortOrder: 0, choiceText: "3", isCorrect: false })
      .returning();
    const [choiceB] = await db
      .insert(quizChoices)
      .values({ questionId: question.id, sortOrder: 1, choiceText: "4", isCorrect: true })
      .returning();
    const [attempt] = await db
      .insert(moduleAttempts)
      .values({ moduleVersionId: version.id, userId: user.id, attemptNumber: 1 })
      .returning();

    try {
      const [answer] = await db
        .insert(quizAttemptAnswers)
        .values({
          moduleAttemptId: attempt.id,
          questionId: question.id,
          selectedChoiceIds: [choiceB.id],
          isCorrect: true,
        })
        .returning();
      expect(answer.isCorrect).toBe(true);
      expect(answer.selectedChoiceIds).toEqual([choiceB.id]);

      await expect(
        db.insert(quizAttemptAnswers).values({
          moduleAttemptId: attempt.id,
          questionId: question.id,
          selectedChoiceIds: [choiceA.id],
          isCorrect: false,
        })
      ).rejects.toThrow();
    } finally {
      await db.delete(quizAttemptAnswers).where(eq(quizAttemptAnswers.moduleAttemptId, attempt.id));
      await db.delete(moduleAttempts).where(eq(moduleAttempts.id, attempt.id));
      await db.delete(quizChoices).where(eq(quizChoices.questionId, question.id));
      await db.delete(quizQuestions).where(eq(quizQuestions.id, question.id));
      await db.delete(quizModuleVersions).where(eq(quizModuleVersions.moduleVersionId, version.id));
      await db.delete(moduleVersions).where(eq(moduleVersions.id, version.id));
      await db.delete(modules).where(eq(modules.id, mod.id));
      await db.delete(courses).where(eq(courses.id, course.id));
      await db.delete(users).where(eq(users.id, user.id));
    }
  });
});

describe("text module schema", () => {
  it("supports a text module version with a large text body", async () => {
    const [course] = await db
      .insert(courses)
      .values({ code: `TEXT-SCHEMA-${randomUUID()}`, title: "Text Schema Course" })
      .returning();
    const [mod] = await db
      .insert(modules)
      .values({ courseId: course.id, moduleType: "text", title: "Text Module" })
      .returning();
    const [version] = await db
      .insert(moduleVersions)
      .values({ moduleId: mod.id, versionNumber: 1, status: "draft" })
      .returning();

    const longBody = "This is a paragraph of reading content. ".repeat(200);

    try {
      const [textVersion] = await db
        .insert(textModuleVersions)
        .values({ moduleVersionId: version.id, body: longBody })
        .returning();
      expect(textVersion.body).toBe(longBody);
      expect(textVersion.body.length).toBeGreaterThan(2000);
    } finally {
      await db.delete(textModuleVersions).where(eq(textModuleVersions.moduleVersionId, version.id));
      await db.delete(moduleVersions).where(eq(moduleVersions.id, version.id));
      await db.delete(modules).where(eq(modules.id, mod.id));
      await db.delete(courses).where(eq(courses.id, course.id));
    }
  });
});
