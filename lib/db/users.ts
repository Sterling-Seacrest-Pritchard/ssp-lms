import { db } from "./client";
import { users } from "./schema";

export async function upsertUser(fields: {
  entraObjectId: string;
  email: string;
  displayName: string;
}): Promise<void> {
  await db
    .insert(users)
    .values(fields)
    .onConflictDoUpdate({
      target: users.entraObjectId,
      set: { email: fields.email, displayName: fields.displayName, updatedAt: new Date() },
    });
}
