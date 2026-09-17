import { describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { computeStaleEntraObjectIds } from "./sync";

describe("computeStaleEntraObjectIds", () => {
  it("returns ids that are active but no longer in the assigned list", () => {
    expect(computeStaleEntraObjectIds(["a", "b"], ["a", "b", "c"])).toEqual(["c"]);
  });

  it("returns an empty array when everyone active is still assigned", () => {
    expect(computeStaleEntraObjectIds(["a", "b", "c"], ["a", "b"])).toEqual([]);
  });

  it("returns an empty array (never 'deactivate everyone') when the assigned list is empty", () => {
    expect(computeStaleEntraObjectIds([], ["a", "b", "c"])).toEqual([]);
  });

  it("returns an empty array when there are no currently-active ids to check", () => {
    expect(computeStaleEntraObjectIds(["a"], [])).toEqual([]);
  });
});

// The real `getActiveSyncedUserObjectIds` reads every active user in the
// table - mocking it to return only our synthetic ids is what makes this
// integration test safe to run against the shared production database
// (there is no separate test DB in this project). Without this mock, the
// deactivation query's real target list would include every genuinely
// active real user, not just the ones this test creates and controls.
const { getActiveSyncedUserObjectIdsMock } = vi.hoisted(() => ({
  getActiveSyncedUserObjectIdsMock: vi.fn(),
}));
vi.mock("@/lib/db/users", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db/users")>("@/lib/db/users");
  return { ...actual, getActiveSyncedUserObjectIds: getActiveSyncedUserObjectIdsMock };
});

const { listAssignedUsersMock } = vi.hoisted(() => ({ listAssignedUsersMock: vi.fn() }));
vi.mock("@/lib/entra/graph-client", () => ({ listAssignedUsers: listAssignedUsersMock }));

const { syncAssignedUsers } = await import("./sync");

describe("syncAssignedUsers", () => {
  it("deactivates only the synthetic user this test controls, never sweeping in real rows", async () => {
    const stillAssignedId = randomUUID();
    const removedId = randomUUID();
    const [stillAssigned] = await db
      .insert(users)
      .values({ entraObjectId: stillAssignedId, email: `still-${randomUUID()}@example.com`, displayName: "Still Assigned" })
      .returning();
    const [removed] = await db
      .insert(users)
      .values({ entraObjectId: removedId, email: `removed-${randomUUID()}@example.com`, displayName: "Removed" })
      .returning();

    // Only these two synthetic ids are "currently active" as far as this
    // sync run can see - the real target list is scoped entirely by this
    // mock, not by the real table's contents.
    getActiveSyncedUserObjectIdsMock.mockResolvedValue([stillAssignedId, removedId]);
    listAssignedUsersMock.mockResolvedValue([
      { entraObjectId: stillAssignedId, email: stillAssigned.email, displayName: "Still Assigned", entraRole: null },
    ]);

    try {
      const result = await syncAssignedUsers();
      expect(result.deactivated).toBe(1);

      const [stillRow] = await db.select().from(users).where(eq(users.id, stillAssigned.id));
      expect(stillRow.isActive).toBe(true);

      const [removedRow] = await db.select().from(users).where(eq(users.id, removed.id));
      expect(removedRow.isActive).toBe(false);
    } finally {
      await db.delete(users).where(eq(users.id, stillAssigned.id));
      await db.delete(users).where(eq(users.id, removed.id));
    }
  });

  it("does not deactivate anyone when Entra returns an empty assigned list", async () => {
    const entraObjectId = randomUUID();
    const [user] = await db
      .insert(users)
      .values({ entraObjectId, email: `safety-${randomUUID()}@example.com`, displayName: "Safety Check" })
      .returning();

    getActiveSyncedUserObjectIdsMock.mockResolvedValue([entraObjectId]);
    listAssignedUsersMock.mockResolvedValue([]);

    try {
      const result = await syncAssignedUsers();
      expect(result.deactivated).toBe(0);

      const [row] = await db.select().from(users).where(eq(users.id, user.id));
      expect(row.isActive).toBe(true);
    } finally {
      await db.delete(users).where(eq(users.id, user.id));
    }
  });
});
