import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { DELETE } from "./route";
import { db } from "@/lib/db/client";
import { departments } from "@/lib/db/schema";
import { auth } from "@/auth";

vi.mock("@/auth", () => ({
  auth: vi.fn().mockResolvedValue({ user: { email: "org-admin@example.com", roles: ["OrgAdmin"] } }),
}));

describe("DELETE /api/admin/departments/[id]", () => {
  it("returns 400 for a non-UUID id", async () => {
    const request = new NextRequest("http://localhost/api/admin/departments/not-a-uuid");
    const response = await DELETE(request, { params: Promise.resolve({ id: "not-a-uuid" }) });
    expect(response.status).toBe(400);
  });

  it("returns 403 for a Department Admin", async () => {
    vi.mocked(auth).mockResolvedValueOnce({ user: { email: "dept-admin@example.com", roles: ["DepartmentAdmin"] } } as never);
    const [dept] = await db.insert(departments).values({ name: `Dept-${randomUUID()}` }).returning();
    try {
      const request = new NextRequest(`http://localhost/api/admin/departments/${dept.id}`);
      const response = await DELETE(request, { params: Promise.resolve({ id: dept.id }) });
      expect(response.status).toBe(403);

      const [row] = await db.select().from(departments).where(eq(departments.id, dept.id));
      expect(row).toBeDefined();
    } finally {
      await db.delete(departments).where(eq(departments.id, dept.id));
    }
  });

  it("deletes the department for an Org Admin", async () => {
    const [dept] = await db.insert(departments).values({ name: `Dept-${randomUUID()}` }).returning();
    const request = new NextRequest(`http://localhost/api/admin/departments/${dept.id}`);
    const response = await DELETE(request, { params: Promise.resolve({ id: dept.id }) });
    expect(response.status).toBe(200);

    const [row] = await db.select().from(departments).where(eq(departments.id, dept.id));
    expect(row).toBeUndefined();
  });
});
