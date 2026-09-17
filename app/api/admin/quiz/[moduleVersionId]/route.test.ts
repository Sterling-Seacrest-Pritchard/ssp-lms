import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { PATCH } from "./route";
import { createQuizModule } from "@/lib/db/quiz-authoring";
import { db } from "@/lib/db/client";
import { courses, modules, moduleVersions, quizModuleVersions } from "@/lib/db/schema";

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
});
