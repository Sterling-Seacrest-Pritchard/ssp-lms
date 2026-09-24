import { describe, it, expect, vi } from "vitest";
import { GET } from "./route";
import { auth } from "@/auth";

vi.mock("@/auth", () => ({
  auth: vi.fn().mockResolvedValue({ user: { email: "org-admin@example.com", roles: ["OrgAdmin"] } }),
}));

describe("GET /api/admin/users", () => {
  it("allows an Org Admin", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(Array.isArray(body.users)).toBe(true);
  });

  it("rejects a Department Admin with 403", async () => {
    vi.mocked(auth).mockResolvedValueOnce({
      user: { email: "dept-admin@example.com", roles: ["DepartmentAdmin"] },
    } as never);
    const response = await GET();
    expect(response.status).toBe(403);
  });
});
