import { describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { GET, POST } from "./route";
import { createQuizModule } from "@/lib/db/quiz-authoring";
import { db } from "@/lib/db/client";
import {
  courses,
  modules,
  moduleVersions,
  quizModuleVersions,
  quizQuestions,
  quizChoices,
  departments,
  departmentAdmins,
  users,
} from "@/lib/db/schema";
import { auth } from "@/auth";

vi.mock("@/auth", () => ({
  auth: vi.fn().mockResolvedValue({ user: { email: "org-admin@example.com", roles: ["OrgAdmin"] } }),
}));

describe("POST /api/admin/quiz/[moduleVersionId]/questions", () => {
  it("adds a question with choices", async () => {
    const [course] = await db.insert(courses).values({ code: `ADMIN-QUIZ-Q-${randomUUID()}`, title: "x" }).returning();
    const { moduleId, moduleVersionId } = await createQuizModule(course.id, "Quiz");
    try {
      const response = await POST(
        new NextRequest("http://localhost/x", {
          method: "POST",
          body: JSON.stringify({
            questionType: "single_choice",
            prompt: "2+2?",
            points: 1,
            choices: [{ choiceText: "3", isCorrect: false }, { choiceText: "4", isCorrect: true }],
          }),
        }),
        { params: Promise.resolve({ moduleVersionId }) }
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.questionId).toBeDefined();
    } finally {
      const questions = await db.select().from(quizQuestions).where(eq(quizQuestions.quizModuleVersionId, moduleVersionId));
      for (const q of questions) await db.delete(quizChoices).where(eq(quizChoices.questionId, q.id));
      await db.delete(quizQuestions).where(eq(quizQuestions.quizModuleVersionId, moduleVersionId));
      await db.delete(quizModuleVersions).where(eq(quizModuleVersions.moduleVersionId, moduleVersionId));
      await db.update(modules).set({ currentVersionId: null }).where(eq(modules.id, moduleId));
      await db.delete(moduleVersions).where(eq(moduleVersions.id, moduleVersionId));
      await db.delete(modules).where(eq(modules.id, moduleId));
      await db.delete(courses).where(eq(courses.id, course.id));
    }
  });

  it("rejects a 'text' question type with 400", async () => {
    const [course] = await db.insert(courses).values({ code: `ADMIN-QUIZ-TXT-${randomUUID()}`, title: "x" }).returning();
    const { moduleId, moduleVersionId } = await createQuizModule(course.id, "Quiz");
    try {
      const response = await POST(
        new NextRequest("http://localhost/x", {
          method: "POST",
          body: JSON.stringify({ questionType: "text", prompt: "Explain", points: 1, choices: [] }),
        }),
        { params: Promise.resolve({ moduleVersionId }) }
      );
      expect(response.status).toBe(400);
    } finally {
      await db.delete(quizModuleVersions).where(eq(quizModuleVersions.moduleVersionId, moduleVersionId));
      await db.update(modules).set({ currentVersionId: null }).where(eq(modules.id, moduleId));
      await db.delete(moduleVersions).where(eq(moduleVersions.id, moduleVersionId));
      await db.delete(modules).where(eq(modules.id, moduleId));
      await db.delete(courses).where(eq(courses.id, course.id));
    }
  });

  it("404s a Department Admin from a different department, creating no question", async () => {
    const [course] = await db.insert(courses).values({ code: `ADMIN-QUIZ-Q-404-${randomUUID()}`, title: "x" }).returning();
    const { moduleId, moduleVersionId } = await createQuizModule(course.id, "Quiz");
    const [otherDept] = await db.insert(departments).values({ name: `Dept-${randomUUID()}` }).returning();
    await db.update(courses).set({ departmentId: otherDept.id }).where(eq(courses.id, course.id));
    const email = `dept-admin-quiz-add-q-${randomUUID()}@example.com`;
    const [dept] = await db.insert(departments).values({ name: `Dept-${randomUUID()}` }).returning();
    const [user] = await db
      .insert(users)
      .values({ email, displayName: "Dept Admin", entraRole: "Department Admin" })
      .returning();
    await db.insert(departmentAdmins).values({ userId: user.id, departmentId: dept.id });
    vi.mocked(auth).mockResolvedValueOnce({ user: { email, roles: ["DepartmentAdmin"] } } as never);
    try {
      const response = await POST(
        new NextRequest("http://localhost/x", {
          method: "POST",
          body: JSON.stringify({
            questionType: "single_choice",
            prompt: "Nope",
            points: 1,
            choices: [{ choiceText: "x", isCorrect: true }],
          }),
        }),
        { params: Promise.resolve({ moduleVersionId }) }
      );
      expect(response.status).toBe(404);
      const remaining = await db.select().from(quizQuestions).where(eq(quizQuestions.quizModuleVersionId, moduleVersionId));
      expect(remaining).toHaveLength(0);
    } finally {
      await db.delete(quizModuleVersions).where(eq(quizModuleVersions.moduleVersionId, moduleVersionId));
      await db.update(modules).set({ currentVersionId: null }).where(eq(modules.id, moduleId));
      await db.delete(moduleVersions).where(eq(moduleVersions.id, moduleVersionId));
      await db.delete(modules).where(eq(modules.id, moduleId));
      await db.delete(courses).where(eq(courses.id, course.id));
      await db.delete(departmentAdmins).where(eq(departmentAdmins.userId, user.id));
      await db.delete(users).where(eq(users.id, user.id));
      await db.delete(departments).where(eq(departments.id, dept.id));
      await db.delete(departments).where(eq(departments.id, otherDept.id));
    }
  });
});

describe("GET /api/admin/quiz/[moduleVersionId]/questions", () => {
  it("lists questions with their choices in sort order", async () => {
    const [course] = await db.insert(courses).values({ code: `ADMIN-QUIZ-LIST-${randomUUID()}`, title: "x" }).returning();
    const { moduleId, moduleVersionId } = await createQuizModule(course.id, "Quiz");
    try {
      await POST(
        new NextRequest("http://localhost/x", {
          method: "POST",
          body: JSON.stringify({
            questionType: "true_false",
            prompt: "The sky is blue.",
            points: 1,
            choices: [{ choiceText: "True", isCorrect: true }, { choiceText: "False", isCorrect: false }],
          }),
        }),
        { params: Promise.resolve({ moduleVersionId }) }
      );

      const response = await GET(new NextRequest("http://localhost/x"), { params: Promise.resolve({ moduleVersionId }) });
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.questions).toHaveLength(1);
      expect(body.questions[0].choices).toHaveLength(2);
    } finally {
      const questions = await db.select().from(quizQuestions).where(eq(quizQuestions.quizModuleVersionId, moduleVersionId));
      for (const q of questions) await db.delete(quizChoices).where(eq(quizChoices.questionId, q.id));
      await db.delete(quizQuestions).where(eq(quizQuestions.quizModuleVersionId, moduleVersionId));
      await db.delete(quizModuleVersions).where(eq(quizModuleVersions.moduleVersionId, moduleVersionId));
      await db.update(modules).set({ currentVersionId: null }).where(eq(modules.id, moduleId));
      await db.delete(moduleVersions).where(eq(moduleVersions.id, moduleVersionId));
      await db.delete(modules).where(eq(modules.id, moduleId));
      await db.delete(courses).where(eq(courses.id, course.id));
    }
  });

  it("404s a Department Admin from a different department", async () => {
    const [course] = await db.insert(courses).values({ code: `ADMIN-QUIZ-LIST-404-${randomUUID()}`, title: "x" }).returning();
    const { moduleId, moduleVersionId } = await createQuizModule(course.id, "Quiz");
    const [otherDept] = await db.insert(departments).values({ name: `Dept-${randomUUID()}` }).returning();
    await db.update(courses).set({ departmentId: otherDept.id }).where(eq(courses.id, course.id));
    const email = `dept-admin-quiz-list-${randomUUID()}@example.com`;
    const [dept] = await db.insert(departments).values({ name: `Dept-${randomUUID()}` }).returning();
    const [user] = await db
      .insert(users)
      .values({ email, displayName: "Dept Admin", entraRole: "Department Admin" })
      .returning();
    await db.insert(departmentAdmins).values({ userId: user.id, departmentId: dept.id });
    vi.mocked(auth).mockResolvedValueOnce({ user: { email, roles: ["DepartmentAdmin"] } } as never);
    try {
      const response = await GET(new NextRequest("http://localhost/x"), { params: Promise.resolve({ moduleVersionId }) });
      expect(response.status).toBe(404);
    } finally {
      await db.delete(quizModuleVersions).where(eq(quizModuleVersions.moduleVersionId, moduleVersionId));
      await db.update(modules).set({ currentVersionId: null }).where(eq(modules.id, moduleId));
      await db.delete(moduleVersions).where(eq(moduleVersions.id, moduleVersionId));
      await db.delete(modules).where(eq(modules.id, moduleId));
      await db.delete(courses).where(eq(courses.id, course.id));
      await db.delete(departmentAdmins).where(eq(departmentAdmins.userId, user.id));
      await db.delete(users).where(eq(users.id, user.id));
      await db.delete(departments).where(eq(departments.id, dept.id));
      await db.delete(departments).where(eq(departments.id, otherDept.id));
    }
  });
});
