import { describe, it, expect, afterAll } from "vitest";
import AdmZip from "adm-zip";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { POST } from "./route";
import { db } from "@/lib/db/client";
import { courses, modules, moduleVersions, scormModuleVersions } from "@/lib/db/schema";
import { supabaseStorage } from "@/lib/storage/supabase";

function buildSamplePackage() {
  const zip = new AdmZip();
  zip.addFile(
    "imsmanifest.xml",
    Buffer.from(
      `<manifest identifier="route_test_manifest"><resources><resource href="index.html"><file href="index.html" /></resource></resources></manifest>`
    )
  );
  zip.addFile("index.html", Buffer.from("<html><body>hi</body></html>"));
  return zip.toBuffer();
}

describe("POST /api/admin/scorm-upload", () => {
  const courseCode = `ROUTE-TEST-${randomUUID()}`;
  let uploadedPrefix: string | undefined;

  afterAll(async () => {
    // Clean up in FK dependency order: scormModuleVersions -> moduleVersions ->
    // modules -> courses. modules.currentVersionId must be cleared before
    // moduleVersions rows it points to can be deleted.
    const [course] = await db.select().from(courses).where(eq(courses.code, courseCode));
    if (course) {
      const courseModules = await db.select().from(modules).where(eq(modules.courseId, course.id));
      const moduleIds = courseModules.map((m) => m.id);

      if (moduleIds.length) {
        const versions = await db
          .select()
          .from(moduleVersions)
          .where(inArray(moduleVersions.moduleId, moduleIds));
        const versionIds = versions.map((v) => v.id);

        if (versionIds.length) {
          await db
            .delete(scormModuleVersions)
            .where(inArray(scormModuleVersions.moduleVersionId, versionIds));
          await db
            .update(modules)
            .set({ currentVersionId: null })
            .where(inArray(modules.id, moduleIds));
          await db.delete(moduleVersions).where(inArray(moduleVersions.id, versionIds));
        }

        await db.delete(modules).where(inArray(modules.id, moduleIds));
      }

      await db.delete(courses).where(eq(courses.id, course.id));
    }

    if (uploadedPrefix) {
      const { data } = await supabaseStorage.from("scorm-packages").list(uploadedPrefix);
      const paths = (data ?? []).map((f) => `${uploadedPrefix}/${f.name}`);
      if (paths.length) await supabaseStorage.from("scorm-packages").remove(paths);
    }
  });

  it("uploads a package and creates course/module/version rows", async () => {
    const form = new FormData();
    form.set(
      "package",
      new File([new Uint8Array(buildSamplePackage())], "package.zip", { type: "application/zip" })
    );
    form.set("courseCode", courseCode);
    form.set("courseTitle", "Route Test Course");
    form.set("moduleTitle", "Route Test Module");

    const request = new NextRequest("http://localhost/api/admin/scorm-upload", {
      method: "POST",
      body: form,
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.launchUrl).toBe("index.html");
    expect(body.moduleVersionId).toBeTruthy();
    uploadedPrefix = body.prefix;

    const [course] = await db.select().from(courses).where(eq(courses.code, courseCode));
    expect(course.title).toBe("Route Test Course");
  });

  it("rejects a request missing required fields", async () => {
    const form = new FormData();
    form.set("courseCode", "missing-package");

    const request = new NextRequest("http://localhost/api/admin/scorm-upload", {
      method: "POST",
      body: form,
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  it("stores the detected SCORM version on the module version", async () => {
    const zip = new AdmZip();
    zip.addFile(
      "imsmanifest.xml",
      Buffer.from(
        `<manifest identifier="route_test_2004"><metadata><schema>ADL SCORM</schema><schemaversion>2004 4th Edition</schemaversion></metadata><resources><resource href="index.html"><file href="index.html" /></resource></resources></manifest>`
      )
    );
    zip.addFile("index.html", Buffer.from("<html></html>"));

    const form = new FormData();
    form.set(
      "package",
      new File([new Uint8Array(zip.toBuffer())], "package.zip", { type: "application/zip" })
    );
    form.set("courseCode", `${courseCode}-2004`);
    form.set("courseTitle", "Route Test 2004 Course");
    form.set("moduleTitle", "Route Test 2004 Module");

    const request = new NextRequest("http://localhost/api/admin/scorm-upload", {
      method: "POST",
      body: form,
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    const body = await response.json();

    const [version] = await db
      .select()
      .from(scormModuleVersions)
      .where(eq(scormModuleVersions.moduleVersionId, body.moduleVersionId));
    expect(version.scormVersion).toBe("2004");

    // Clean up this second course independently of the shared afterAll.
    await db.delete(scormModuleVersions).where(eq(scormModuleVersions.moduleVersionId, body.moduleVersionId));
    const [course2004] = await db.select().from(courses).where(eq(courses.code, `${courseCode}-2004`));
    const modules2004 = await db.select().from(modules).where(eq(modules.courseId, course2004.id));
    await db
      .update(modules)
      .set({ currentVersionId: null })
      .where(inArray(modules.id, modules2004.map((m) => m.id)));
    await db.delete(moduleVersions).where(eq(moduleVersions.id, body.moduleVersionId));
    await db.delete(modules).where(inArray(modules.id, modules2004.map((m) => m.id)));
    await db.delete(courses).where(eq(courses.id, course2004.id));
    const { data } = await supabaseStorage.from("scorm-packages").list(body.prefix);
    const paths = (data ?? []).map((f) => `${body.prefix}/${f.name}`);
    if (paths.length) await supabaseStorage.from("scorm-packages").remove(paths);
  });

  it("rejects a manifest that references a launch file not present in the zip", async () => {
    const zip = new AdmZip();
    zip.addFile(
      "imsmanifest.xml",
      Buffer.from(
        `<manifest identifier="route_test_badref"><resources><resource href="does_not_exist.html"><file href="does_not_exist.html" /></resource></resources></manifest>`
      )
    );
    zip.addFile("unrelated.html", Buffer.from("<html></html>"));

    const form = new FormData();
    form.set(
      "package",
      new File([new Uint8Array(zip.toBuffer())], "package.zip", { type: "application/zip" })
    );
    form.set("courseCode", `${courseCode}-badref`);
    form.set("courseTitle", "Route Test Bad Ref");
    form.set("moduleTitle", "Route Test Bad Ref Module");

    const request = new NextRequest("http://localhost/api/admin/scorm-upload", {
      method: "POST",
      body: form,
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/does_not_exist\.html/);

    const rows = await db.select().from(courses).where(eq(courses.code, `${courseCode}-badref`));
    expect(rows).toHaveLength(0);
  });

  it("attaches to an existing course when courseId is provided, without needing courseCode/courseTitle", async () => {
    const [existingCourse] = await db
      .insert(courses)
      .values({ code: `${courseCode}-attach`, title: "Attach Target Course" })
      .returning();

    const form = new FormData();
    form.set(
      "package",
      new File([new Uint8Array(buildSamplePackage())], "package.zip", { type: "application/zip" })
    );
    form.set("courseId", existingCourse.id);
    form.set("moduleTitle", "Attached Module");

    const request = new NextRequest("http://localhost/api/admin/scorm-upload", {
      method: "POST",
      body: form,
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    const body = await response.json();

    const attachedModule = await db.select().from(modules).where(eq(modules.courseId, existingCourse.id));
    expect(attachedModule).toHaveLength(1);
    expect(attachedModule[0].title).toBe("Attached Module");

    await db.delete(scormModuleVersions).where(eq(scormModuleVersions.moduleVersionId, body.moduleVersionId));
    await db.update(modules).set({ currentVersionId: null }).where(eq(modules.courseId, existingCourse.id));
    await db.delete(moduleVersions).where(eq(moduleVersions.id, body.moduleVersionId));
    await db.delete(modules).where(eq(modules.courseId, existingCourse.id));
    await db.delete(courses).where(eq(courses.id, existingCourse.id));
    const { data } = await supabaseStorage.from("scorm-packages").list(body.prefix);
    const paths = (data ?? []).map((f) => `${body.prefix}/${f.name}`);
    if (paths.length) await supabaseStorage.from("scorm-packages").remove(paths);
  });

  it("rejects attach mode with a valid-but-nonexistent courseId before uploading anything to Storage", async () => {
    const nonexistentCourseId = randomUUID();

    const form = new FormData();
    form.set(
      "package",
      new File([new Uint8Array(buildSamplePackage())], "package.zip", { type: "application/zip" })
    );
    form.set("courseId", nonexistentCourseId);
    form.set("moduleTitle", "Should Not Be Created");

    const request = new NextRequest("http://localhost/api/admin/scorm-upload", {
      method: "POST",
      body: form,
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/no course exists/i);
    // No package upload should have been attempted for a rejected request, so
    // the error response carries no Storage prefix to clean up.
    expect(body.prefix).toBeUndefined();
  });
});
