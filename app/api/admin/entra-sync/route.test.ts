import { describe, it, expect, vi } from "vitest";
import { POST } from "./route";
import { auth } from "@/auth";

vi.mock("@/auth", () => ({
  auth: vi.fn().mockResolvedValue({ user: { email: "org-admin@example.com", roles: ["OrgAdmin"] } }),
}));

// syncAssignedUsers hits Entra directly - not something to actually invoke in
// a unit test. Only the role gate is under test here.
vi.mock("@/lib/entra/sync", () => ({
  syncAssignedUsers: vi.fn().mockResolvedValue({ total: 0, created: 0, updated: 0, deactivated: 0 }),
}));

describe("POST /api/admin/entra-sync", () => {
  it("rejects a Department Admin with 403", async () => {
    vi.mocked(auth).mockResolvedValueOnce({
      user: { email: "dept-admin@example.com", roles: ["DepartmentAdmin"] },
    } as never);
    const response = await POST();
    expect(response.status).toBe(403);
  });

  it("allows an Org Admin to trigger a resync", async () => {
    const response = await POST();
    expect(response.status).toBe(200);
  });
});
