import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { GET, PATCH } from "./route";
import { createTextModule } from "@/lib/db/text-authoring";
import { db } from "@/lib/db/client";
import { courses, modules, moduleVersions, textModuleVersions } from "@/lib/db/schema";

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
});
