import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { listAssignedUsers } from "@/lib/entra/graph-client";
import { upsertUser } from "@/lib/db/users";

export interface SyncResult {
  total: number;
  created: number;
  updated: number;
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

  return { total: assigned.length, created, updated };
}
