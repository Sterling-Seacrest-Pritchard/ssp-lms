import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users, notifications } from "@/lib/db/schema";
import { createNotification } from "./create";

describe("createNotification", () => {
  it("inserts a notification row for the given user", async () => {
    const [user] = await db
      .insert(users)
      .values({ email: `create-notif-${randomUUID()}@example.com`, displayName: "Create Notif User" })
      .returning();
    try {
      await createNotification({
        userId: user.id,
        type: "course_assigned",
        title: "New course assigned",
        body: "AML Fundamentals",
        linkHref: "/courses/abc",
      });
      const rows = await db.select().from(notifications).where(eq(notifications.userId, user.id));
      expect(rows).toHaveLength(1);
      expect(rows[0].type).toBe("course_assigned");
      expect(rows[0].linkHref).toBe("/courses/abc");
      expect(rows[0].readAt).toBeNull();
    } finally {
      await db.delete(notifications).where(eq(notifications.userId, user.id));
      await db.delete(users).where(eq(users.id, user.id));
    }
  });
});
