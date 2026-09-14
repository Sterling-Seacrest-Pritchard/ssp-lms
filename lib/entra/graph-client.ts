/**
 * App-only (client-credentials) Microsoft Graph access, separate from the
 * user-delegated OIDC sign-in flow in auth.ts. Needs a NEW app registration
 * permission (Application.Read.All, admin-consented) and a NEW client secret
 * on the same "SSP LMS" app registration - see the approved design spec
 * ("SSP LMS — User Pre-Provisioning & Entra Sync Design") for the Azure
 * Portal setup this depends on.
 */

interface GraphAppToken {
  accessToken: string;
  expiresAt: number; // epoch ms
}

let cachedToken: GraphAppToken | null = null;

/** Extracted from the existing sign-in issuer URL rather than a duplicate env var. */
function getTenantId(): string {
  const issuer = process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER;
  const match = issuer?.match(/login\.microsoftonline\.com\/([^/]+)/);
  if (!match) {
    throw new Error("Could not extract tenant id from AUTH_MICROSOFT_ENTRA_ID_ISSUER");
  }
  return match[1];
}

async function getGraphAppToken(): Promise<string> {
  // 60s of headroom so a token doesn't expire mid-request on a slow sync.
  if (cachedToken && cachedToken.expiresAt - 60_000 > Date.now()) {
    return cachedToken.accessToken;
  }

  const tenantId = getTenantId();
  const clientId = process.env.AUTH_MICROSOFT_ENTRA_ID_ID;
  const clientSecret = process.env.ENTRA_GRAPH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("AUTH_MICROSOFT_ENTRA_ID_ID and ENTRA_GRAPH_CLIENT_SECRET are required");
  }

  const response = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: "https://graph.microsoft.com/.default",
    }),
  });
  if (!response.ok) {
    throw new Error(`Graph token request failed: ${response.status} ${await response.text()}`);
  }
  const body = (await response.json()) as { access_token: string; expires_in: number };
  cachedToken = { accessToken: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
  return cachedToken.accessToken;
}

interface AppRoleAssignment {
  principalId: string;
  principalDisplayName: string;
  principalType: string;
  appRoleId: string;
}

interface AppRoleDefinition {
  id: string;
  displayName: string | null;
  value: string | null;
}

interface GraphListResponse<T> {
  value: T[];
  "@odata.nextLink"?: string;
}

export interface AssignedUser {
  entraObjectId: string;
  displayName: string;
  email: string;
  entraRole: string | null;
}

// Graph's well-known "no specific app role" id - assigned when someone has
// access to the app but the app registration defines no distinct roles (or
// they weren't assigned one), so there's nothing meaningful to display.
const DEFAULT_ACCESS_ROLE_ID = "00000000-0000-0000-0000-000000000000";

// This app's own roles (see the "SSP LMS Platform" app registration's
// appRoles manifest), ranked by privilege. Someone can hold more than one
// role at once - e.g. Learner via an all-employees group PLUS Org Admin
// assigned individually - since group and individual app-role assignments
// coexist. Unranked/unknown role values sort below all of these.
const ROLE_PRIORITY: Record<string, number> = {
  OrgAdmin: 3,
  DepartmentAdmin: 2,
  Learner: 1,
};

/** Maps appRoleId -> {name, priority}, for turning appRoleAssignedTo's opaque ids into "Org Admin" / "Learner" etc, ranked by privilege. */
async function getAppRoles(
  servicePrincipalId: string,
  headers: Record<string, string>
): Promise<Map<string, { name: string; priority: number }>> {
  const response = await fetch(
    `https://graph.microsoft.com/v1.0/servicePrincipals/${servicePrincipalId}?$select=appRoles`,
    { headers }
  );
  if (!response.ok) {
    throw new Error(`Graph servicePrincipal appRoles request failed: ${response.status} ${await response.text()}`);
  }
  const body = (await response.json()) as { appRoles: AppRoleDefinition[] };
  return new Map(
    body.appRoles.map((role) => [
      role.id,
      { name: role.displayName || role.value || role.id, priority: ROLE_PRIORITY[role.value ?? ""] ?? 0 },
    ])
  );
}

/**
 * Everyone assigned to the Enterprise App, resolved to real user records.
 *
 * appRoleAssignedTo gives principalId/principalDisplayName/principalType but
 * NOT email - a second Graph call per person resolves it (mail, falling back
 * to userPrincipalName for accounts with no mail attribute set). At current
 * org size this per-user loop is simple and fast enough; revisit with
 * Graph's $batch endpoint only if assignment counts grow large enough to
 * make it slow.
 */
export async function listAssignedUsers(): Promise<AssignedUser[]> {
  const servicePrincipalId = process.env.ENTRA_SERVICE_PRINCIPAL_ID;
  if (!servicePrincipalId) {
    throw new Error("ENTRA_SERVICE_PRINCIPAL_ID is required");
  }
  const token = await getGraphAppToken();
  const headers = { Authorization: `Bearer ${token}` };

  const assignments: AppRoleAssignment[] = [];
  let url: string | undefined =
    `https://graph.microsoft.com/v1.0/servicePrincipals/${servicePrincipalId}/appRoleAssignedTo?$top=999`;
  while (url) {
    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`Graph appRoleAssignedTo request failed: ${response.status} ${await response.text()}`);
    }
    const body = (await response.json()) as GraphListResponse<AppRoleAssignment>;
    assignments.push(...body.value);
    url = body["@odata.nextLink"];
  }

  const userAssignments = assignments.filter((a) => a.principalType === "User");
  const appRoles = await getAppRoles(servicePrincipalId, headers);

  // A person can be assigned more than once (e.g. Learner via an
  // all-employees group AND Org Admin individually) - appRoleAssignedTo
  // returns one entry per assignment, so collapse to one per principal here,
  // keeping only the highest-privilege role, before resolving email (which
  // also avoids a duplicate Graph call per extra assignment).
  const byPrincipal = new Map<string, { principalId: string; principalDisplayName: string; entraRole: string | null; priority: number }>();
  for (const assignment of userAssignments) {
    const role = assignment.appRoleId === DEFAULT_ACCESS_ROLE_ID ? undefined : appRoles.get(assignment.appRoleId);
    const entraRole = role?.name ?? null;
    const priority = role?.priority ?? 0;
    const existing = byPrincipal.get(assignment.principalId);
    if (!existing || priority > existing.priority) {
      byPrincipal.set(assignment.principalId, {
        principalId: assignment.principalId,
        principalDisplayName: assignment.principalDisplayName,
        entraRole,
        priority,
      });
    }
  }

  const resolved: AssignedUser[] = [];
  for (const assignment of byPrincipal.values()) {
    const response = await fetch(
      `https://graph.microsoft.com/v1.0/users/${assignment.principalId}?$select=mail,userPrincipalName,displayName`,
      { headers }
    );
    if (!response.ok) {
      // A principal that no longer resolves (deleted account, etc.) is
      // skipped rather than failing the whole sync - log and move on.
      console.error(
        `listAssignedUsers: could not resolve principal ${assignment.principalId}: ${response.status}`
      );
      continue;
    }
    const user = (await response.json()) as { mail: string | null; userPrincipalName: string; displayName: string };
    const email = user.mail ?? user.userPrincipalName;
    if (!email) continue;
    resolved.push({
      entraObjectId: assignment.principalId,
      displayName: user.displayName ?? assignment.principalDisplayName,
      email,
      entraRole: assignment.entraRole,
    });
  }
  return resolved;
}
