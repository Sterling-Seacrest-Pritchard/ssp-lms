import { describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users, departments, departmentAdmins, notifications, notificationBroadcasts } from "@/lib/db/schema";
import { auth } from "@/auth";
import * as broadcastLib from "@/lib/notifications/broadcast";
import { POST } from "./route";

vi.mock("@/auth", () => ({ auth: vi.fn() }));

function jsonRequest(body: unknown) {
  return { json: async () => body } as never;
}

describe("POST /api/admin/notifications/broadcast", () => {
  it("lets an OrgAdmin broadcast to all users", async () => {
    // This test's job is verifying the permission check (an OrgAdmin's
    // scope-"all" request reaches createBroadcast at all), not re-verifying
    // createBroadcast's own fan-out behavior - that's already covered by
    // lib/notifications/broadcast.test.ts. Mocking it here means this test
    // no longer writes a real notification to every active user on every
    // run (previously ~425 real rows per test run).
    const [admin] = await db.insert(users).values({ email: `org-admin-${randomUUID()}@example.com`, displayName: "Org Admin" }).returning();
    vi.mocked(auth).mockResolvedValue({ user: { email: admin.email, roles: ["OrgAdmin"] } } as never);
    const fakeResult = { broadcastId: randomUUID(), recipientCount: 425 };
    const createBroadcastSpy = vi.spyOn(broadcastLib, "createBroadcast").mockResolvedValue(fakeResult);
    try {
      const response = await POST(jsonRequest({ title: "t", body: "b", targetScope: "all" }));
      const payload = await response.json();
      expect(response.status).toBe(200);
      expect(createBroadcastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ authorEmail: admin.email, title: "t", body: "b", targetScope: "all" })
      );
      expect(payload).toEqual(fakeResult);
    } finally {
      createBroadcastSpy.mockRestore();
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
    let payload: { broadcastId?: string } | undefined;
    try {
      const response = await POST(jsonRequest({ title: "t", body: "b", targetScope: "department", targetDepartmentId: dept.id }));
      payload = await response.json();
      expect(response.status).toBe(200);
    } finally {
      if (payload?.broadcastId) {
        await db.delete(notifications).where(eq(notifications.broadcastId, payload.broadcastId));
        await db.delete(notificationBroadcasts).where(eq(notificationBroadcasts.id, payload.broadcastId));
      }
      await db.delete(departmentAdmins).where(eq(departmentAdmins.userId, admin.id));
      await db.delete(users).where(eq(users.id, admin.id));
      await db.delete(departments).where(eq(departments.id, dept.id));
    }
  });
});
