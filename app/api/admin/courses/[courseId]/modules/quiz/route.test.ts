import { describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { POST } from "./route";
import { db } from "@/lib/db/client";
import { courses, modules, moduleVersions, quizModuleVersions, departments, departmentAdmins, users } from "@/lib/db/schema";
import { auth } from "@/auth";

vi.mock("@/auth", () => ({
  auth: vi.fn().mockResolvedValue({ user: { email: "org-admin@example.com", roles: ["OrgAdmin"] } }),
}));

describe("POST /api/admin/courses/[courseId]/modules/quiz", () => {
  it("creates a quiz module for the course", async () => {
    const [course] = await db.insert(courses).values({ code: `ADMIN-QUIZ-${randomUUID()}`, title: "x" }).returning();
    let moduleId: string | undefined;
    let moduleVersionId: string | undefined;
    try {
      const response = await POST(
        new NextRequest("http://localhost/x", { method: "POST", body: JSON.stringify({ title: "New Quiz" }) }),
        { params: Promise.resolve({ courseId: course.id }) }
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.moduleId).toBeDefined();
      expect(body.moduleVersionId).toBeDefined();
      moduleId = body.moduleId;
      moduleVersionId = body.moduleVersionId;

      const [mod] = await db.select().from(modules).where(eq(modules.id, body.moduleId));
      expect(mod.moduleType).toBe("quiz");
      expect(mod.title).toBe("New Quiz");
    } finally {
      if (moduleVersionId) {
        await db.delete(quizModuleVersions).where(eq(quizModuleVersions.moduleVersionId, moduleVersionId));
      }
      await db.update(modules).set({ currentVersionId: null }).where(eq(modules.courseId, course.id));
      if (moduleId) {
        await db.delete(moduleVersions).where(eq(moduleVersions.moduleId, moduleId));
      }
      await db.delete(modules).where(eq(modules.courseId, course.id));
      await db.delete(courses).where(eq(courses.id, course.id));
    }
  });

  it("404s a Department Admin from a different department, creating no module", async () => {
    const [course] = await db.insert(courses).values({ code: `ADMIN-QUIZ-${randomUUID()}`, title: "x" }).returning();
    const [otherDept] = await db.insert(departments).values({ name: `Dept-${randomUUID()}` }).returning();
    await db.update(courses).set({ departmentId: otherDept.id }).where(eq(courses.id, course.id));
    const email = `dept-admin-quiz-${randomUUID()}@example.com`;
    const [dept] = await db.insert(departments).values({ name: `Dept-${randomUUID()}` }).returning();
    const [user] = await db
      .insert(users)
      .values({ email, displayName: "Dept Admin", entraRole: "Department Admin" })
      .returning();
    await db.insert(departmentAdmins).values({ userId: user.id, departmentId: dept.id });
    vi.mocked(auth).mockResolvedValueOnce({ user: { email, roles: ["DepartmentAdmin"] } } as never);
    try {
      const response = await POST(
        new NextRequest("http://localhost/x", { method: "POST", body: JSON.stringify({ title: "Nope" }) }),
        { params: Promise.resolve({ courseId: course.id }) }
      );
      expect(response.status).toBe(404);

      const remaining = await db.select().from(modules).where(eq(modules.courseId, course.id));
      expect(remaining).toHaveLength(0);
    } finally {
      await db.delete(courses).where(eq(courses.id, course.id));
      await db.delete(departmentAdmins).where(eq(departmentAdmins.userId, user.id));
      await db.delete(users).where(eq(users.id, user.id));
      await db.delete(departments).where(eq(departments.id, dept.id));
      await db.delete(departments).where(eq(departments.id, otherDept.id));
    }
  });
});
