const { Client } = require("pg");

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query(`
      SELECT DISTINCT ma.user_id AS email
      FROM module_attempts ma
      LEFT JOIN users u ON u.email = ma.user_id
      WHERE u.id IS NULL
    `);
    if (rows.length === 0) {
      console.log("Every module_attempts.user_id value matches exactly one users.email. Safe to proceed.");
    } else {
      console.log(`${rows.length} module_attempts.user_id value(s) do NOT match any users.email:`);
      for (const row of rows) console.log(` - ${row.email}`);
      console.log("Resolve these case-by-case (backfill a users row, correct the email, or plan to null the FK) before writing the real migration.");
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
