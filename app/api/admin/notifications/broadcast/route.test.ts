import { describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users, departments, departmentAdmins, notifications, notificationBroadcasts } from "@/lib/db/schema";
import { auth } from "@/auth";
import { POST } from "./route";

vi.mock("@/auth", () => ({ auth: vi.fn() }));

function jsonRequest(body: unknown) {
  return { json: async () => body } as never;
}

describe("POST /api/admin/notifications/broadcast", () => {
  it("lets an OrgAdmin broadcast to all users", async () => {
    const [admin] = await db.insert(users).values({ email: `org-admin-${randomUUID()}@example.com`, displayName: "Org Admin" }).returning();
    vi.mocked(auth).mockResolvedValue({ user: { email: admin.email, roles: ["OrgAdmin"] } } as never);
    try {
      const response = await POST(jsonRequest({ title: "t", body: "b", targetScope: "all" }));
      expect(response.status).toBe(200);
      const payload = await response.json();
      await db.delete(notifications).where(eq(notifications.broadcastId, payload.broadcastId));
      await db.delete(notificationBroadcasts).where(eq(notificationBroadcasts.id, payload.broadcastId));
    } finally {
      await db.delete(users).where(eq(users.id, admin.id));
    }
  });

  it("rejects a DepartmentAdmin broadcasting with scope 'all'", async () => {
    const [admin] = await db.insert(users).values({ email: `dept-admin-${randomUUID()}@example.com`, displayName: "Dept Admin" }).returning();
    vi.mocked(auth).mockResolvedValue({ user: { email: admin.email, roles: ["DepartmentAdmin"] } } as never);
    try {
      const response = await POST(jsonRequest({ title: "t", body: "b", targetScope: "all" }));
      expect(response.status).toBe(403);
    } finally {
      await db.delete(users).where(eq(users.id, admin.id));
    }
  });

  it("rejects a DepartmentAdmin targeting a department they do not administer", async () => {
    const [admin] = await db.insert(users).values({ email: `dept-admin2-${randomUUID()}@example.com`, displayName: "Dept Admin" }).returning();
    const [dept] = await db.insert(departments).values({ name: `Foreign Dept ${randomUUID()}` }).returning();
    vi.mocked(auth).mockResolvedValue({ user: { email: admin.email, roles: ["DepartmentAdmin"] } } as never);
    try {
      const response = await POST(jsonRequest({ title: "t", body: "b", targetScope: "department", targetDepartmentId: dept.id }));
      expect(response.status).toBe(403);
    } finally {
      await db.delete(users).where(eq(users.id, admin.id));
      await db.delete(departments).where(eq(departments.id, dept.id));
    }
  });

  it("lets a DepartmentAdmin broadcast to a department they administer", async () => {
    const [admin] = await db.insert(users).values({ email: `dept-admin3-${randomUUID()}@example.com`, displayName: "Dept Admin" }).returning();
    const [dept] = await db.insert(departments).values({ name: `Own Dept ${randomUUID()}` }).returning();
    await db.insert(departmentAdmins).values({ userId: admin.id, departmentId: dept.id });
    vi.mocked(auth).mockResolvedValue({ user: { email: admin.email, roles: ["DepartmentAdmin"] } } as never);
    try {
      const response = await POST(jsonRequest({ title: "t", body: "b", targetScope: "department", targetDepartmentId: dept.id }));
      expect(response.status).toBe(200);
      const payload = await response.json();
      await db.delete(notificationBroadcasts).where(eq(notificationBroadcasts.id, payload.broadcastId));
    } finally {
      await db.delete(departmentAdmins).where(eq(departmentAdmins.userId, admin.id));
      await db.delete(users).where(eq(users.id, admin.id));
      await db.delete(departments).where(eq(departments.id, dept.id));
    }
  });
});
