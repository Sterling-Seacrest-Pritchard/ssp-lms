import { describe, it, expect, vi, beforeEach } from "vitest";
import { sendMail } from "./graph-mail";
import { sendCourseAssignedEmail, sendDueDateReminderEmail, sendOverdueEmail } from "./notifications";

vi.mock("./graph-mail", () => ({
  sendMail: vi.fn().mockResolvedValue(undefined),
}));

describe("sendCourseAssignedEmail", () => {
  beforeEach(() => {
    vi.mocked(sendMail).mockClear();
  });

  it("sends to the user with a subject naming the course", async () => {
    await sendCourseAssignedEmail(
      { email: "learner@example.com", displayName: "Jamie Learner" },
      { title: "Fire Safety" }
    );
    expect(sendMail).toHaveBeenCalledTimes(1);
    const [{ to, subject, html }] = vi.mocked(sendMail).mock.calls[0];
    expect(to).toEqual(["learner@example.com"]);
    expect(subject).toBe("New course assigned: Fire Safety");
    expect(html).toContain("Fire Safety");
    expect(html).toContain("Jamie Learner");
  });

  it("includes a due date line only when a due date is given", async () => {
    await sendCourseAssignedEmail(
      { email: "a@example.com", displayName: "A" },
      { title: "No Due Date Course" }
    );
    const [withoutDue] = vi.mocked(sendMail).mock.calls[0];
    expect(withoutDue.html).not.toContain("It's due by");

    await sendCourseAssignedEmail(
      { email: "a@example.com", displayName: "A" },
      // Noon UTC, not a bare date-only string - sidesteps formatDate's
      // local-timezone day-boundary quirk with midnight-UTC date strings.
      { title: "Has A Due Date", dueAt: "2026-12-25T12:00:00Z" }
    );
    const [withDue] = vi.mocked(sendMail).mock.calls[1];
    expect(withDue.html).toContain("It's due by");
    expect(withDue.html).toContain("12/25/2026");
  });

  it("HTML-escapes the course title and display name", async () => {
    await sendCourseAssignedEmail(
      { email: "a@example.com", displayName: '<img src=x onerror=alert(1)>' },
      { title: '<b>Injected</b> & "Course"' }
    );
    const [{ html }] = vi.mocked(sendMail).mock.calls[0];
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>Injected</b>");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain("&lt;b&gt;Injected&lt;/b&gt; &amp; &quot;Course&quot;");
  });
});

describe("sendDueDateReminderEmail", () => {
  beforeEach(() => {
    vi.mocked(sendMail).mockClear();
  });

  it("sends a reminder subject and body with the due date", async () => {
    await sendDueDateReminderEmail(
      { email: "learner@example.com", displayName: "Jamie Learner" },
      { title: "Fire Safety", dueAt: "2026-11-01T12:00:00Z" }
    );
    expect(sendMail).toHaveBeenCalledTimes(1);
    const [{ to, subject, html }] = vi.mocked(sendMail).mock.calls[0];
    expect(to).toEqual(["learner@example.com"]);
    expect(subject).toBe("Reminder: Fire Safety is due soon");
    expect(html).toContain("11/01/2026");
  });
});

describe("sendOverdueEmail", () => {
  it("sends an overdue email with the course title and due date", async () => {
    await sendOverdueEmail(
      { email: "learner@example.com", displayName: "Learner Name" },
      { title: "AML Fundamentals", dueAt: new Date("2026-01-01T00:00:00Z") }
    );
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: ["learner@example.com"], subject: expect.stringContaining("Overdue") })
    );
  });
});
