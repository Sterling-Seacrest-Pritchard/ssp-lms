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

  it("resolves each assigned User principal's email and role, skipping non-User principals", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/oauth2/v2.0/token")) {
        return new Response(JSON.stringify({ access_token: "fake-token", expires_in: 3600 }), { status: 200 });
      }
      if (url.includes("$select=appRoles")) {
        return new Response(
          JSON.stringify({ appRoles: [{ id: "role-admin", displayName: "Org Admin", value: "OrgAdmin" }] }),
          { status: 200 }
        );
      }
      if (url.includes("/appRoleAssignedTo")) {
        return new Response(
          JSON.stringify({
            value: [
              { principalId: "user-1", principalDisplayName: "User One", principalType: "User", appRoleId: "role-admin" },
              { principalId: "group-1", principalDisplayName: "Some Group", principalType: "Group", appRoleId: "role-admin" },
            ],
          }),
          { status: 200 }
        );
      }
      if (url.includes("/groups/group-1/transitiveMembers")) {
        return new Response(JSON.stringify({ value: [] }), { status: 200 });
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

    expect(result).toEqual([
      { entraObjectId: "user-1", displayName: "User One", email: "user.one@example.com", entraRole: "Org Admin" },
    ]);
  });

  it("expands a Group assignment to its member users, applying the group's role to each", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/oauth2/v2.0/token")) {
        return new Response(JSON.stringify({ access_token: "fake-token", expires_in: 3600 }), { status: 200 });
      }
      if (url.includes("$select=appRoles")) {
        return new Response(
          JSON.stringify({ appRoles: [{ id: "role-learner", displayName: "Learner", value: "Learner" }] }),
          { status: 200 }
        );
      }
      if (url.includes("/appRoleAssignedTo")) {
        return new Response(
          JSON.stringify({
            value: [
              { principalId: "all-users-group", principalDisplayName: "All Users", principalType: "Group", appRoleId: "role-learner" },
            ],
          }),
          { status: 200 }
        );
      }
      if (url.includes("/groups/all-users-group/transitiveMembers")) {
        return new Response(
          JSON.stringify({
            value: [
              { id: "user-4", displayName: "User Four" },
              { id: "user-5", displayName: "User Five" },
            ],
          }),
          { status: 200 }
        );
      }
      if (url.includes("/users/user-4")) {
        return new Response(
          JSON.stringify({ mail: "user.four@example.com", userPrincipalName: "user4@example.com", displayName: "User Four" }),
          { status: 200 }
        );
      }
      if (url.includes("/users/user-5")) {
        return new Response(
          JSON.stringify({ mail: "user.five@example.com", userPrincipalName: "user5@example.com", displayName: "User Five" }),
          { status: 200 }
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await listAssignedUsers();

    expect(result).toEqual(
      expect.arrayContaining([
        { entraObjectId: "user-4", displayName: "User Four", email: "user.four@example.com", entraRole: "Learner" },
        { entraObjectId: "user-5", displayName: "User Five", email: "user.five@example.com", entraRole: "Learner" },
      ])
    );
    expect(result).toHaveLength(2);
  });

  it("collapses multiple assignments for the same person into their single highest-privilege role", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/oauth2/v2.0/token")) {
        return new Response(JSON.stringify({ access_token: "fake-token", expires_in: 3600 }), { status: 200 });
      }
      if (url.includes("$select=appRoles")) {
        return new Response(
          JSON.stringify({
            appRoles: [
              { id: "role-learner", displayName: "Learner", value: "Learner" },
              { id: "role-admin", displayName: "Org Admin", value: "OrgAdmin" },
            ],
          }),
          { status: 200 }
        );
      }
      if (url.includes("/appRoleAssignedTo")) {
        // Same person assigned Learner (via an all-employees group) AND Org
        // Admin (individually) - two separate assignment entries.
        return new Response(
          JSON.stringify({
            value: [
              { principalId: "user-3", principalDisplayName: "User Three", principalType: "User", appRoleId: "role-learner" },
              { principalId: "user-3", principalDisplayName: "User Three", principalType: "User", appRoleId: "role-admin" },
            ],
          }),
          { status: 200 }
        );
      }
      if (url.includes("/users/user-3")) {
        return new Response(
          JSON.stringify({ mail: "user.three@example.com", userPrincipalName: "user3@example.com", displayName: "User Three" }),
          { status: 200 }
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await listAssignedUsers();

    expect(result).toEqual([
      { entraObjectId: "user-3", displayName: "User Three", email: "user.three@example.com", entraRole: "Org Admin" },
    ]);
    // Deduped to one person before email resolution - only one /users call
    // for the two assignment entries, not two. (Not asserting total call
    // count: getGraphAppToken caches its token at module scope, so whether
    // the token endpoint is hit here depends on test execution order.)
    const userLookupCalls = fetchMock.mock.calls.filter(([url]) => (url as string).includes("/users/user-3"));
    expect(userLookupCalls).toHaveLength(1);
  });

  it("falls back to userPrincipalName when mail is null, and to null role for the default-access app role id", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/oauth2/v2.0/token")) {
        return new Response(JSON.stringify({ access_token: "fake-token", expires_in: 3600 }), { status: 200 });
      }
      if (url.includes("$select=appRoles")) {
        return new Response(JSON.stringify({ appRoles: [] }), { status: 200 });
      }
      if (url.includes("/appRoleAssignedTo")) {
        return new Response(
          JSON.stringify({
            value: [
              {
                principalId: "user-2",
                principalDisplayName: "User Two",
                principalType: "User",
                appRoleId: "00000000-0000-0000-0000-000000000000",
              },
            ],
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
    expect(result[0].entraRole).toBeNull();
  });
});
