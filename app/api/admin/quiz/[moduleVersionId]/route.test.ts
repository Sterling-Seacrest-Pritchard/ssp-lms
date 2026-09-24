import { describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { PATCH } from "./route";
import { createQuizModule } from "@/lib/db/quiz-authoring";
import { db } from "@/lib/db/client";
import { courses, modules, moduleVersions, quizModuleVersions, departments, departmentAdmins, users } from "@/lib/db/schema";
import { auth } from "@/auth";

vi.mock("@/auth", () => ({
  auth: vi.fn().mockResolvedValue({ user: { email: "org-admin@example.com", roles: ["OrgAdmin"] } }),
}));

describe("PATCH /api/admin/quiz/[moduleVersionId]", () => {
  it("updates the passing score", async () => {
    const [course] = await db.insert(courses).values({ code: `ADMIN-QUIZ-SCORE-${randomUUID()}`, title: "x" }).returning();
    const { moduleId, moduleVersionId } = await createQuizModule(course.id, "Quiz");
    try {
      const response = await PATCH(
        new NextRequest("http://localhost/x", { method: "PATCH", body: JSON.stringify({ passingScorePct: 90 }) }),
        { params: Promise.resolve({ moduleVersionId }) }
      );
      expect(response.status).toBe(200);
      const [quizVersion] = await db.select().from(quizModuleVersions).where(eq(quizModuleVersions.moduleVersionId, moduleVersionId));
      expect(quizVersion.passingScorePct).toBe(90);
    } finally {
      await db.delete(quizModuleVersions).where(eq(quizModuleVersions.moduleVersionId, moduleVersionId));
      await db.update(modules).set({ currentVersionId: null }).where(eq(modules.id, moduleId));
      await db.delete(moduleVersions).where(eq(moduleVersions.id, moduleVersionId));
      await db.delete(modules).where(eq(modules.id, moduleId));
      await db.delete(courses).where(eq(courses.id, course.id));
    }
  });

  it("404s a Department Admin from a different department, leaving the passing score untouched", async () => {
    const [course] = await db.insert(courses).values({ code: `ADMIN-QUIZ-SCORE-404-${randomUUID()}`, title: "x" }).returning();
    const { moduleId, moduleVersionId } = await createQuizModule(course.id, "Quiz");
    const [otherDept] = await db.insert(departments).values({ name: `Dept-${randomUUID()}` }).returning();
    await db.update(courses).set({ departmentId: otherDept.id }).where(eq(courses.id, course.id));
    const email = `dept-admin-quiz-score-${randomUUID()}@example.com`;
    const [dept] = await db.insert(departments).values({ name: `Dept-${randomUUID()}` }).returning();
    const [user] = await db
      .insert(users)
      .values({ email, displayName: "Dept Admin", entraRole: "Department Admin" })
      .returning();
    await db.insert(departmentAdmins).values({ userId: user.id, departmentId: dept.id });
    vi.mocked(auth).mockResolvedValueOnce({ user: { email, roles: ["DepartmentAdmin"] } } as never);
    try {
      const response = await PATCH(
        new NextRequest("http://localhost/x", { method: "PATCH", body: JSON.stringify({ passingScorePct: 99 }) }),
        { params: Promise.resolve({ moduleVersionId }) }
      );
      expect(response.status).toBe(404);
      const [quizVersion] = await db.select().from(quizModuleVersions).where(eq(quizModuleVersions.moduleVersionId, moduleVersionId));
      expect(quizVersion.passingScorePct).not.toBe(99);
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
