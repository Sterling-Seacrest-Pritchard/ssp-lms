import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { courses, enrollments, users } from "@/lib/db/schema";
import { sendDueDateReminderEmail, sendOverdueEmail } from "./notifications";
import { sendDueDateReminders, sendOverdueNotifications } from "./due-date-reminders";
import { createNotification } from "@/lib/notifications/create";

vi.mock("./notifications", () => ({
  sendDueDateReminderEmail: vi.fn().mockResolvedValue(undefined),
  sendOverdueEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/notifications/create", () => ({
  createNotification: vi.fn().mockResolvedValue(undefined),
}));

const NOW = new Date("2026-06-15T00:00:00Z");
function daysFromNow(days: number): Date {
  return new Date(NOW.getTime() + days * 24 * 60 * 60 * 1000);
}

async function seedCourse() {
  const [course] = await db
    .insert(courses)
    .values({ code: `REMINDER-${randomUUID()}`, title: "Reminder Test Course" })
    .returning();
  return course;
}

async function seedUser(isActive = true) {
  const [user] = await db
    .insert(users)
    .values({ email: `reminder-${randomUUID()}@example.com`, displayName: "Reminder Test User", isActive })
    .returning();
  return user;
}

interface SeedEnrollmentOptions {
  dueAt?: Date | null;
  status?: string;
  dueReminderSentAt?: Date | null;
  isActive?: boolean;
}

async function seedEnrollment(opts: SeedEnrollmentOptions) {
  const course = await seedCourse();
  const user = await seedUser(opts.isActive ?? true);
  const [enrollment] = await db
    .insert(enrollments)
    .values({
      userId: user.id,
      courseId: course.id,
      dueAt: opts.dueAt ?? null,
      status: opts.status ?? "not_started",
      dueReminderSentAt: opts.dueReminderSentAt ?? null,
    })
    .returning();
  return { enrollment, course, user };
}

async function cleanup(ids: { enrollmentId?: string; courseId: string; userId: string }[]) {
  for (const { enrollmentId, courseId, userId } of ids) {
    if (enrollmentId) await db.delete(enrollments).where(eq(enrollments.id, enrollmentId));
    await db.delete(courses).where(eq(courses.id, courseId));
    await db.delete(users).where(eq(users.id, userId));
  }
}

describe("sendDueDateReminders", () => {
  beforeEach(() => {
    vi.mocked(sendDueDateReminderEmail).mockReset();
    vi.mocked(sendDueDateReminderEmail).mockResolvedValue(undefined);
  });

  it("emails and marks an enrollment due within the lead window", async () => {
    const seeded = await seedEnrollment({ dueAt: daysFromNow(2) });
    try {
      const result = await sendDueDateReminders(NOW);
      expect(result.sent).toBeGreaterThanOrEqual(1);
      expect(sendDueDateReminderEmail).toHaveBeenCalledWith(
        { email: seeded.user.email, displayName: seeded.user.displayName },
        { title: "Reminder Test Course", dueAt: seeded.enrollment.dueAt }
      );
      const [updated] = await db.select().from(enrollments).where(eq(enrollments.id, seeded.enrollment.id));
      expect(updated.dueReminderSentAt).not.toBeNull();
    } finally {
      await cleanup([{ enrollmentId: seeded.enrollment.id, courseId: seeded.course.id, userId: seeded.user.id }]);
    }
  });

  it("does not re-email an enrollment that already has a reminder sent", async () => {
    const seeded = await seedEnrollment({ dueAt: daysFromNow(1), dueReminderSentAt: daysFromNow(-1) });
    try {
      await sendDueDateReminders(NOW);
      const calledForThisUser = vi
        .mocked(sendDueDateReminderEmail)
        .mock.calls.some(([user]) => user.email === seeded.user.email);
      expect(calledForThisUser).toBe(false);
    } finally {
      await cleanup([{ enrollmentId: seeded.enrollment.id, courseId: seeded.course.id, userId: seeded.user.id }]);
    }
  });

  it("skips a completed enrollment even if due soon", async () => {
    const seeded = await seedEnrollment({ dueAt: daysFromNow(1), status: "completed" });
    try {
      await sendDueDateReminders(NOW);
      const calledForThisUser = vi
        .mocked(sendDueDateReminderEmail)
        .mock.calls.some(([user]) => user.email === seeded.user.email);
      expect(calledForThisUser).toBe(false);
    } finally {
      await cleanup([{ enrollmentId: seeded.enrollment.id, courseId: seeded.course.id, userId: seeded.user.id }]);
    }
  });

  it("skips a deactivated user even if their enrollment is due soon", async () => {
    const seeded = await seedEnrollment({ dueAt: daysFromNow(1), isActive: false });
    try {
      await sendDueDateReminders(NOW);
      const calledForThisUser = vi
        .mocked(sendDueDateReminderEmail)
        .mock.calls.some(([user]) => user.email === seeded.user.email);
      expect(calledForThisUser).toBe(false);
    } finally {
      await cleanup([{ enrollmentId: seeded.enrollment.id, courseId: seeded.course.id, userId: seeded.user.id }]);
    }
  });

  it("ignores enrollments due further out than the lead window", async () => {
    const seeded = await seedEnrollment({ dueAt: daysFromNow(30) });
    try {
      await sendDueDateReminders(NOW);
      const calledForThisUser = vi
        .mocked(sendDueDateReminderEmail)
        .mock.calls.some(([user]) => user.email === seeded.user.email);
      expect(calledForThisUser).toBe(false);
    } finally {
      await cleanup([{ enrollmentId: seeded.enrollment.id, courseId: seeded.course.id, userId: seeded.user.id }]);
    }
  });

  it("ignores enrollments with no due date", async () => {
    const seeded = await seedEnrollment({ dueAt: null });
    try {
      await sendDueDateReminders(NOW);
      const calledForThisUser = vi
        .mocked(sendDueDateReminderEmail)
        .mock.calls.some(([user]) => user.email === seeded.user.email);
      expect(calledForThisUser).toBe(false);
    } finally {
      await cleanup([{ enrollmentId: seeded.enrollment.id, courseId: seeded.course.id, userId: seeded.user.id }]);
    }
  });

  it("leaves due_reminder_sent_at unset when the send fails, so the next run retries", async () => {
    const seeded = await seedEnrollment({ dueAt: daysFromNow(1) });
    vi.mocked(sendDueDateReminderEmail).mockRejectedValueOnce(new Error("Graph sendMail failed"));
    try {
      const result = await sendDueDateReminders(NOW);
      expect(result.failed).toBeGreaterThanOrEqual(1);
      const [updated] = await db.select().from(enrollments).where(eq(enrollments.id, seeded.enrollment.id));
      expect(updated.dueReminderSentAt).toBeNull();
    } finally {
      await cleanup([{ enrollmentId: seeded.enrollment.id, courseId: seeded.course.id, userId: seeded.user.id }]);
    }
  });
});

describe("sendDueDateReminders notification write", () => {
  beforeEach(() => {
    vi.mocked(sendDueDateReminderEmail).mockReset();
    vi.mocked(sendDueDateReminderEmail).mockResolvedValue(undefined);
    vi.mocked(createNotification).mockClear();
  });

  it("also writes a due_soon notification when it emails a reminder", async () => {
    const seeded = await seedEnrollment({ dueAt: daysFromNow(2) });
    try {
      await sendDueDateReminders(NOW);
      expect(createNotification).toHaveBeenCalledWith(
        expect.objectContaining({ userId: seeded.user.id, type: "due_soon" })
      );
    } finally {
      await cleanup([{ enrollmentId: seeded.enrollment.id, courseId: seeded.course.id, userId: seeded.user.id }]);
    }
  });
});

describe("sendOverdueNotifications", () => {
  beforeEach(() => {
    vi.mocked(sendOverdueEmail).mockReset();
    vi.mocked(sendOverdueEmail).mockResolvedValue(undefined);
    vi.mocked(createNotification).mockClear();
  });

  it("emails and notifies an incomplete enrollment whose due date has passed", async () => {
    const seeded = await seedEnrollment({ dueAt: daysFromNow(-1) });
    try {
      const result = await sendOverdueNotifications(NOW);
      expect(result.sent).toBeGreaterThanOrEqual(1);
      expect(sendOverdueEmail).toHaveBeenCalled();
      expect(createNotification).toHaveBeenCalledWith(
        expect.objectContaining({ userId: seeded.user.id, type: "overdue" })
      );
      const [updated] = await db.select().from(enrollments).where(eq(enrollments.id, seeded.enrollment.id));
      expect(updated.overdueNotifiedAt).not.toBeNull();
    } finally {
      await cleanup([{ enrollmentId: seeded.enrollment.id, courseId: seeded.course.id, userId: seeded.user.id }]);
    }
  });

  it("does not re-notify an enrollment already marked overdue-notified", async () => {
    const seeded = await seedEnrollment({ dueAt: daysFromNow(-1) });
    await db.update(enrollments).set({ overdueNotifiedAt: daysFromNow(-1) }).where(eq(enrollments.id, seeded.enrollment.id));
    try {
      await sendOverdueNotifications(NOW);
      const called = vi.mocked(sendOverdueEmail).mock.calls.some(([user]) => user.email === seeded.user.email);
      expect(called).toBe(false);
    } finally {
      await cleanup([{ enrollmentId: seeded.enrollment.id, courseId: seeded.course.id, userId: seeded.user.id }]);
    }
  });

  it("skips a completed or inactive enrollment even if overdue", async () => {
    const completed = await seedEnrollment({ dueAt: daysFromNow(-1), status: "completed" });
    const inactive = await seedEnrollment({ dueAt: daysFromNow(-1), isActive: false });
    try {
      await sendOverdueNotifications(NOW);
      const emailed = vi.mocked(sendOverdueEmail).mock.calls.map(([user]) => user.email);
      expect(emailed).not.toContain(completed.user.email);
      expect(emailed).not.toContain(inactive.user.email);
    } finally {
      await cleanup([
        { enrollmentId: completed.enrollment.id, courseId: completed.course.id, userId: completed.user.id },
        { enrollmentId: inactive.enrollment.id, courseId: inactive.course.id, userId: inactive.user.id },
      ]);
    }
  });
});
