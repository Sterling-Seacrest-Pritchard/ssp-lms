import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { serverError } from "@/lib/api/errors";
import { listAssignedUsers } from "@/lib/entra/graph-client";
import { upsertUser } from "@/lib/db/users";

export async function POST() {
  try {
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

    return NextResponse.json({ total: assigned.length, created, updated });
  } catch (error) {
    return serverError(error);
  }
}
