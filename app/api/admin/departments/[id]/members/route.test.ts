import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { PATCH, DELETE } from "./route";
import { db } from "@/lib/db/client";
import { departments, users } from "@/lib/db/schema";

async function makeDeptAndUser() {
  const [dept] = await db.insert(departments).values({ name: `Dept-${randomUUID()}` }).returning();
  const [user] = await db
    .insert(users)
    .values({ entraObjectId: randomUUID(), email: `${randomUUID()}@example.com`, displayName: "Test User" })
    .returning();
  return { dept, user };
}

describe("PATCH /api/admin/departments/[id]/members", () => {
  it("moves a user into the department", async () => {
    const { dept, user } = await makeDeptAndUser();
    try {
      const request = new NextRequest(`http://localhost/api/admin/departments/${dept.id}/members`, {
        method: "PATCH",
        body: JSON.stringify({ userId: user.id }),
      });
      const response = await PATCH(request, { params: Promise.resolve({ id: dept.id }) });
      expect(response.status).toBe(200);

      const [row] = await db.select().from(users).where(eq(users.id, user.id));
      expect(row.departmentId).toBe(dept.id);
    } finally {
      await db.delete(users).where(eq(users.id, user.id));
      await db.delete(departments).where(eq(departments.id, dept.id));
    }
  });

  it("returns 400 for a non-UUID department id", async () => {
    const request = new NextRequest("http://localhost/api/admin/departments/not-a-uuid/members", {
      method: "PATCH",
      body: JSON.stringify({ userId: randomUUID() }),
    });
    const response = await PATCH(request, { params: Promise.resolve({ id: "not-a-uuid" }) });
    expect(response.status).toBe(400);
  });
});

describe("DELETE /api/admin/departments/[id]/members", () => {
  it("clears the user's department when they belong to this department", async () => {
    const { dept, user } = await makeDeptAndUser();
    await db.update(users).set({ departmentId: dept.id }).where(eq(users.id, user.id));
    try {
      const request = new NextRequest(`http://localhost/api/admin/departments/${dept.id}/members`, {
        method: "DELETE",
        body: JSON.stringify({ userId: user.id }),
      });
      const response = await DELETE(request, { params: Promise.resolve({ id: dept.id }) });
      expect(response.status).toBe(200);

      const [row] = await db.select().from(users).where(eq(users.id, user.id));
      expect(row.departmentId).toBeNull();
    } finally {
      await db.delete(users).where(eq(users.id, user.id));
      await db.delete(departments).where(eq(departments.id, dept.id));
    }
  });

  it("does not clear a user who belongs to a different department", async () => {
    const { dept, user } = await makeDeptAndUser();
    const otherDept = await db.insert(departments).values({ name: `Dept-${randomUUID()}` }).returning().then(([d]) => d);
    await db.update(users).set({ departmentId: otherDept.id }).where(eq(users.id, user.id));
    try {
      const request = new NextRequest(`http://localhost/api/admin/departments/${dept.id}/members`, {
        method: "DELETE",
        body: JSON.stringify({ userId: user.id }),
      });
      const response = await DELETE(request, { params: Promise.resolve({ id: dept.id }) });
      expect(response.status).toBe(200);

      const [row] = await db.select().from(users).where(eq(users.id, user.id));
      expect(row.departmentId).toBe(otherDept.id);
    } finally {
      await db.delete(users).where(eq(users.id, user.id));
      await db.delete(departments).where(eq(departments.id, dept.id));
      await db.delete(departments).where(eq(departments.id, otherDept.id));
    }
  });
});
