import { describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users, notifications } from "@/lib/db/schema";
import { auth } from "@/auth";
import { PATCH } from "./route";

vi.mock("@/auth", () => ({ auth: vi.fn() }));

describe("PATCH /api/notifications/:id/read", () => {
  it("marks the caller's own notification read", async () => {
    const [user] = await db.insert(users).values({ email: `read-${randomUUID()}@example.com`, displayName: "Reader" }).returning();
    vi.mocked(auth).mockResolvedValue({ user: { email: user.email } } as never);
    try {
      const [note] = await db.insert(notifications).values({ userId: user.id, type: "due_soon", title: "t", body: "b" }).returning();
      const response = await PATCH({} as never, { params: Promise.resolve({ id: note.id }) });
      expect(response.status).toBe(200);
      const [row] = await db.select().from(notifications).where(eq(notifications.id, note.id));
      expect(row.readAt).not.toBeNull();
    } finally {
      await db.delete(notifications).where(eq(notifications.userId, user.id));
      await db.delete(users).where(eq(users.id, user.id));
    }
  });

  it("returns 400 for a non-UUID id", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { email: "x@example.com" } } as never);
    const response = await PATCH({} as never, { params: Promise.resolve({ id: "not-a-uuid" }) });
    expect(response.status).toBe(400);
  });
});
