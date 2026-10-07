import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const ORIGINAL_ENV = { ...process.env };

vi.mock("@/lib/mail/due-date-reminders", () => ({
  sendDueDateReminders: vi.fn(async () => ({ checked: 2, sent: 1, failed: 0 })),
  sendOverdueNotifications: vi.fn(async () => ({ checked: 3, sent: 2, failed: 1 })),
}));

describe("GET /api/admin/notifications/due-date-reminders/cron", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "test-cron-secret";
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.clearAllMocks();
  });

  it("rejects a request with no Authorization header", async () => {
    const { GET } = await import("./route");
    const request = new NextRequest("https://example.com/api/admin/notifications/due-date-reminders/cron");
    const response = await GET(request);
    expect(response.status).toBe(401);
  });

  it("rejects a request with the wrong secret", async () => {
    const { GET } = await import("./route");
    const request = new NextRequest("https://example.com/api/admin/notifications/due-date-reminders/cron", {
      headers: { authorization: "Bearer wrong-secret" },
    });
    const response = await GET(request);
    expect(response.status).toBe(401);
  });

  it("fails closed with 500 when CRON_SECRET is unset, even if the request literally sends 'Bearer undefined'", async () => {
    delete process.env.CRON_SECRET;
    const { GET } = await import("./route");
    const request = new NextRequest("https://example.com/api/admin/notifications/due-date-reminders/cron", {
      headers: { authorization: "Bearer undefined" },
    });
    const response = await GET(request);
    expect(response.status).toBe(500);
  });

  it("runs both sweeps and merges their results when the correct CRON_SECRET is presented", async () => {
    const { GET } = await import("./route");
    const request = new NextRequest("https://example.com/api/admin/notifications/due-date-reminders/cron", {
      headers: { authorization: "Bearer test-cron-secret" },
    });
    const response = await GET(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ checked: 5, sent: 3, failed: 1 });
  });
});
