import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { POST } from "./route";
import { db } from "@/lib/db/client";
import { courses, modules, moduleVersions, moduleAttempts } from "@/lib/db/schema";

describe("POST /api/scorm/attempts", () => {
  const courseCode = `ATTEMPT-TEST-${randomUUID()}`;
  let moduleVersionId: string;

  async function seed() {
    const [course] = await db.insert(courses).values({ code: courseCode, title: "t" }).returning();
    const [courseModule] = await db
      .insert(modules)
      .values({ courseId: course.id, moduleType: "scorm", title: "t" })
      .returning();
    const [version] = await db
      .insert(moduleVersions)
      .values({ moduleId: courseModule.id, versionNumber: 1, status: "published" })
      .returning();
    moduleVersionId = version.id;
  }

  afterAll(async () => {
    // Clean up in FK dependency order: moduleAttempts -> moduleVersions -> modules -> courses.
    const [course] = await db.select().from(courses).where(eq(courses.code, courseCode));
    if (course) {
      const courseModules = await db.select().from(modules).where(eq(modules.courseId, course.id));
      for (const courseModule of courseModules) {
        const versions = await db
          .select()
          .from(moduleVersions)
          .where(eq(moduleVersions.moduleId, courseModule.id));
        for (const version of versions) {
          await db.delete(moduleAttempts).where(eq(moduleAttempts.moduleVersionId, version.id));
        }
        await db.delete(moduleVersions).where(eq(moduleVersions.moduleId, courseModule.id));
      }
      await db.delete(modules).where(eq(modules.courseId, course.id));
      await db.delete(courses).where(eq(courses.id, course.id));
    }
  });

  it("creates a first attempt numbered 1, then a second numbered 2", async () => {
    await seed();

    const first = await POST(
      new NextRequest("http://localhost/api/scorm/attempts", {
        method: "POST",
        body: JSON.stringify({ moduleVersionId, userId: "user-1" }),
      })
    );
    const firstBody = await first.json();
    expect(firstBody.attemptNumber).toBe(1);

    const second = await POST(
      new NextRequest("http://localhost/api/scorm/attempts", {
        method: "POST",
        body: JSON.stringify({ moduleVersionId, userId: "user-1" }),
      })
    );
    const secondBody = await second.json();
    expect(secondBody.attemptNumber).toBe(2);

    const rows = await db
      .select()
      .from(moduleAttempts)
      .where(eq(moduleAttempts.moduleVersionId, moduleVersionId));
    expect(rows).toHaveLength(2);
  });
});
