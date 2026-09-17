import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { POST } from "./route";
import { db } from "@/lib/db/client";
import { courses, modules, moduleVersions, textModuleVersions } from "@/lib/db/schema";

describe("POST /api/admin/courses/[courseId]/modules/text", () => {
  it("creates a text module for the course with the given body", async () => {
    const [course] = await db.insert(courses).values({ code: `ADMIN-TEXT-${randomUUID()}`, title: "x" }).returning();
    let moduleId: string | undefined;
    let moduleVersionId: string | undefined;
    try {
      const response = await POST(
        new NextRequest("http://localhost/x", {
          method: "POST",
          body: JSON.stringify({ title: "New Text Module", body: "A long paragraph of reading content." }),
        }),
        { params: Promise.resolve({ courseId: course.id }) }
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.moduleId).toBeDefined();
      expect(body.moduleVersionId).toBeDefined();
      moduleId = body.moduleId;
      moduleVersionId = body.moduleVersionId;

      const [mod] = await db.select().from(modules).where(eq(modules.id, body.moduleId));
      expect(mod.moduleType).toBe("text");
      expect(mod.title).toBe("New Text Module");

      const [textVersion] = await db
        .select()
        .from(textModuleVersions)
        .where(eq(textModuleVersions.moduleVersionId, body.moduleVersionId));
      expect(textVersion.body).toBe("A long paragraph of reading content.");
    } finally {
      if (moduleVersionId) {
        await db.delete(textModuleVersions).where(eq(textModuleVersions.moduleVersionId, moduleVersionId));
      }
      await db.update(modules).set({ currentVersionId: null }).where(eq(modules.courseId, course.id));
      if (moduleId) {
        await db.delete(moduleVersions).where(eq(moduleVersions.moduleId, moduleId));
      }
      await db.delete(modules).where(eq(modules.courseId, course.id));
      await db.delete(courses).where(eq(courses.id, course.id));
    }
  });

  it("rejects a missing or blank body with 400", async () => {
    const [course] = await db.insert(courses).values({ code: `ADMIN-TEXT-BLANK-${randomUUID()}`, title: "x" }).returning();
    try {
      const response = await POST(
        new NextRequest("http://localhost/x", {
          method: "POST",
          body: JSON.stringify({ title: "New Text Module", body: "   " }),
        }),
        { params: Promise.resolve({ courseId: course.id }) }
      );
      expect(response.status).toBe(400);
    } finally {
      await db.delete(courses).where(eq(courses.id, course.id));
    }
  });
});
