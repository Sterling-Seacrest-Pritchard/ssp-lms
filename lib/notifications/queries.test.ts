import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users, notifications } from "@/lib/db/schema";
import { listNotificationsForUser, countUnreadNotifications, markNotificationRead, markAllNotificationsRead } from "./queries";

async function seedUser() {
  const [user] = await db
    .insert(users)
    .values({ email: `notif-query-${randomUUID()}@example.com`, displayName: "Query Test User" })
    .returning();
  return user;
}

describe("notification queries", () => {
  it("lists a user's notifications newest-first and counts unread", async () => {
    const user = await seedUser();
    try {
      const [older] = await db.insert(notifications).values({ userId: user.id, type: "due_soon", title: "Older", body: "b" }).returning();
      await db.update(notifications).set({ createdAt: new Date(Date.now() - 60000) }).where(eq(notifications.id, older.id));
      await db.insert(notifications).values({ userId: user.id, type: "overdue", title: "Newer", body: "b" });

      const rows = await listNotificationsForUser(user.id);
      expect(rows).toHaveLength(2);
      expect(rows[0].title).toBe("Newer");
      expect(await countUnreadNotifications(user.id)).toBe(2);
    } finally {
      await db.delete(notifications).where(eq(notifications.userId, user.id));
      await db.delete(users).where(eq(users.id, user.id));
    }
  });

  it("marks a single notification read only for its own user, no-ops for a foreign id", async () => {
    const owner = await seedUser();
    const stranger = await seedUser();
    try {
      const [note] = await db.insert(notifications).values({ userId: owner.id, type: "due_soon", title: "t", body: "b" }).returning();

      await markNotificationRead(note.id, stranger.id);
      let [row] = await db.select().from(notifications).where(eq(notifications.id, note.id));
      expect(row.readAt).toBeNull();

      await markNotificationRead(note.id, owner.id);
      [row] = await db.select().from(notifications).where(eq(notifications.id, note.id));
      expect(row.readAt).not.toBeNull();
    } finally {
      await db.delete(notifications).where(eq(notifications.userId, owner.id));
      await db.delete(users).where(eq(users.id, owner.id));
      await db.delete(users).where(eq(users.id, stranger.id));
    }
  });

  it("marks all of a user's notifications read", async () => {
    const user = await seedUser();
    try {
      await db.insert(notifications).values([
        { userId: user.id, type: "due_soon", title: "a", body: "b" },
        { userId: user.id, type: "overdue", title: "c", body: "d" },
      ]);
      await markAllNotificationsRead(user.id);
      expect(await countUnreadNotifications(user.id)).toBe(0);
    } finally {
      await db.delete(notifications).where(eq(notifications.userId, user.id));
      await db.delete(users).where(eq(users.id, user.id));
    }
  });
});
