import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users, departments, notifications, notificationBroadcasts } from "@/lib/db/schema";
import { createBroadcast } from "./broadcast";

describe("createBroadcast", () => {
  it("fans out one notification per active user for scope 'all', skipping inactive users", async () => {
    const active = await db.insert(users).values({ email: `bc-active-${randomUUID()}@example.com`, displayName: "Active" }).returning();
    const inactive = await db.insert(users).values({ email: `bc-inactive-${randomUUID()}@example.com`, displayName: "Inactive", isActive: false }).returning();
    let result;
    try {
      result = await createBroadcast({ authorEmail: "org-admin@example.com", title: "Heads up", body: "System maintenance tonight", targetScope: "all" });
      const rows = await db.select().from(notifications).where(eq(notifications.broadcastId, result.broadcastId));
      const recipientIds = rows.map((r) => r.userId);
      expect(recipientIds).toContain(active[0].id);
      expect(recipientIds).not.toContain(inactive[0].id);
    } finally {
      if (result) {
        await db.delete(notifications).where(eq(notifications.broadcastId, result.broadcastId));
        await db.delete(notificationBroadcasts).where(eq(notificationBroadcasts.id, result.broadcastId));
      }
      await db.delete(users).where(eq(users.id, active[0].id));
      await db.delete(users).where(eq(users.id, inactive[0].id));
    }
  });

  it("scopes to a department's active members for scope 'department'", async () => {
    const [dept] = await db.insert(departments).values({ name: `BC Dept ${randomUUID()}` }).returning();
    const [member] = await db.insert(users).values({ email: `bc-member-${randomUUID()}@example.com`, displayName: "Member", departmentId: dept.id }).returning();
    const [outsider] = await db.insert(users).values({ email: `bc-outsider-${randomUUID()}@example.com`, displayName: "Outsider" }).returning();
    let result;
    try {
      result = await createBroadcast({ authorEmail: "dept-admin@example.com", title: "Dept update", body: "New policy", targetScope: "department", targetDepartmentId: dept.id });
      expect(result.recipientCount).toBe(1);
      const rows = await db.select().from(notifications).where(eq(notifications.broadcastId, result.broadcastId));
      expect(rows.map((r) => r.userId)).toEqual([member.id]);
    } finally {
      if (result) {
        await db.delete(notifications).where(eq(notifications.broadcastId, result.broadcastId));
        await db.delete(notificationBroadcasts).where(eq(notificationBroadcasts.id, result.broadcastId));
      }
      await db.delete(users).where(eq(users.id, member.id));
      await db.delete(users).where(eq(users.id, outsider.id));
      await db.delete(departments).where(eq(departments.id, dept.id));
    }
  });

  it("succeeds with zero recipients for a department with no active members", async () => {
    const [dept] = await db.insert(departments).values({ name: `Empty Dept ${randomUUID()}` }).returning();
    try {
      const result = await createBroadcast({ authorEmail: "dept-admin@example.com", title: "t", body: "b", targetScope: "department", targetDepartmentId: dept.id });
      expect(result.recipientCount).toBe(0);
      await db.delete(notificationBroadcasts).where(eq(notificationBroadcasts.id, result.broadcastId));
    } finally {
      await db.delete(departments).where(eq(departments.id, dept.id));
    }
  });
});
