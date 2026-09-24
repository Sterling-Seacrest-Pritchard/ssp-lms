import { describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { PATCH, DELETE } from "./route";
import { createQuizModule, addQuestion } from "@/lib/db/quiz-authoring";
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

describe("PATCH/DELETE /api/admin/quiz/[moduleVersionId]/questions/[questionId]", () => {
  it("updates and then deletes a question", async () => {
    const [course] = await db.insert(courses).values({ code: `ADMIN-QUIZ-QID-${randomUUID()}`, title: "x" }).returning();
    const { moduleId, moduleVersionId } = await createQuizModule(course.id, "Quiz");
    const { questionId } = await addQuestion(moduleVersionId, {
      questionType: "single_choice",
      prompt: "old prompt",
      points: 1,
      choices: [{ choiceText: "a", isCorrect: true }],
    });
    try {
      const patchResponse = await PATCH(
        new NextRequest("http://localhost/x", { method: "PATCH", body: JSON.stringify({ prompt: "new prompt" }) }),
        { params: Promise.resolve({ moduleVersionId, questionId }) }
      );
      expect(patchResponse.status).toBe(200);
      const [updated] = await db.select().from(quizQuestions).where(eq(quizQuestions.id, questionId));
      expect(updated.prompt).toBe("new prompt");

      const deleteResponse = await DELETE(new NextRequest("http://localhost/x", { method: "DELETE" }), {
        params: Promise.resolve({ moduleVersionId, questionId }),
      });
      expect(deleteResponse.status).toBe(200);
      expect(await db.select().from(quizQuestions).where(eq(quizQuestions.id, questionId))).toHaveLength(0);
    } finally {
      await db.delete(quizModuleVersions).where(eq(quizModuleVersions.moduleVersionId, moduleVersionId));
      await db.update(modules).set({ currentVersionId: null }).where(eq(modules.id, moduleId));
      await db.delete(moduleVersions).where(eq(moduleVersions.id, moduleVersionId));
      await db.delete(modules).where(eq(modules.id, moduleId));
      await db.delete(courses).where(eq(courses.id, course.id));
    }
  });

  it("404s a Department Admin from a different department on both PATCH and DELETE, leaving the question intact", async () => {
    const [course] = await db.insert(courses).values({ code: `ADMIN-QUIZ-QID-404-${randomUUID()}`, title: "x" }).returning();
    const { moduleId, moduleVersionId } = await createQuizModule(course.id, "Quiz");
    const { questionId } = await addQuestion(moduleVersionId, {
      questionType: "single_choice",
      prompt: "original prompt",
      points: 1,
      choices: [{ choiceText: "a", isCorrect: true }],
    });
    const [otherDept] = await db.insert(departments).values({ name: `Dept-${randomUUID()}` }).returning();
    await db.update(courses).set({ departmentId: otherDept.id }).where(eq(courses.id, course.id));
    const email = `dept-admin-quiz-qid-${randomUUID()}@example.com`;
    const [dept] = await db.insert(departments).values({ name: `Dept-${randomUUID()}` }).returning();
    const [user] = await db
      .insert(users)
      .values({ email, displayName: "Dept Admin", entraRole: "Department Admin" })
      .returning();
    await db.insert(departmentAdmins).values({ userId: user.id, departmentId: dept.id });
    try {
      vi.mocked(auth).mockResolvedValueOnce({ user: { email, roles: ["DepartmentAdmin"] } } as never);
      const patchResponse = await PATCH(
        new NextRequest("http://localhost/x", { method: "PATCH", body: JSON.stringify({ prompt: "hijacked" }) }),
        { params: Promise.resolve({ moduleVersionId, questionId }) }
      );
      expect(patchResponse.status).toBe(404);

      vi.mocked(auth).mockResolvedValueOnce({ user: { email, roles: ["DepartmentAdmin"] } } as never);
      const deleteResponse = await DELETE(new NextRequest("http://localhost/x", { method: "DELETE" }), {
        params: Promise.resolve({ moduleVersionId, questionId }),
      });
      expect(deleteResponse.status).toBe(404);

      const [stillThere] = await db.select().from(quizQuestions).where(eq(quizQuestions.id, questionId));
      expect(stillThere.prompt).toBe("original prompt");
    } finally {
      await db.delete(quizChoices).where(eq(quizChoices.questionId, questionId));
      await db.delete(quizQuestions).where(eq(quizQuestions.id, questionId));
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
