import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { listAssignedUsers } from "./graph-client";

const ORIGINAL_ENV = { ...process.env };

describe("listAssignedUsers", () => {
  beforeEach(() => {
    process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER = "https://login.microsoftonline.com/test-tenant-id/v2.0";
    process.env.AUTH_MICROSOFT_ENTRA_ID_ID = "test-client-id";
    process.env.ENTRA_GRAPH_CLIENT_SECRET = "test-secret";
    process.env.ENTRA_SERVICE_PRINCIPAL_ID = "test-sp-id";
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.unstubAllGlobals();
  });

  it("throws a clear error when ENTRA_SERVICE_PRINCIPAL_ID is missing", async () => {
    delete process.env.ENTRA_SERVICE_PRINCIPAL_ID;
    await expect(listAssignedUsers()).rejects.toThrow("ENTRA_SERVICE_PRINCIPAL_ID is required");
  });

  it("resolves each assigned User principal's email, skipping non-User principals", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/oauth2/v2.0/token")) {
        return new Response(JSON.stringify({ access_token: "fake-token", expires_in: 3600 }), { status: 200 });
      }
      if (url.includes("/appRoleAssignedTo")) {
        return new Response(
          JSON.stringify({
            value: [
              { principalId: "user-1", principalDisplayName: "User One", principalType: "User" },
              { principalId: "group-1", principalDisplayName: "Some Group", principalType: "Group" },
            ],
          }),
          { status: 200 }
        );
      }
      if (url.includes("/users/user-1")) {
        return new Response(
          JSON.stringify({ mail: "user.one@example.com", userPrincipalName: "user1@example.com", displayName: "User One" }),
          { status: 200 }
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await listAssignedUsers();

    expect(result).toEqual([{ entraObjectId: "user-1", displayName: "User One", email: "user.one@example.com" }]);
    // Only the User principal gets a follow-up email-resolution call, not the Group one.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("falls back to userPrincipalName when mail is null", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/oauth2/v2.0/token")) {
        return new Response(JSON.stringify({ access_token: "fake-token", expires_in: 3600 }), { status: 200 });
      }
      if (url.includes("/appRoleAssignedTo")) {
        return new Response(
          JSON.stringify({
            value: [{ principalId: "user-2", principalDisplayName: "User Two", principalType: "User" }],
          }),
          { status: 200 }
        );
      }
      return new Response(
        JSON.stringify({ mail: null, userPrincipalName: "user2@example.com", displayName: "User Two" }),
        { status: 200 }
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await listAssignedUsers();
    expect(result[0].email).toBe("user2@example.com");
  });
});
