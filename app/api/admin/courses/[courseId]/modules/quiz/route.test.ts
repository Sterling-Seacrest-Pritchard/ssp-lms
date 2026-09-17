import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { POST } from "./route";
import { db } from "@/lib/db/client";
import { courses, modules, moduleVersions, quizModuleVersions } from "@/lib/db/schema";

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
});
