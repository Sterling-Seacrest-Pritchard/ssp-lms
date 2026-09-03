import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
});

// `pg` emits 'error' on the Pool when an IDLE backend connection dies, which
// Supabase free-tier does routinely (it drops idle connections and pauses
// inactive projects). An unhandled 'error' event on an EventEmitter takes the
// whole Node process down, so log it and let the pool replace the client.
pool.on("error", (err) => {
  console.error("Unexpected error on idle database client", err);
});

// A failed *new* connection attempt (e.g. the pooler host is unreachable, or
// DNS resolves multiple addresses and every one refuses/times out) can throw
// an AggregateError that escapes as a process-level `unhandledRejection`
// rather than rejecting the awaited query's own promise - this has been
// observed crashing the whole Next.js server process on a single DB blip,
// taking every route down, not just the one that happened to be querying.
// Every call site is still expected to catch its own query rejections (see
// UnavailableState usage across the learner/admin pages); this is a last-
// resort net so a gap in one of those catches degrades to a log line instead
// of taking the entire process down.
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection (likely a database connectivity blip)", reason);
});

export const db = drizzle(pool);
