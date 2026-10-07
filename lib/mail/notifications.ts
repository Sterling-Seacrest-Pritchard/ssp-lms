import { sendMail } from "./graph-mail";
import { formatDate } from "@/lib/format-date";

// Course titles are admin-authored free text (including by Department
// Admins, a lower trust tier than Org Admin) and display names are synced
// from Entra - neither is attacker-controlled in the usual web-request
// sense, but both end up rendered as HTML inside an official-looking email
// sent as noreply@sspins.com, so they're escaped before interpolation
// rather than trusted as safe markup.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const BRAND_BLUE = "#304d7d";
// Email clients strip remote @font-face/custom webfonts almost universally,
// so this deliberately does NOT reference the app's self-hosted Nunito.
// Arial is both the brand's own header font and a safe cross-client email
// default, so it covers the whole email rather than just headers.
const FONT_STACK = "Arial, Helvetica, sans-serif";
const APP_URL = process.env.AUTH_URL ?? "https://ssp-lms.vercel.app";

function wrapEmail(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background:#f4f4f4;font-family:${FONT_STACK};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">
            <tr>
              <td style="background:${BRAND_BLUE};padding:20px 24px;">
                <span style="color:#ffffff;font-size:18px;font-weight:bold;">Sterling Seacrest Pritchard</span>
              </td>
            </tr>
            <tr>
              <td style="padding:24px;color:#1a1a1a;font-size:14px;line-height:1.5;">
                <h1 style="margin:0 0 12px;font-size:18px;color:${BRAND_BLUE};">${title}</h1>
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:16px 24px;background:#f4f4f4;color:#888888;font-size:11px;">
                This is an automated message from the SSP Learning Management System. Please do not reply to this email.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export interface NotifyUser {
  email: string;
  displayName: string;
}

export interface NotifyCourse {
  title: string;
  dueAt?: string | Date | null;
}

/**
 * Fired when a course is assigned to a learner - directly, via a department
 * bulk-assign, or via a new department member picking up that department's
 * existing courses - see lib/db/course-assignments.ts's assignCourse, the
 * one place all three paths converge. Best-effort: callers must catch and
 * log rather than let a failed send affect the assignment itself.
 */
export async function sendCourseAssignedEmail(user: NotifyUser, course: NotifyCourse): Promise<void> {
  const title = escapeHtml(course.title);
  const name = escapeHtml(user.displayName);
  const dueLine = course.dueAt
    ? `<p style="margin:0 0 16px;">It's due by <strong>${formatDate(course.dueAt)}</strong>.</p>`
    : "";
  const html = wrapEmail(
    "New course assigned",
    `<p style="margin:0 0 16px;">Hi ${name},</p>
     <p style="margin:0 0 16px;">You've been assigned a new course: <strong>${title}</strong>.</p>
     ${dueLine}
     <p style="margin:0;"><a href="${APP_URL}/courses" style="color:${BRAND_BLUE};">View your courses</a></p>`
  );
  await sendMail({ to: [user.email], subject: `New course assigned: ${course.title}`, html });
}

/**
 * Fired by the daily due-date-reminder cron (lib/mail/due-date-reminders.ts)
 * for enrollments whose due date is coming up and haven't been reminded yet.
 */
export async function sendDueDateReminderEmail(
  user: NotifyUser,
  course: NotifyCourse & { dueAt: string | Date }
): Promise<void> {
  const title = escapeHtml(course.title);
  const name = escapeHtml(user.displayName);
  const html = wrapEmail(
    "Course due soon",
    `<p style="margin:0 0 16px;">Hi ${name},</p>
     <p style="margin:0 0 16px;"><strong>${title}</strong> is due by <strong>${formatDate(course.dueAt)}</strong>.</p>
     <p style="margin:0;"><a href="${APP_URL}/courses" style="color:${BRAND_BLUE};">Finish it now</a></p>`
  );
  await sendMail({ to: [user.email], subject: `Reminder: ${course.title} is due soon`, html });
}

/**
 * Fired by the daily overdue sweep (lib/mail/due-date-reminders.ts's
 * sendOverdueNotifications) for enrollments whose due date has already
 * passed and haven't been notified yet.
 */
export async function sendOverdueEmail(
  user: NotifyUser,
  course: NotifyCourse & { dueAt: string | Date }
): Promise<void> {
  const title = escapeHtml(course.title);
  const name = escapeHtml(user.displayName);
  const html = wrapEmail(
    "Course overdue",
    `<p style="margin:0 0 16px;">Hi ${name},</p>
     <p style="margin:0 0 16px;"><strong>${title}</strong> was due by <strong>${formatDate(course.dueAt)}</strong> and is now past its due date.</p>
     <p style="margin:0;"><a href="${APP_URL}/courses" style="color:${BRAND_BLUE};">Finish it now</a></p>`
  );
  await sendMail({ to: [user.email], subject: `Overdue: ${course.title}`, html });
}
