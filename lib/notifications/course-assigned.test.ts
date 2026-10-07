import { describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users, notifications } from "@/lib/db/schema";
import { sendCourseAssignedEmail } from "@/lib/mail/notifications";
import { notifyCourseAssigned } from "./course-assigned";

vi.mock("@/lib/mail/notifications", () => ({
  sendCourseAssignedEmail: vi.fn().mockResolvedValue(undefined),
}));

describe("notifyCourseAssigned", () => {
  it("writes a course_assigned notification and sends the email", async () => {
    const [user] = await db
      .insert(users)
      .values({ email: `notify-assigned-${randomUUID()}@example.com`, displayName: "Assignee" })
      .returning();
    try {
      await notifyCourseAssigned(
        user.id,
        { email: user.email, displayName: user.displayName },
        { courseId: "course-123", title: "AML Fundamentals", dueAt: null }
      );

      const rows = await db.select().from(notifications).where(eq(notifications.userId, user.id));
      expect(rows).toHaveLength(1);
      expect(rows[0].type).toBe("course_assigned");
      expect(rows[0].linkHref).toBe("/courses/course-123");

      expect(sendCourseAssignedEmail).toHaveBeenCalledWith(
        { email: user.email, displayName: user.displayName },
        { courseId: "course-123", title: "AML Fundamentals", dueAt: null }
      );
    } finally {
      await db.delete(notifications).where(eq(notifications.userId, user.id));
      await db.delete(users).where(eq(users.id, user.id));
    }
  });
});
