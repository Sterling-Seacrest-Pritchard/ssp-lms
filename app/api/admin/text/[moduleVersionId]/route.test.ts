import { describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { GET, PATCH } from "./route";
import { createTextModule } from "@/lib/db/text-authoring";
import { db } from "@/lib/db/client";
import { courses, modules, moduleVersions, textModuleVersions, departments, departmentAdmins, users } from "@/lib/db/schema";
import { auth } from "@/auth";

vi.mock("@/auth", () => ({
  auth: vi.fn().mockResolvedValue({ user: { email: "org-admin@example.com", roles: ["OrgAdmin"] } }),
}));

describe("GET/PATCH /api/admin/text/[moduleVersionId]", () => {
  it("fetches the current body and then updates it", async () => {
    const [course] = await db.insert(courses).values({ code: `ADMIN-TEXT-EDIT-${randomUUID()}`, title: "x" }).returning();
    const { moduleId, moduleVersionId } = await createTextModule(course.id, "Text Module", "Original body.");
    try {
      const getResponse = await GET(new NextRequest("http://localhost/x"), {
        params: Promise.resolve({ moduleVersionId }),
      });
      expect(getResponse.status).toBe(200);
      const getBody = await getResponse.json();
      expect(getBody.body).toBe("Original body.");

      const patchResponse = await PATCH(
        new NextRequest("http://localhost/x", { method: "PATCH", body: JSON.stringify({ body: "Updated body." }) }),
        { params: Promise.resolve({ moduleVersionId }) }
      );
      expect(patchResponse.status).toBe(200);

      const [textVersion] = await db
        .select()
        .from(textModuleVersions)
        .where(eq(textModuleVersions.moduleVersionId, moduleVersionId));
      expect(textVersion.body).toBe("Updated body.");
    } finally {
      await db.delete(textModuleVersions).where(eq(textModuleVersions.moduleVersionId, moduleVersionId));
      await db.update(modules).set({ currentVersionId: null }).where(eq(modules.id, moduleId));
      await db.delete(moduleVersions).where(eq(moduleVersions.id, moduleVersionId));
      await db.delete(modules).where(eq(modules.id, moduleId));
      await db.delete(courses).where(eq(courses.id, course.id));
    }
  });

  it("returns 404 for a moduleVersionId with no text module", async () => {
    const response = await GET(new NextRequest("http://localhost/x"), {
      params: Promise.resolve({ moduleVersionId: "00000000-0000-0000-0000-000000000000" }),
    });
    expect(response.status).toBe(404);
  });

  it("404s a Department Admin from a different department on both GET and PATCH, leaving the body untouched", async () => {
    const [course] = await db.insert(courses).values({ code: `ADMIN-TEXT-EDIT-404-${randomUUID()}`, title: "x" }).returning();
    const { moduleId, moduleVersionId } = await createTextModule(course.id, "Text Module", "Original body.");
    const [otherDept] = await db.insert(departments).values({ name: `Dept-${randomUUID()}` }).returning();
    await db.update(courses).set({ departmentId: otherDept.id }).where(eq(courses.id, course.id));
    const email = `dept-admin-text-edit-${randomUUID()}@example.com`;
    const [dept] = await db.insert(departments).values({ name: `Dept-${randomUUID()}` }).returning();
    const [user] = await db
      .insert(users)
      .values({ email, displayName: "Dept Admin", entraRole: "Department Admin" })
      .returning();
    await db.insert(departmentAdmins).values({ userId: user.id, departmentId: dept.id });
    try {
      vi.mocked(auth).mockResolvedValueOnce({ user: { email, roles: ["DepartmentAdmin"] } } as never);
      const getResponse = await GET(new NextRequest("http://localhost/x"), {
        params: Promise.resolve({ moduleVersionId }),
      });
      expect(getResponse.status).toBe(404);

      vi.mocked(auth).mockResolvedValueOnce({ user: { email, roles: ["DepartmentAdmin"] } } as never);
      const patchResponse = await PATCH(
        new NextRequest("http://localhost/x", { method: "PATCH", body: JSON.stringify({ body: "hijacked" }) }),
        { params: Promise.resolve({ moduleVersionId }) }
      );
      expect(patchResponse.status).toBe(404);

      const [textVersion] = await db
        .select()
        .from(textModuleVersions)
        .where(eq(textModuleVersions.moduleVersionId, moduleVersionId));
      expect(textVersion.body).toBe("Original body.");
    } finally {
      await db.delete(textModuleVersions).where(eq(textModuleVersions.moduleVersionId, moduleVersionId));
      await db.update(modules).set({ currentVersionId: null }).where(eq(modules.id, moduleId));
      await db.delete(moduleVersions).where(eq(moduleVersions.id, moduleVersionId));
      await db.delete(modules).where(eq(modules.id, moduleId));
      await db.delete(courses).where(eq(courses.id, course.id));
      await db.delete(departmentAdmins).where(eq(departmentAdmins.userId, user.id));
      await db.delete(users).where(eq(users.id, user.id));
      await db.delete(departments).where(eq(departments.id, dept.id));
      await db.delete(departments).where(eq(departments.id, otherDept.id));
    }
  });
});
