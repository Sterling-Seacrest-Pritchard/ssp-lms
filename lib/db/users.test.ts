import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { upsertUser } from "./users";
import { db } from "./client";
import { users, departments } from "./schema";

describe("upsertUser", () => {
  it("inserts a new user on first sign-in", async () => {
    const entraObjectId = randomUUID();
    try {
      await upsertUser({ entraObjectId, email: "new.user@example.com", displayName: "New User" });

      const [row] = await db.select().from(users).where(eq(users.entraObjectId, entraObjectId));
      expect(row.email).toBe("new.user@example.com");
      expect(row.displayName).toBe("New User");
      expect(row.departmentId).toBeNull();
    } finally {
      await db.delete(users).where(eq(users.entraObjectId, entraObjectId));
    }
  });

  it("updates email/displayName on a later sign-in but never touches departmentId", async () => {
    const entraObjectId = randomUUID();
    const dept = await db
      .insert(departments)
      .values({ name: `Dept-${randomUUID()}` })
      .returning()
      .then(([d]) => d);
    try {
      await upsertUser({ entraObjectId, email: "old@example.com", displayName: "Old Name" });
      await db
        .update(users)
        .set({ departmentId: dept.id })
        .where(eq(users.entraObjectId, entraObjectId));

      await upsertUser({ entraObjectId, email: "new@example.com", displayName: "New Name" });

      const [row] = await db.select().from(users).where(eq(users.entraObjectId, entraObjectId));
      expect(row.email).toBe("new@example.com");
      expect(row.displayName).toBe("New Name");
      expect(row.departmentId).toBe(dept.id);
    } finally {
      await db.delete(users).where(eq(users.entraObjectId, entraObjectId));
      await db.delete(departments).where(eq(departments.id, dept.id));
    }
  });
});
