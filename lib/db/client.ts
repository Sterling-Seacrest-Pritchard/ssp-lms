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

export const db = drizzle(pool);
