import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { getScormLaunchInfo, getScormLaunchInfoForAdmin } from "./launch-info";
import { db } from "@/lib/db/client";
import { courses, modules, moduleVersions, scormModuleVersions } from "@/lib/db/schema";

async function seedScormModule(status: string) {
  const [course] = await db
    .insert(courses)
    .values({ code: `LAUNCH-INFO-TEST-${randomUUID()}`, title: "Launch Info Test", status })
    .returning();
  const [courseModule] = await db
    .insert(modules)
    .values({ courseId: course.id, moduleType: "scorm", title: "Module" })
    .returning();
  const [version] = await db
    .insert(moduleVersions)
    .values({ moduleId: courseModule.id, versionNumber: 1, status: "published" })
    .returning();
  await db.insert(scormModuleVersions).values({
    moduleVersionId: version.id,
    gcsPrefix: "launch-info-prefix",
    manifestIdentifier: "x",
    scormVersion: "1.2",
    launchUrl: "index.html",
    rawManifestXml: "<manifest/>",
  });

  return {
    moduleVersionId: version.id,
    async cleanup() {
      await db
        .delete(scormModuleVersions)
        .where(eq(scormModuleVersions.moduleVersionId, version.id));
      await db.delete(moduleVersions).where(eq(moduleVersions.id, version.id));
      await db.delete(modules).where(eq(modules.id, courseModule.id));
      await db.delete(courses).where(eq(courses.id, course.id));
    },
  };
}

describe("getScormLaunchInfo", () => {
  it("returns launch details for a module in a published course", async () => {
    const seeded = await seedScormModule("published");
    try {
      const info = await getScormLaunchInfo(seeded.moduleVersionId);
      expect(info).toEqual({
        launchUrl: "index.html",
        gcsPrefix: "launch-info-prefix",
        scormVersion: "1.2",
      });
    } finally {
      await seeded.cleanup();
    }
  });

  it("returns null for a module in a draft course", async () => {
    const seeded = await seedScormModule("draft");
    try {
      expect(await getScormLaunchInfo(seeded.moduleVersionId)).toBeNull();
    } finally {
      await seeded.cleanup();
    }
  });

  it("returns null for a non-UUID id and for an unknown module version", async () => {
    expect(await getScormLaunchInfo("not-a-uuid")).toBeNull();
    expect(await getScormLaunchInfo(randomUUID())).toBeNull();
  });
});

describe("getScormLaunchInfoForAdmin", () => {
  it("returns launch details even for a draft course, so an admin can test before publishing", async () => {
    const seeded = await seedScormModule("draft");
    try {
      const info = await getScormLaunchInfoForAdmin(seeded.moduleVersionId);
      expect(info?.launchUrl).toBe("index.html");
    } finally {
      await seeded.cleanup();
    }
  });
});
