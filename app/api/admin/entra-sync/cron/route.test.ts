import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const ORIGINAL_ENV = { ...process.env };

vi.mock("@/lib/entra/sync", () => ({
  syncAssignedUsers: vi.fn(async () => ({ total: 2, created: 1, updated: 1 })),
}));

describe("GET /api/admin/entra-sync/cron", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "test-cron-secret";
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.clearAllMocks();
  });

  it("rejects a request with no Authorization header", async () => {
    const { GET } = await import("./route");
    const request = new NextRequest("https://example.com/api/admin/entra-sync/cron");
    const response = await GET(request);
    expect(response.status).toBe(401);
  });

  it("rejects a request with the wrong secret", async () => {
    const { GET } = await import("./route");
    const request = new NextRequest("https://example.com/api/admin/entra-sync/cron", {
      headers: { authorization: "Bearer wrong-secret" },
    });
    const response = await GET(request);
    expect(response.status).toBe(401);
  });

  it("runs the sync when the correct CRON_SECRET is presented", async () => {
    const { GET } = await import("./route");
    const request = new NextRequest("https://example.com/api/admin/entra-sync/cron", {
      headers: { authorization: "Bearer test-cron-secret" },
    });
    const response = await GET(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ total: 2, created: 1, updated: 1 });
  });
});
