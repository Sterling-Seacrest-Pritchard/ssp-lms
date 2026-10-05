import { and, eq, gte, isNotNull, isNull, lte } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { courses, enrollments, users } from "@/lib/db/schema";
import { sendDueDateReminderEmail } from "./notifications";

const REMINDER_LEAD_DAYS = 3;

export interface DueDateReminderResult {
  checked: number;
  sent: number;
  failed: number;
}

/**
 * Daily sweep (see the cron route at app/api/admin/notifications/
 * due-date-reminders/cron): emails anyone whose enrollment due date falls
 * within the next REMINDER_LEAD_DAYS, hasn't completed the course, and is
 * still an active user. due_reminder_sent_at gates this to once per
 * enrollment - a failed send leaves it unset so the next day's run retries,
 * but a successful one never re-sends for the same due date.
 *
 * Intentionally simple/sequential, same posture as the existing Entra-sync
 * and department-bulk-assign loops elsewhere in this codebase - revisit
 * only if org size makes a per-row await loop too slow.
 */
export async function sendDueDateReminders(now: Date = new Date()): Promise<DueDateReminderResult> {
  const windowEnd = new Date(now.getTime() + REMINDER_LEAD_DAYS * 24 * 60 * 60 * 1000);

  const candidates = await db
    .select({
      enrollmentId: enrollments.id,
      dueAt: enrollments.dueAt,
      status: enrollments.status,
      courseTitle: courses.title,
      userEmail: users.email,
      userDisplayName: users.displayName,
      isActive: users.isActive,
    })
    .from(enrollments)
    .innerJoin(courses, eq(courses.id, enrollments.courseId))
    .innerJoin(users, eq(users.id, enrollments.userId))
    .where(
      and(
        isNotNull(enrollments.dueAt),
        isNull(enrollments.dueReminderSentAt),
        gte(enrollments.dueAt, now),
        lte(enrollments.dueAt, windowEnd)
      )
    );

  let sent = 0;
  let failed = 0;
  for (const row of candidates) {
    if (!row.dueAt || row.status === "completed" || !row.isActive) continue;
    try {
      await sendDueDateReminderEmail(
        { email: row.userEmail, displayName: row.userDisplayName },
        { title: row.courseTitle, dueAt: row.dueAt }
      );
      await db
        .update(enrollments)
        .set({ dueReminderSentAt: new Date() })
        .where(eq(enrollments.id, row.enrollmentId));
      sent++;
    } catch (error) {
      failed++;
      console.error(`sendDueDateReminders: failed for enrollment ${row.enrollmentId}:`, error);
    }
  }

  return { checked: candidates.length, sent, failed };
}
