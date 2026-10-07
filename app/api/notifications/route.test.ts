import { describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users, notifications } from "@/lib/db/schema";
import { auth } from "@/auth";
import { GET } from "./route";

vi.mock("@/auth", () => ({ auth: vi.fn() }));

describe("GET /api/notifications", () => {
  it("returns the signed-in user's notifications and unread count", async () => {
    const [user] = await db.insert(users).values({ email: `api-notif-${randomUUID()}@example.com`, displayName: "API User" }).returning();
    vi.mocked(auth).mockResolvedValue({ user: { email: user.email } } as never);
    try {
      await db.insert(notifications).values({ userId: user.id, type: "due_soon", title: "t", body: "b" });
      const response = await GET();
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.notifications).toHaveLength(1);
      expect(body.unreadCount).toBe(1);
    } finally {
      await db.delete(notifications).where(eq(notifications.userId, user.id));
      await db.delete(users).where(eq(users.id, user.id));
    }
  });

  it("returns 401 when not signed in", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    const response = await GET();
    expect(response.status).toBe(401);
  });
});
