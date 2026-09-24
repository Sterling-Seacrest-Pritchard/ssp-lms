import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { POST } from "./route";
import { DELETE } from "./[userId]/[departmentId]/route";
import { db } from "@/lib/db/client";
import { departments, users, departmentAdmins } from "@/lib/db/schema";
import { auth } from "@/auth";

vi.mock("@/auth", () => ({
  auth: vi.fn().mockResolvedValue({ user: { email: "org-admin@example.com", roles: ["OrgAdmin"] } }),
}));

describe("POST /api/admin/department-admins", () => {
  it("assigns a user as an admin of a department", async () => {
    const [dept] = await db.insert(departments).values({ name: `Dept-${randomUUID()}` }).returning();
    const [user] = await db
      .insert(users)
      .values({ email: `${randomUUID()}@example.com`, displayName: "Test", entraRole: "Department Admin" })
      .returning();
    try {
      const request = new NextRequest("http://localhost/api/admin/department-admins", {
        method: "POST",
        body: JSON.stringify({ userId: user.id, departmentId: dept.id }),
      });
      const response = await POST(request);
      expect(response.status).toBe(200);

      const [row] = await db.select().from(departmentAdmins).where(eq(departmentAdmins.userId, user.id));
      expect(row.departmentId).toBe(dept.id);
    } finally {
      await db.delete(departmentAdmins).where(eq(departmentAdmins.userId, user.id));
      await db.delete(users).where(eq(users.id, user.id));
      await db.delete(departments).where(eq(departments.id, dept.id));
    }
  });

  it("returns 409 for a duplicate assignment", async () => {
    const [dept] = await db.insert(departments).values({ name: `Dept-${randomUUID()}` }).returning();
    const [user] = await db
      .insert(users)
      .values({ email: `${randomUUID()}@example.com`, displayName: "Test", entraRole: "Department Admin" })
      .returning();
    try {
      const first = new NextRequest("http://localhost/api/admin/department-admins", {
        method: "POST",
        body: JSON.stringify({ userId: user.id, departmentId: dept.id }),
      });
      await POST(first);
      const second = new NextRequest("http://localhost/api/admin/department-admins", {
        method: "POST",
        body: JSON.stringify({ userId: user.id, departmentId: dept.id }),
      });
      const response = await POST(second);
      expect(response.status).toBe(409);
    } finally {
      await db.delete(departmentAdmins).where(eq(departmentAdmins.userId, user.id));
      await db.delete(users).where(eq(users.id, user.id));
      await db.delete(departments).where(eq(departments.id, dept.id));
    }
  });

  it("returns 403 when the caller is not an Org Admin", async () => {
    vi.mocked(auth).mockResolvedValueOnce({
      user: { email: "dept-admin@example.com", roles: ["DepartmentAdmin"] },
    } as never);
    const [dept] = await db.insert(departments).values({ name: `Dept-${randomUUID()}` }).returning();
    const [user] = await db
      .insert(users)
      .values({ email: `${randomUUID()}@example.com`, displayName: "Test", entraRole: "Department Admin" })
      .returning();
    try {
      const request = new NextRequest("http://localhost/api/admin/department-admins", {
        method: "POST",
        body: JSON.stringify({ userId: user.id, departmentId: dept.id }),
      });
      const response = await POST(request);
      expect(response.status).toBe(403);

      expect(await db.select().from(departmentAdmins).where(eq(departmentAdmins.userId, user.id))).toHaveLength(0);
    } finally {
      await db.delete(departmentAdmins).where(eq(departmentAdmins.userId, user.id));
      await db.delete(users).where(eq(users.id, user.id));
      await db.delete(departments).where(eq(departments.id, dept.id));
    }
  });

  it("returns 400 when the target user does not currently hold the Department Admin role", async () => {
    const [dept] = await db.insert(departments).values({ name: `Dept-${randomUUID()}` }).returning();
    const [user] = await db
      .insert(users)
      .values({ email: `${randomUUID()}@example.com`, displayName: "Test", entraRole: "Learner" })
      .returning();
    try {
      const request = new NextRequest("http://localhost/api/admin/department-admins", {
        method: "POST",
        body: JSON.stringify({ userId: user.id, departmentId: dept.id }),
      });
      const response = await POST(request);
      expect(response.status).toBe(400);

      expect(await db.select().from(departmentAdmins).where(eq(departmentAdmins.userId, user.id))).toHaveLength(0);
    } finally {
      await db.delete(departmentAdmins).where(eq(departmentAdmins.userId, user.id));
      await db.delete(users).where(eq(users.id, user.id));
      await db.delete(departments).where(eq(departments.id, dept.id));
    }
  });
});

describe("DELETE /api/admin/department-admins/[userId]/[departmentId]", () => {
  it("removes the assignment", async () => {
    const [dept] = await db.insert(departments).values({ name: `Dept-${randomUUID()}` }).returning();
    const [user] = await db
      .insert(users)
      .values({ email: `${randomUUID()}@example.com`, displayName: "Test", entraRole: "Department Admin" })
      .returning();
    await db.insert(departmentAdmins).values({ userId: user.id, departmentId: dept.id });
    try {
      const request = new NextRequest(
        `http://localhost/api/admin/department-admins/${user.id}/${dept.id}`,
        { method: "DELETE" }
      );
      const response = await DELETE(request, { params: Promise.resolve({ userId: user.id, departmentId: dept.id }) });
      expect(response.status).toBe(200);
      expect(await db.select().from(departmentAdmins).where(eq(departmentAdmins.userId, user.id))).toHaveLength(0);
    } finally {
      await db.delete(users).where(eq(users.id, user.id));
      await db.delete(departments).where(eq(departments.id, dept.id));
    }
  });

  it("returns 403 when the caller is not an Org Admin", async () => {
    vi.mocked(auth).mockResolvedValueOnce({
      user: { email: "dept-admin@example.com", roles: ["DepartmentAdmin"] },
    } as never);
    const [dept] = await db.insert(departments).values({ name: `Dept-${randomUUID()}` }).returning();
    const [user] = await db
      .insert(users)
      .values({ email: `${randomUUID()}@example.com`, displayName: "Test", entraRole: "Department Admin" })
      .returning();
    await db.insert(departmentAdmins).values({ userId: user.id, departmentId: dept.id });
    try {
      const request = new NextRequest(
        `http://localhost/api/admin/department-admins/${user.id}/${dept.id}`,
        { method: "DELETE" }
      );
      const response = await DELETE(request, { params: Promise.resolve({ userId: user.id, departmentId: dept.id }) });
      expect(response.status).toBe(403);
      expect(await db.select().from(departmentAdmins).where(eq(departmentAdmins.userId, user.id))).toHaveLength(1);
    } finally {
      await db.delete(departmentAdmins).where(eq(departmentAdmins.userId, user.id));
      await db.delete(users).where(eq(users.id, user.id));
      await db.delete(departments).where(eq(departments.id, dept.id));
    }
  });
});
