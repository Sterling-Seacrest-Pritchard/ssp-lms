import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { GET } from "./route";
import { db } from "@/lib/db/client";
import { courses, modules, moduleVersions, scormModuleVersions } from "@/lib/db/schema";

describe("GET /api/scorm/launch-info/[moduleVersionId]", () => {
  const courseCode = `LAUNCH-TEST-${randomUUID()}`;
  let moduleVersionId: string;

  afterAll(async () => {
    // Clean up in FK dependency order:
    // scormModuleVersions -> moduleVersions -> modules -> courses.
    const [course] = await db.select().from(courses).where(eq(courses.code, courseCode));
    if (course) {
      const courseModules = await db.select().from(modules).where(eq(modules.courseId, course.id));
      for (const courseModule of courseModules) {
        const versions = await db
          .select()
          .from(moduleVersions)
          .where(eq(moduleVersions.moduleId, courseModule.id));
        for (const version of versions) {
          await db
            .delete(scormModuleVersions)
            .where(eq(scormModuleVersions.moduleVersionId, version.id));
        }
        await db.delete(moduleVersions).where(eq(moduleVersions.moduleId, courseModule.id));
      }
      await db.delete(modules).where(eq(modules.courseId, course.id));
      await db.delete(courses).where(eq(courses.id, course.id));
    }
  });

  it("returns the launch URL and storage prefix for a module version", async () => {
    const [course] = await db.insert(courses).values({ code: courseCode, title: "t" }).returning();
    const [courseModule] = await db
      .insert(modules)
      .values({ courseId: course.id, moduleType: "scorm", title: "t" })
      .returning();
    const [version] = await db
      .insert(moduleVersions)
      .values({ moduleId: courseModule.id, versionNumber: 1, status: "published" })
      .returning();
    await db.insert(scormModuleVersions).values({
      moduleVersionId: version.id,
      gcsPrefix: "some-prefix",
      manifestIdentifier: "x",
      launchUrl: "index.html",
      rawManifestXml: "<manifest/>",
    });
    moduleVersionId = version.id;

    const response = await GET(
      new Request(`http://localhost/api/scorm/launch-info/${moduleVersionId}`),
      { params: Promise.resolve({ moduleVersionId }) }
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.launchUrl).toBe("index.html");
    expect(body.gcsPrefix).toBe("some-prefix");
  });

  it("returns 404 for an unknown module version", async () => {
    const response = await GET(
      new Request(`http://localhost/api/scorm/launch-info/${randomUUID()}`),
      { params: Promise.resolve({ moduleVersionId: randomUUID() }) }
    );
    expect(response.status).toBe(404);
  });
});
