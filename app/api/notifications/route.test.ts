import { describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { db } from "@/lib/db/client";
import { users, notifications } from "@/lib/db/schema";
import { auth } from "@/auth";
import { GET } from "./route";

vi.mock("@/auth", () => ({ auth: vi.fn() }));

function requestWithLimit(limit?: string): NextRequest {
  const url = limit ? `http://localhost/api/notifications?limit=${limit}` : "http://localhost/api/notifications";
  return new NextRequest(url);
}

describe("GET /api/notifications", () => {
  it("returns the signed-in user's notifications and unread count", async () => {
    const [user] = await db.insert(users).values({ email: `api-notif-${randomUUID()}@example.com`, displayName: "API User" }).returning();
    vi.mocked(auth).mockResolvedValue({ user: { email: user.email } } as never);
    try {
      await db.insert(notifications).values({ userId: user.id, type: "due_soon", title: "t", body: "b" });
      const response = await GET(requestWithLimit());
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.notifications).toHaveLength(1);
      expect(body.unreadCount).toBe(1);
    } finally {
      await db.delete(notifications).where(eq(notifications.userId, user.id));
      await db.delete(users).where(eq(users.id, user.id));
    }
  });

  it("honors the ?limit query param", async () => {
    const [user] = await db.insert(users).values({ email: `api-notif-${randomUUID()}@example.com`, displayName: "API User" }).returning();
    vi.mocked(auth).mockResolvedValue({ user: { email: user.email } } as never);
    try {
      await db.insert(notifications).values(
        Array.from({ length: 5 }, (_, i) => ({ userId: user.id, type: "due_soon" as const, title: `t${i}`, body: "b" }))
      );
      const response = await GET(requestWithLimit("2"));
      const body = await response.json();
      expect(body.notifications).toHaveLength(2);
      expect(body.unreadCount).toBe(5);
    } finally {
      await db.delete(notifications).where(eq(notifications.userId, user.id));
      await db.delete(users).where(eq(users.id, user.id));
    }
  });

  it("falls back to the default limit when ?limit is invalid", async () => {
    const [user] = await db.insert(users).values({ email: `api-notif-${randomUUID()}@example.com`, displayName: "API User" }).returning();
    vi.mocked(auth).mockResolvedValue({ user: { email: user.email } } as never);
    try {
      await db.insert(notifications).values({ userId: user.id, type: "due_soon", title: "t", body: "b" });
      const response = await GET(requestWithLimit("not-a-number"));
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.notifications).toHaveLength(1);
    } finally {
      await db.delete(notifications).where(eq(notifications.userId, user.id));
      await db.delete(users).where(eq(users.id, user.id));
    }
  });

  it("returns 401 when not signed in", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    const response = await GET(requestWithLimit());
    expect(response.status).toBe(401);
  });
});
