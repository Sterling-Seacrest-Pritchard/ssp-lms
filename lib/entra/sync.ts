import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { listAssignedUsers } from "@/lib/entra/graph-client";
import { upsertUser, getActiveSyncedUserObjectIds } from "@/lib/db/users";

export interface SyncResult {
  total: number;
  created: number;
  updated: number;
  deactivated: number;
}

/**
 * Anyone currently marked active with an entraObjectId (i.e. has
 * synced/signed in via Entra before) who isn't in this sync's assigned list
 * is no longer assigned to the app in Entra - they're the ones to
 * deactivate. Pure and DB-free on purpose: the actual deactivation query
 * only ever touches the exact ids this function returns, via an explicit
 * `IN (...)` list - never a `NOT IN` scan over the whole table - so a test
 * feeding it a tiny fake `assignedObjectIds` list can never accidentally
 * sweep up real rows the way an unscoped negated-membership query would.
 *
 * An empty `assignedObjectIds` list returns no ids to deactivate rather than
 * "deactivate everyone currently active" - Graph returning zero people is
 * far more likely to be a transient API failure than every single
 * assignment vanishing at once, and mass-deactivating the whole org on a
 * hiccup would be a much worse failure mode than silently skipping this
 * sync's reconciliation.
 */
export function computeStaleEntraObjectIds(
  assignedObjectIds: string[],
  currentlyActiveObjectIds: string[]
): string[] {
  if (assignedObjectIds.length === 0) return [];
  const assignedSet = new Set(assignedObjectIds);
  return currentlyActiveObjectIds.filter((id) => !assignedSet.has(id));
}

/**
 * Shared by the manual "Sync from Entra" admin route and the daily cron
 * route so both call one code path instead of duplicating the created/updated
 * counting logic.
 */
export async function syncAssignedUsers(): Promise<SyncResult> {
  const assigned = await listAssignedUsers();

  let created = 0;
  let updated = 0;
  for (const person of assigned) {
    const [existing] = await db.select().from(users).where(eq(users.entraObjectId, person.entraObjectId));
    await upsertUser(person);
    if (existing) {
      updated += 1;
    } else {
      created += 1;
    }
  }

  const activeObjectIds = await getActiveSyncedUserObjectIds();
  const staleObjectIds = computeStaleEntraObjectIds(
    assigned.map((person) => person.entraObjectId),
    activeObjectIds
  );

  let deactivated = 0;
  if (staleObjectIds.length > 0) {
    const deactivatedRows = await db
      .update(users)
      .set({ isActive: false, updatedAt: new Date() })
      .where(inArray(users.entraObjectId, staleObjectIds))
      .returning({ id: users.id });
    deactivated = deactivatedRows.length;
  }

  return { total: assigned.length, created, updated, deactivated };
}
