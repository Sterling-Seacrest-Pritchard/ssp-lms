import { describe, it, expect, vi } from "vitest";
import AdmZip from "adm-zip";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { GET } from "./route";
import { uploadScormPackage } from "@/lib/scorm/extract-package";
import { db } from "@/lib/db/client";
import {
  courses,
  modules,
  moduleVersions,
  scormModuleVersions,
  departments,
  departmentAdmins,
  users,
} from "@/lib/db/schema";
import { gcsStorage } from "@/lib/storage/gcs";
import { auth } from "@/auth";

vi.mock("@/auth", () => ({
  auth: vi.fn().mockResolvedValue({ user: { email: "org-admin@example.com", roles: ["OrgAdmin"] } }),
}));

async function createTestScormModule(courseId: string): Promise<{ moduleId: string; moduleVersionId: string; prefix: string }> {
  const [courseModule] = await db
    .insert(modules)
    .values({ courseId, moduleType: "scorm", title: "Scorm Content Test" })
    .returning();
  const [version] = await db
    .insert(moduleVersions)
    .values({ moduleId: courseModule.id, versionNumber: 1, status: "published" })
    .returning();

  const zip = new AdmZip();
  zip.addFile("imsmanifest.xml", Buffer.from("<manifest/>"));
  zip.addFile("index.html", Buffer.from("<html><body>hi</body></html>"));
  const { prefix } = await uploadScormPackage(zip.toBuffer(), version.id);

  await db.insert(scormModuleVersions).values({
    moduleVersionId: version.id,
    gcsPrefix: prefix,
    manifestIdentifier: "x",
    scormVersion: "1.2",
    launchUrl: "index.html",
    rawManifestXml: "<manifest/>",
  });
  await db.update(modules).set({ currentVersionId: version.id }).where(eq(modules.id, courseModule.id));

  return { moduleId: courseModule.id, moduleVersionId: version.id, prefix };
}

async function cleanupTestScormModule(courseId: string, moduleId: string, moduleVersionId: string, prefix: string): Promise<void> {
  await db.delete(scormModuleVersions).where(eq(scormModuleVersions.moduleVersionId, moduleVersionId));
  await db.update(modules).set({ currentVersionId: null }).where(eq(modules.id, moduleId));
  await db.delete(moduleVersions).where(eq(moduleVersions.id, moduleVersionId));
  await db.delete(modules).where(eq(modules.id, moduleId));
  await db.delete(courses).where(eq(courses.id, courseId));
  const { data } = await gcsStorage.from("ssp-lms-scorm-packages").list(prefix);
  const paths = (data ?? []).map((f) => `${prefix}/${f.name}`);
  if (paths.length) await gcsStorage.from("ssp-lms-scorm-packages").remove(paths);
}

describe("GET /api/scorm/content/[moduleVersionId]/[...path]", () => {
  it("serves a package file for an Org Admin even on an unpublished (draft) course", async () => {
    const [course] = await db.insert(courses).values({ code: `SCORM-CONTENT-${randomUUID()}`, title: "x" }).returning();
    const { moduleId, moduleVersionId, prefix } = await createTestScormModule(course.id);
    try {
      const response = await GET(new Request("http://localhost/x"), {
        params: Promise.resolve({ moduleVersionId, path: ["index.html"] }),
      });
      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).toContain("hi");
    } finally {
      await cleanupTestScormModule(course.id, moduleId, moduleVersionId, prefix);
    }
  });

  it("404s a Department Admin from a different department, never serving the package bytes", async () => {
    const [course] = await db.insert(courses).values({ code: `SCORM-CONTENT-404-${randomUUID()}`, title: "x" }).returning();
    const { moduleId, moduleVersionId, prefix } = await createTestScormModule(course.id);
    const [otherDept] = await db.insert(departments).values({ name: `Dept-${randomUUID()}` }).returning();
    await db.update(courses).set({ departmentId: otherDept.id }).where(eq(courses.id, course.id));
    const email = `dept-admin-scorm-content-${randomUUID()}@example.com`;
    const [dept] = await db.insert(departments).values({ name: `Dept-${randomUUID()}` }).returning();
    const [user] = await db
      .insert(users)
      .values({ email, displayName: "Dept Admin", entraRole: "Department Admin" })
      .returning();
    await db.insert(departmentAdmins).values({ userId: user.id, departmentId: dept.id });
    vi.mocked(auth).mockResolvedValueOnce({ user: { email, roles: ["DepartmentAdmin"] } } as never);
    try {
      const response = await GET(new Request("http://localhost/x"), {
        params: Promise.resolve({ moduleVersionId, path: ["index.html"] }),
      });
      expect(response.status).toBe(404);
    } finally {
      await cleanupTestScormModule(course.id, moduleId, moduleVersionId, prefix);
      await db.delete(departmentAdmins).where(eq(departmentAdmins.userId, user.id));
      await db.delete(users).where(eq(users.id, user.id));
      await db.delete(departments).where(eq(departments.id, dept.id));
      await db.delete(departments).where(eq(departments.id, otherDept.id));
    }
  });
});
