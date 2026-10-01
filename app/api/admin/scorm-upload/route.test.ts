import { describe, it, expect, afterAll, vi } from "vitest";
import AdmZip from "adm-zip";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { POST } from "./route";
import { db } from "@/lib/db/client";
import { courses, modules, moduleVersions, scormModuleVersions, departments, departmentAdmins, users } from "@/lib/db/schema";
import { gcsStorage } from "@/lib/storage/gcs";
import { auth } from "@/auth";

vi.mock("@/auth", () => ({
  auth: vi.fn().mockResolvedValue({ user: { email: "org-admin@example.com", roles: ["OrgAdmin"] } }),
}));

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

async function cleanupCourseByTitle(title: string, prefixes: string[] = []) {
  const rows = await db.select().from(courses).where(eq(courses.title, title));
  const courseIds = rows.map((r) => r.id);
  if (courseIds.length) {
    const mods = await db.select().from(modules).where(inArray(modules.courseId, courseIds));
    const moduleIds = mods.map((m) => m.id);
    if (moduleIds.length) {
      const versions = await db.select().from(moduleVersions).where(inArray(moduleVersions.moduleId, moduleIds));
      const versionIds = versions.map((v) => v.id);
      if (versionIds.length) {
        await db.delete(scormModuleVersions).where(inArray(scormModuleVersions.moduleVersionId, versionIds));
        await db.update(modules).set({ currentVersionId: null }).where(inArray(modules.id, moduleIds));
        await db.delete(moduleVersions).where(inArray(moduleVersions.id, versionIds));
      }
      await db.delete(modules).where(inArray(modules.id, moduleIds));
    }
    await db.delete(courses).where(inArray(courses.id, courseIds));
  }
  for (const prefix of prefixes) {
    const { data } = await gcsStorage.from("ssp-lms-scorm-packages").list(prefix);
    const paths = (data ?? []).map((f) => `${prefix}/${f.name}`);
    if (paths.length) await gcsStorage.from("ssp-lms-scorm-packages").remove(paths);
  }
}

describe("POST /api/admin/scorm-upload", () => {
  const routeTestCourseTitle = `Route Test Course ${randomUUID()}`;
  let uploadedPrefix: string | undefined;

  afterAll(async () => {
    await cleanupCourseByTitle(routeTestCourseTitle, uploadedPrefix ? [uploadedPrefix] : []);
  });

  it("uploads a package and creates course/module/version rows, with a code derived from the title", async () => {
    const form = new FormData();
    form.set(
      "package",
      new File([new Uint8Array(buildSamplePackage())], "package.zip", { type: "application/zip" })
    );
    form.set("courseTitle", routeTestCourseTitle);
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

    const [course] = await db.select().from(courses).where(eq(courses.title, routeTestCourseTitle));
    expect(course.title).toBe(routeTestCourseTitle);
    expect(course.code).toMatch(/^ROUTE-TEST-COURSE-[A-F0-9-]+$/);
  });

  it("rejects a request missing required fields", async () => {
    const form = new FormData();

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

    const title = `Route Test 2004 Course ${randomUUID()}`;
    const form = new FormData();
    form.set(
      "package",
      new File([new Uint8Array(zip.toBuffer())], "package.zip", { type: "application/zip" })
    );
    form.set("courseTitle", title);
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

    await cleanupCourseByTitle(title, [body.prefix]);
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

    const title = `Route Test Bad Ref ${randomUUID()}`;
    const form = new FormData();
    form.set(
      "package",
      new File([new Uint8Array(zip.toBuffer())], "package.zip", { type: "application/zip" })
    );
    form.set("courseTitle", title);
    form.set("moduleTitle", "Route Test Bad Ref Module");

    const request = new NextRequest("http://localhost/api/admin/scorm-upload", {
      method: "POST",
      body: form,
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/does_not_exist\.html/);

    const rows = await db.select().from(courses).where(eq(courses.title, title));
    expect(rows).toHaveLength(0);
  });

  it("attaches to an existing course when courseId is provided, without needing a course title", async () => {
    const [existingCourse] = await db
      .insert(courses)
      .values({ code: `ROUTE-TEST-ATTACH-${randomUUID()}`, title: "Attach Target Course" })
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
    const { data } = await gcsStorage.from("ssp-lms-scorm-packages").list(body.prefix);
    const paths = (data ?? []).map((f) => `${body.prefix}/${f.name}`);
    if (paths.length) await gcsStorage.from("ssp-lms-scorm-packages").remove(paths);
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

  it("404s attach mode for a Department Admin from a different department, leaving the course untouched", async () => {
    const [existingCourse] = await db
      .insert(courses)
      .values({ code: `ROUTE-TEST-ATTACH-403-${randomUUID()}`, title: "Attach Target Course" })
      .returning();
    const [otherDept] = await db.insert(departments).values({ name: `Dept-${randomUUID()}` }).returning();
    await db.update(courses).set({ departmentId: otherDept.id }).where(eq(courses.id, existingCourse.id));
    const email = `dept-admin-scorm-attach-${randomUUID()}@example.com`;
    const [dept] = await db.insert(departments).values({ name: `Dept-${randomUUID()}` }).returning();
    const [user] = await db
      .insert(users)
      .values({ email, displayName: "Dept Admin", entraRole: "Department Admin" })
      .returning();
    await db.insert(departmentAdmins).values({ userId: user.id, departmentId: dept.id });
    vi.mocked(auth).mockResolvedValueOnce({ user: { email, roles: ["DepartmentAdmin"] } } as never);
    try {
      const form = new FormData();
      form.set(
        "package",
        new File([new Uint8Array(buildSamplePackage())], "package.zip", { type: "application/zip" })
      );
      form.set("courseId", existingCourse.id);
      form.set("moduleTitle", "Should Not Attach");

      const request = new NextRequest("http://localhost/api/admin/scorm-upload", { method: "POST", body: form });
      const response = await POST(request);
      expect(response.status).toBe(404);

      const attachedModules = await db.select().from(modules).where(eq(modules.courseId, existingCourse.id));
      expect(attachedModules).toHaveLength(0);
    } finally {
      await db.delete(courses).where(eq(courses.id, existingCourse.id));
      await db.delete(departmentAdmins).where(eq(departmentAdmins.userId, user.id));
      await db.delete(users).where(eq(users.id, user.id));
      await db.delete(departments).where(eq(departments.id, dept.id));
      await db.delete(departments).where(eq(departments.id, otherDept.id));
    }
  });

  it("rejects create-mode for a Department Admin who administers no department yet, uploading nothing", async () => {
    const title = `Should Not Be Created ${randomUUID()}`;
    const email = `dept-admin-scorm-nodept-${randomUUID()}@example.com`;
    const [user] = await db
      .insert(users)
      .values({ email, displayName: "Dept Admin", entraRole: "Department Admin" })
      .returning();
    vi.mocked(auth).mockResolvedValueOnce({ user: { email, roles: ["DepartmentAdmin"] } } as never);
    try {
      const form = new FormData();
      form.set(
        "package",
        new File([new Uint8Array(buildSamplePackage())], "package.zip", { type: "application/zip" })
      );
      form.set("courseTitle", title);
      form.set("moduleTitle", "Should Not Be Created");

      const request = new NextRequest("http://localhost/api/admin/scorm-upload", { method: "POST", body: form });
      const response = await POST(request);
      expect(response.status).toBe(400);

      const rows = await db.select().from(courses).where(eq(courses.title, title));
      expect(rows).toHaveLength(0);
    } finally {
      await db.delete(users).where(eq(users.id, user.id));
    }
  });

  it("auto-scopes a brand-new create-mode course to a Department Admin's single administered department", async () => {
    const title = `Scoped Course ${randomUUID()}`;
    const email = `dept-admin-scorm-scoped-${randomUUID()}@example.com`;
    const [dept] = await db.insert(departments).values({ name: `Dept-${randomUUID()}` }).returning();
    const [user] = await db
      .insert(users)
      .values({ email, displayName: "Dept Admin", entraRole: "Department Admin" })
      .returning();
    await db.insert(departmentAdmins).values({ userId: user.id, departmentId: dept.id });
    vi.mocked(auth).mockResolvedValueOnce({ user: { email, roles: ["DepartmentAdmin"] } } as never);
    try {
      const form = new FormData();
      form.set(
        "package",
        new File([new Uint8Array(buildSamplePackage())], "package.zip", { type: "application/zip" })
      );
      form.set("courseTitle", title);
      form.set("moduleTitle", "Scoped Module");

      const request = new NextRequest("http://localhost/api/admin/scorm-upload", { method: "POST", body: form });
      const response = await POST(request);
      expect(response.status).toBe(200);
      const body = await response.json();

      const [course] = await db.select().from(courses).where(eq(courses.title, title));
      expect(course.departmentId).toBe(dept.id);

      await cleanupCourseByTitle(title, [body.prefix]);
    } finally {
      await db.delete(departmentAdmins).where(eq(departmentAdmins.userId, user.id));
      await db.delete(users).where(eq(users.id, user.id));
      await db.delete(departments).where(eq(departments.id, dept.id));
    }
  });

  it("never attaches to another course by title - two create-mode uploads with the same title make two independent courses", async () => {
    // Closes the oracle/squat vector a client-supplied courseCode used to
    // open: there is no title- or code-based lookup left in create-mode at
    // all, so two admins (or one admin twice) using the same title always
    // get two separate courses with independently-generated codes, never a
    // silent attach to someone else's existing course.
    const sharedTitle = `Shared Title ${randomUUID()}`;
    const uploadOnce = async (moduleTitleValue: string) => {
      const form = new FormData();
      form.set(
        "package",
        new File([new Uint8Array(buildSamplePackage())], "package.zip", { type: "application/zip" })
      );
      form.set("courseTitle", sharedTitle);
      form.set("moduleTitle", moduleTitleValue);
      const request = new NextRequest("http://localhost/api/admin/scorm-upload", { method: "POST", body: form });
      const response = await POST(request);
      expect(response.status).toBe(200);
      return response.json();
    };

    const first = await uploadOnce("First Module");
    const second = await uploadOnce("Second Module");
    try {
      const rows = await db.select().from(courses).where(eq(courses.title, sharedTitle));
      expect(rows).toHaveLength(2);
      expect(rows[0].id).not.toBe(rows[1].id);
      expect(rows[0].code).not.toBe(rows[1].code);
    } finally {
      await cleanupCourseByTitle(sharedTitle, [first.prefix, second.prefix]);
    }
  });
});
