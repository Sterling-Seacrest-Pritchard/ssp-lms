import { getTenantId } from "@/lib/entra/graph-client";

/**
 * Sends mail as noreply@sspins.com via Microsoft Graph, using an app-only
 * token from the Entra app registration repurposed from the (now-retired)
 * CAT Crash Form project - see GRAPH_MAIL_CLIENT_ID in .env.local for the
 * full story. That app registration already has Mail.Send application
 * permission scoped to noreply@sspins.com via an Exchange Application
 * Access Policy, so no new Entra admin consent is needed to use it here.
 *
 * Deliberately separate from lib/entra/graph-client.ts's token cache: that
 * one authenticates as the SSP LMS app registration (Application.Read.All /
 * User.Read.All, for Entra sync); this one authenticates as a different app
 * registration entirely, scoped only to sending mail as one mailbox.
 */

interface MailAppToken {
  accessToken: string;
  expiresAt: number; // epoch ms
}

let cachedToken: MailAppToken | null = null;

async function getMailGraphToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt - 60_000 > Date.now()) {
    return cachedToken.accessToken;
  }

  const tenantId = getTenantId();
  const clientId = process.env.GRAPH_MAIL_CLIENT_ID;
  const clientSecret = process.env.GRAPH_MAIL_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("GRAPH_MAIL_CLIENT_ID and GRAPH_MAIL_CLIENT_SECRET are required");
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
    throw new Error(`Graph mail token request failed: ${response.status} ${await response.text()}`);
  }
  const body = (await response.json()) as { access_token: string; expires_in: number };
  cachedToken = { accessToken: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
  return cachedToken.accessToken;
}

export interface SendMailInput {
  to: string[];
  subject: string;
  html: string;
}

/**
 * Throws on failure rather than swallowing it - callers decide whether a
 * failed notification should affect the action that triggered it. For the
 * automated notifications in lib/mail/notifications.ts, callers wrap this in
 * try/catch and log, since a failed email must never undo or block a course
 * assignment that already committed.
 *
 * saveToSentItems is off: this is a high-volume automated mailbox, not one
 * anyone reads, so there's no reason to let Sent Items grow unbounded.
 */
export async function sendMail({ to, subject, html }: SendMailInput): Promise<void> {
  if (to.length === 0) return;

  const fromEmail = process.env.GRAPH_MAIL_FROM_EMAIL;
  if (!fromEmail) {
    throw new Error("GRAPH_MAIL_FROM_EMAIL is required");
  }

  const token = await getMailGraphToken();
  const response = await fetch(`https://graph.microsoft.com/v1.0/users/${fromEmail}/sendMail`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: {
        subject,
        body: { contentType: "HTML", content: html },
        toRecipients: to.map((address) => ({ emailAddress: { address } })),
      },
      saveToSentItems: false,
    }),
  });

  if (!response.ok) {
    throw new Error(`Graph sendMail failed: ${response.status} ${await response.text()}`);
  }
}
