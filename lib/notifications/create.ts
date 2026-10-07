import { db } from "@/lib/db/client";
import { notifications } from "@/lib/db/schema";

export type NotificationType = "course_assigned" | "due_soon" | "overdue" | "admin_broadcast";

export interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  linkHref?: string | null;
  broadcastId?: string | null;
}

export async function createNotification(input: CreateNotificationInput): Promise<void> {
  await db.insert(notifications).values({
    userId: input.userId,
    type: input.type,
    title: input.title,
    body: input.body,
    linkHref: input.linkHref ?? null,
    broadcastId: input.broadcastId ?? null,
  });
}
