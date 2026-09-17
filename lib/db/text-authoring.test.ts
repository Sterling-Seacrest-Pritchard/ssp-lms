import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createTextModule, updateTextBody } from "./text-authoring";
import { db } from "./client";
import { courses, modules, moduleVersions, textModuleVersions } from "./schema";

async function cleanup(courseId: string) {
  const mods = await db.select().from(modules).where(eq(modules.courseId, courseId));
  for (const mod of mods) {
    const versions = await db.select().from(moduleVersions).where(eq(moduleVersions.moduleId, mod.id));
    for (const version of versions) {
      await db.delete(textModuleVersions).where(eq(textModuleVersions.moduleVersionId, version.id));
    }
    await db.update(modules).set({ currentVersionId: null }).where(eq(modules.id, mod.id));
    await db.delete(moduleVersions).where(eq(moduleVersions.moduleId, mod.id));
  }
  await db.delete(modules).where(eq(modules.courseId, courseId));
  await db.delete(courses).where(eq(courses.id, courseId));
}

describe("createTextModule", () => {
  it("creates a draft module, version, and text_module_versions row with the given body", async () => {
    const [course] = await db
      .insert(courses)
      .values({ code: `TEXT-AUTHOR-${randomUUID()}`, title: "Text Authoring Course" })
      .returning();
    try {
      const { moduleId, moduleVersionId } = await createTextModule(course.id, "New Text Module", "Paragraph one.");

      const [mod] = await db.select().from(modules).where(eq(modules.id, moduleId));
      expect(mod.moduleType).toBe("text");
      expect(mod.currentVersionId).toBe(moduleVersionId);

      const [version] = await db.select().from(moduleVersions).where(eq(moduleVersions.id, moduleVersionId));
      expect(version.status).toBe("draft");

      const [textVersion] = await db
        .select()
        .from(textModuleVersions)
        .where(eq(textModuleVersions.moduleVersionId, moduleVersionId));
      expect(textVersion.body).toBe("Paragraph one.");
    } finally {
      await cleanup(course.id);
    }
  });
});

describe("updateTextBody", () => {
  it("updates the body", async () => {
    const [course] = await db
      .insert(courses)
      .values({ code: `TEXT-AUTHOR-UPDATE-${randomUUID()}`, title: "Text Update Course" })
      .returning();
    try {
      const { moduleVersionId } = await createTextModule(course.id, "Text Module", "Old body.");
      await updateTextBody(moduleVersionId, "New, longer body with more content.");

      const [textVersion] = await db
        .select()
        .from(textModuleVersions)
        .where(eq(textModuleVersions.moduleVersionId, moduleVersionId));
      expect(textVersion.body).toBe("New, longer body with more content.");
    } finally {
      await cleanup(course.id);
    }
  });
});
