import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const ORIGINAL_ENV = { ...process.env };

function mockTokenResponse(token = "fake-token", expiresIn = 3600) {
  return {
    ok: true,
    json: async () => ({ access_token: token, expires_in: expiresIn }),
  };
}

function mockSendMailResponse(ok = true, status = 202) {
  return { ok, status, text: async () => "" };
}

// cachedToken is module-private state in graph-mail.ts, shared across every
// test in a file unless the module is freshly re-imported - resetModules +
// a dynamic import per test keeps each test's token cache isolated.
async function freshSendMail() {
  const mod = await import("./graph-mail");
  return mod.sendMail;
}

describe("sendMail", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.GRAPH_MAIL_CLIENT_ID = "test-client-id";
    process.env.GRAPH_MAIL_CLIENT_SECRET = "test-client-secret";
    process.env.GRAPH_MAIL_FROM_EMAIL = "noreply@sspins.com";
    process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER = "https://login.microsoftonline.com/test-tenant-id/v2.0";
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.unstubAllGlobals();
  });

  it("does nothing (no network call) when there are no recipients", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const sendMail = await freshSendMail();

    await sendMail({ to: [], subject: "x", html: "<p>x</p>" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requests a client-credentials token, then calls sendMail for the from address", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockTokenResponse("token-abc"))
      .mockResolvedValueOnce(mockSendMailResponse());
    vi.stubGlobal("fetch", fetchMock);
    const sendMail = await freshSendMail();

    await sendMail({ to: ["learner@example.com"], subject: "Hello", html: "<p>Hi</p>" });

    expect(fetchMock).toHaveBeenCalledTimes(2);

    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0];
    expect(tokenUrl).toBe("https://login.microsoftonline.com/test-tenant-id/oauth2/v2.0/token");
    expect(String(tokenInit.body)).toContain("client_id=test-client-id");
    expect(String(tokenInit.body)).toContain("client_secret=test-client-secret");

    const [sendUrl, sendInit] = fetchMock.mock.calls[1];
    expect(sendUrl).toBe("https://graph.microsoft.com/v1.0/users/noreply@sspins.com/sendMail");
    expect(sendInit.headers.Authorization).toBe("Bearer token-abc");
    const body = JSON.parse(sendInit.body);
    expect(body.message.subject).toBe("Hello");
    expect(body.message.toRecipients).toEqual([{ emailAddress: { address: "learner@example.com" } }]);
    expect(body.saveToSentItems).toBe(false);
  });

  it("caches the token across calls instead of re-requesting it", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockTokenResponse("token-abc", 3600))
      .mockResolvedValueOnce(mockSendMailResponse())
      .mockResolvedValueOnce(mockSendMailResponse());
    vi.stubGlobal("fetch", fetchMock);
    const sendMail = await freshSendMail();

    await sendMail({ to: ["a@example.com"], subject: "1", html: "<p>1</p>" });
    await sendMail({ to: ["b@example.com"], subject: "2", html: "<p>2</p>" });

    // One token request total, two sendMail requests.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("throws when the token request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce({ ok: false, status: 401, text: async () => "bad creds" })
    );
    const sendMail = await freshSendMail();
    await expect(sendMail({ to: ["a@example.com"], subject: "x", html: "<p>x</p>" })).rejects.toThrow(
      /Graph mail token request failed/
    );
  });

  it("throws when the sendMail request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(mockTokenResponse())
        .mockResolvedValueOnce({ ok: false, status: 500, text: async () => "boom" })
    );
    const sendMail = await freshSendMail();
    await expect(sendMail({ to: ["a@example.com"], subject: "x", html: "<p>x</p>" })).rejects.toThrow(
      /Graph sendMail failed/
    );
  });

  it("throws a clear error when credentials are missing", async () => {
    delete process.env.GRAPH_MAIL_CLIENT_ID;
    vi.stubGlobal("fetch", vi.fn());
    const sendMail = await freshSendMail();
    await expect(sendMail({ to: ["a@example.com"], subject: "x", html: "<p>x</p>" })).rejects.toThrow(
      /GRAPH_MAIL_CLIENT_ID and GRAPH_MAIL_CLIENT_SECRET are required/
    );
  });
});
