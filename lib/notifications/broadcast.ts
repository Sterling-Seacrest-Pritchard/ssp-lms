import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { notificationBroadcasts, notifications, users } from "@/lib/db/schema";

export interface CreateBroadcastInput {
  authorEmail: string;
  title: string;
  body: string;
  targetScope: "all" | "department";
  targetDepartmentId?: string | null;
}

export interface CreateBroadcastResult {
  broadcastId: string;
  recipientCount: number;
}

export async function createBroadcast(input: CreateBroadcastInput): Promise<CreateBroadcastResult> {
  return db.transaction(async (tx) => {
    // Insert one notificationBroadcasts row
    const [broadcast] = await tx
      .insert(notificationBroadcasts)
      .values({
        authorEmail: input.authorEmail,
        title: input.title,
        body: input.body,
        targetScope: input.targetScope,
        targetDepartmentId: input.targetScope === "department" ? input.targetDepartmentId : null,
      })
      .returning();

    // Resolve recipients based on targetScope
    let recipients: { id: string }[];
    if (input.targetScope === "all") {
      recipients = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.isActive, true));
    } else if (input.targetDepartmentId) {
      // targetScope === "department" - narrowed to a defined string here so
      // the drizzle `eq()` overload resolves (it doesn't accept null/undefined).
      const targetDepartmentId = input.targetDepartmentId;
      recipients = await tx
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            eq(users.isActive, true),
            eq(users.departmentId, targetDepartmentId)
          )
        );
    } else {
      recipients = [];
    }

    // Bulk-insert one notification row per recipient in a single statement,
    // in the same transaction as the broadcast row - no per-recipient
    // round-trips (previously ~10.7s for ~425 users), and no risk of a
    // mid-loop failure leaving a committed broadcast with partial fan-out
    // that a retry would duplicate.
    if (recipients.length > 0) {
      await tx.insert(notifications).values(
        recipients.map((recipient) => ({
          userId: recipient.id,
          type: "admin_broadcast",
          title: input.title,
          body: input.body,
          broadcastId: broadcast.id,
        }))
      );
    }

    return {
      broadcastId: broadcast.id,
      recipientCount: recipients.length,
    };
  });
}
