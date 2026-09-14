import { and, eq, isNull } from "drizzle-orm";
import { db } from "./client";
import { users } from "./schema";

/**
 * Three lookup paths, checked in order - the middle one is what makes
 * pre-provisioning (see lib/entra/graph-client.ts) actually connect to a
 * person's real sign-in instead of creating a second, disconnected row:
 *
 * 1. Existing row matched by entraObjectId - today's normal repeat sign-in.
 * 2. No entraObjectId match, but an existing row matched by email WHERE
 *    entraObjectId IS NULL (synced in from Entra, never signed in before) -
 *    CLAIM it: set entraObjectId, leave id/departmentId/course_assignments
 *    untouched. A plain onConflictDoUpdate on entraObjectId can't do this on
 *    its own - Postgres unique constraints never treat two NULLs as
 *    conflicting, so inserting a fresh row here would collide on the EMAIL
 *    unique constraint instead of updating the row we actually want.
 * 3. No match at all - insert a new row, same as always.
 *
 * departmentId is never touched here in any path - that's admin-owned state,
 * not something a login should reset.
 */
export async function upsertUser(fields: {
  entraObjectId: string;
  email: string;
  displayName: string;
  // Only present on the Entra-sync path (see lib/entra/graph-client.ts) -
  // omitted (not null) on a plain sign-in, so a login never clobbers the
  // role last seen at sync time.
  entraRole?: string | null;
}): Promise<void> {
  const roleUpdate = fields.entraRole !== undefined ? { entraRole: fields.entraRole } : {};

  const [byObjectId] = await db.select().from(users).where(eq(users.entraObjectId, fields.entraObjectId));
  if (byObjectId) {
    await db
      .update(users)
      .set({ email: fields.email, displayName: fields.displayName, updatedAt: new Date(), ...roleUpdate })
      .where(eq(users.id, byObjectId.id));
    return;
  }

  const [byEmail] = await db
    .select()
    .from(users)
    .where(and(eq(users.email, fields.email), isNull(users.entraObjectId)));
  if (byEmail) {
    await db
      .update(users)
      .set({ entraObjectId: fields.entraObjectId, displayName: fields.displayName, updatedAt: new Date(), ...roleUpdate })
      .where(eq(users.id, byEmail.id));
    return;
  }

  await db.insert(users).values(fields);
}
