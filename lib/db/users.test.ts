import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { upsertUser, getUserIdByEmail } from "./users";
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

  it("claims a pre-provisioned (synced-but-never-signed-in) row by email instead of inserting a second one", async () => {
    const email = `pending-${randomUUID()}@example.com`;
    const dept = await db
      .insert(departments)
      .values({ name: `Dept-${randomUUID()}` })
      .returning()
      .then(([d]) => d);
    // Simulates what an Entra sync would leave behind: a row with no
    // entraObjectId yet, but already department-assigned by an admin.
    const [preProvisioned] = await db
      .insert(users)
      .values({ email, displayName: "Synced Name", departmentId: dept.id })
      .returning();

    const realObjectId = randomUUID();
    try {
      await upsertUser({ entraObjectId: realObjectId, email, displayName: "Real Sign-In Name" });

      const rows = await db.select().from(users).where(eq(users.email, email));
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(preProvisioned.id);
      expect(rows[0].entraObjectId).toBe(realObjectId);
      expect(rows[0].displayName).toBe("Real Sign-In Name");
      expect(rows[0].departmentId).toBe(dept.id);
    } finally {
      await db.delete(users).where(eq(users.email, email));
      await db.delete(departments).where(eq(departments.id, dept.id));
    }
  });
});

describe("getUserIdByEmail", () => {
  it("returns the user's id for a known email", async () => {
    const email = `lookup-${randomUUID()}@example.com`;
    const [user] = await db.insert(users).values({ email, displayName: "Lookup Test" }).returning();
    try {
      expect(await getUserIdByEmail(email)).toBe(user.id);
    } finally {
      await db.delete(users).where(eq(users.id, user.id));
    }
  });

  it("returns null for an unknown email", async () => {
    expect(await getUserIdByEmail(`unknown-${randomUUID()}@example.com`)).toBeNull();
  });
});
