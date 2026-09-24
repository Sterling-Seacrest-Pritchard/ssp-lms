import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { getModuleVersionCourseId } from "./modules";
import { db } from "./client";
import { courses, modules, moduleVersions } from "./schema";

describe("getModuleVersionCourseId", () => {
  it("resolves a module version to its parent course id", async () => {
    const [course] = await db.insert(courses).values({ code: `MODULES-${randomUUID()}`, title: "x" }).returning();
    const [mod] = await db.insert(modules).values({ courseId: course.id, moduleType: "text", title: "x" }).returning();
    const [version] = await db.insert(moduleVersions).values({ moduleId: mod.id, versionNumber: 1, status: "draft" }).returning();
    try {
      expect(await getModuleVersionCourseId(version.id)).toBe(course.id);
    } finally {
      await db.delete(moduleVersions).where(eq(moduleVersions.id, version.id));
      await db.delete(modules).where(eq(modules.id, mod.id));
      await db.delete(courses).where(eq(courses.id, course.id));
    }
  });

  it("returns null for a well-formed but nonexistent moduleVersionId", async () => {
    expect(await getModuleVersionCourseId(randomUUID())).toBeNull();
  });

  it("returns null (not a thrown Postgres error) for a malformed moduleVersionId", async () => {
    await expect(getModuleVersionCourseId("not-a-uuid")).resolves.toBeNull();
  });
});
