import { db } from "@/lib/db/client";
import { notifications } from "@/lib/db/schema";
import { eq, and, isNull, desc, sql } from "drizzle-orm";

export interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string;
  linkHref: string | null;
  readAt: string | null;
  createdAt: string;
}

export async function listNotificationsForUser(
  userId: string,
  opts?: { limit?: number; offset?: number }
): Promise<NotificationRow[]> {
  const limit = Math.min(opts?.limit ?? 20, 100);
  const offset = opts?.offset ?? 0;

  const rows = await db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit)
    .offset(offset);

  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    linkHref: row.linkHref,
    readAt: row.readAt ? row.readAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function countUnreadNotifications(userId: string): Promise<number> {
  const result = await db
    .select({ count: sql<number>`cast(count(*) as integer)` })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));

  return result[0]?.count ?? 0;
}

export async function markNotificationRead(id: string, userId: string): Promise<void> {
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.id, id), eq(notifications.userId, userId)));
}

export async function markAllNotificationsRead(userId: string): Promise<void> {
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
}
