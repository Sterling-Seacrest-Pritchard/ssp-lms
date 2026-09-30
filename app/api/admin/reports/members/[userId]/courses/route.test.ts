import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { GET } from "./route";
import { db } from "@/lib/db/client";
import { departments, users, departmentAdmins } from "@/lib/db/schema";
import { assignDepartmentAdmin } from "@/lib/db/department-admins";
import { auth } from "@/auth";

vi.mock("@/auth", () => ({
  auth: vi.fn().mockResolvedValue({ user: { email: "org-admin@example.com", roles: ["OrgAdmin"] } }),
}));

describe("GET /api/admin/reports/members/[userId]/courses", () => {
  it("returns 400 for a non-UUID userId", async () => {
    const request = new NextRequest("http://localhost/api/admin/reports/members/not-a-uuid/courses");
    const response = await GET(request, { params: Promise.resolve({ userId: "not-a-uuid" }) });
    expect(response.status).toBe(400);
  });

  it("returns 404 for a userId that doesn't exist", async () => {
    const missingId = randomUUID();
    const request = new NextRequest(`http://localhost/api/admin/reports/members/${missingId}/courses`);
    const response = await GET(request, { params: Promise.resolve({ userId: missingId }) });
    expect(response.status).toBe(404);
  });

  it("allows an Org Admin to view any user's courses", async () => {
    const [user] = await db.insert(users).values({ email: `${randomUUID()}@example.com`, displayName: "x" }).returning();
    try {
      const request = new NextRequest(`http://localhost/api/admin/reports/members/${user.id}/courses`);
      const response = await GET(request, { params: Promise.resolve({ userId: user.id }) });
      expect(response.status).toBe(200);
      expect((await response.json()).rows).toEqual([]);
    } finally {
      await db.delete(users).where(eq(users.id, user.id));
    }
  });

  it("returns 403 (generic) when a Department Admin requests a user outside their department", async () => {
    const [dept] = await db.insert(departments).values({ name: `Dept-${randomUUID()}` }).returning();
    const [otherDept] = await db.insert(departments).values({ name: `Dept-${randomUUID()}` }).returning();
    const [target] = await db.insert(users).values({ email: `${randomUUID()}@example.com`, displayName: "x", departmentId: otherDept.id }).returning();
    const [admin] = await db.insert(users).values({ email: `${randomUUID()}@example.com`, displayName: "Admin" }).returning();
    await assignDepartmentAdmin(admin.id, dept.id, null);
    vi.mocked(auth).mockResolvedValueOnce({ user: { email: admin.email, roles: ["DepartmentAdmin"] } } as never);
    try {
      const request = new NextRequest(`http://localhost/api/admin/reports/members/${target.id}/courses`);
      const response = await GET(request, { params: Promise.resolve({ userId: target.id }) });
      expect(response.status).toBe(403);
      expect((await response.json()).error).not.toMatch(/exist|found/i);
    } finally {
      await db.delete(departmentAdmins).where(eq(departmentAdmins.userId, admin.id));
      await db.delete(users).where(eq(users.id, target.id));
      await db.delete(users).where(eq(users.id, admin.id));
      await db.delete(departments).where(eq(departments.id, dept.id));
      await db.delete(departments).where(eq(departments.id, otherDept.id));
    }
  });

  it("allows a Department Admin to view a user inside their own department", async () => {
    const [dept] = await db.insert(departments).values({ name: `Dept-${randomUUID()}` }).returning();
    const [target] = await db.insert(users).values({ email: `${randomUUID()}@example.com`, displayName: "x", departmentId: dept.id }).returning();
    const [admin] = await db.insert(users).values({ email: `${randomUUID()}@example.com`, displayName: "Admin" }).returning();
    await assignDepartmentAdmin(admin.id, dept.id, null);
    vi.mocked(auth).mockResolvedValueOnce({ user: { email: admin.email, roles: ["DepartmentAdmin"] } } as never);
    try {
      const request = new NextRequest(`http://localhost/api/admin/reports/members/${target.id}/courses`);
      const response = await GET(request, { params: Promise.resolve({ userId: target.id }) });
      expect(response.status).toBe(200);
    } finally {
      await db.delete(departmentAdmins).where(eq(departmentAdmins.userId, admin.id));
      await db.delete(users).where(eq(users.id, target.id));
      await db.delete(users).where(eq(users.id, admin.id));
      await db.delete(departments).where(eq(departments.id, dept.id));
    }
  });
});
