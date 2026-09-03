import Mux from "@mux/mux-node";

let client: Mux | null = null;

/**
 * Lazily-constructed singleton, matching this codebase's existing
 * `pg.Pool`-at-module-scope pattern (see lib/db/client.ts) - avoids
 * re-reading env vars and re-constructing the SDK client on every call.
 */
export function getMuxClient(): Mux {
  if (!client) {
    client = new Mux({
      tokenId: process.env.MUX_TOKEN_ID,
      tokenSecret: process.env.MUX_TOKEN_SECRET,
      // The SDK's own env-var auto-read only recognizes `MUX_SIGNING_KEY` /
      // `MUX_PRIVATE_KEY` (see node_modules/@mux/mux-node/src/client.ts) -
      // this app's `.env.local` uses the more explicit
      // `MUX_SIGNING_KEY_ID` / `MUX_SIGNING_KEY_PRIVATE_KEY` names, so they
      // must be passed through here rather than left for the SDK to guess.
      jwtSigningKey: process.env.MUX_SIGNING_KEY_ID,
      jwtPrivateKey: process.env.MUX_SIGNING_KEY_PRIVATE_KEY,
    });
  }
  return client;
}

/**
 * Free-tier hard cap (Global Constraints). Confirmed against Mux's own
 * pricing page during design: the free tier is capped at 10 stored videos,
 * not a rolling/monthly count - this must be checked before every new
 * asset creation, not just at signup.
 */
export const FREE_TIER_ASSET_LIMIT = 10;

export async function countMuxAssets(): Promise<number> {
  const mux = getMuxClient();
  let count = 0;
  const page = mux.video.assets.list({ limit: 100 });
  for await (const _asset of page) {
    count += 1;
  }
  return count;
}

/**
 * A 2-hour expiration comfortably covers one viewing session without needing
 * a token-refresh mechanism in the player. `signPlaybackId` is async against
 * the installed SDK's types (it returns `Promise<string>` for a single
 * `type`), so this helper is async too.
 */
export async function signPlaybackToken(muxPlaybackId: string): Promise<string> {
  const mux = getMuxClient();
  return mux.jwt.signPlaybackId(muxPlaybackId, { expiration: "2h", type: "video" });
}
