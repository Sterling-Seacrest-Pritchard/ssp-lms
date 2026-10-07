import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { notificationBroadcasts, users } from "@/lib/db/schema";
import { createNotification } from "./create";

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
  // Insert one notificationBroadcasts row
  const [broadcast] = await db
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
  let recipients;
  if (input.targetScope === "all") {
    recipients = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.isActive, true));
  } else {
    // targetScope === "department"
    recipients = await db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.isActive, true),
          eq(users.departmentId, input.targetDepartmentId)
        )
      );
  }

  // Fan out one notification per recipient
  for (const recipient of recipients) {
    await createNotification({
      userId: recipient.id,
      type: "admin_broadcast",
      title: input.title,
      body: input.body,
      broadcastId: broadcast.id,
    });
  }

  return {
    broadcastId: broadcast.id,
    recipientCount: recipients.length,
  };
}
