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
