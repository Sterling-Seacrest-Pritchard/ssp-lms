import { describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users, notifications } from "@/lib/db/schema";
import { auth } from "@/auth";
import { countUnreadNotifications } from "@/lib/notifications/queries";
import { PATCH } from "./route";

vi.mock("@/auth", () => ({ auth: vi.fn() }));

describe("PATCH /api/notifications/read-all", () => {
  it("marks all of the caller's notifications read", async () => {
    const [user] = await db.insert(users).values({ email: `read-all-${randomUUID()}@example.com`, displayName: "Reader" }).returning();
    vi.mocked(auth).mockResolvedValue({ user: { email: user.email } } as never);
    try {
      await db.insert(notifications).values([
        { userId: user.id, type: "due_soon", title: "a", body: "b" },
        { userId: user.id, type: "overdue", title: "c", body: "d" },
      ]);
      const response = await PATCH();
      expect(response.status).toBe(200);
      expect(await countUnreadNotifications(user.id)).toBe(0);
    } finally {
      await db.delete(notifications).where(eq(notifications.userId, user.id));
      await db.delete(users).where(eq(users.id, user.id));
    }
  });

  it("returns 401 when not signed in", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    const response = await PATCH();
    expect(response.status).toBe(401);
  });
});
