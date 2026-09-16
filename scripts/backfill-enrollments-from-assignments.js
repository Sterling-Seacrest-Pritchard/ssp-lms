const { Client } = require("pg");

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query(`
      SELECT ca.user_id, ca.course_id, c.due_date
      FROM course_assignments ca
      JOIN courses c ON c.id = ca.course_id
      LEFT JOIN enrollments e ON e.user_id = ca.user_id AND e.course_id = ca.course_id
      WHERE e.id IS NULL
    `);

    console.log(`${rows.length} course_assignments row(s) missing a matching enrollment.`);
    if (DRY_RUN) {
      for (const row of rows) console.log(` - would create enrollment: user ${row.user_id}, course ${row.course_id}`);
      return;
    }

    await client.query("BEGIN");
    for (const row of rows) {
      await client.query(
        `INSERT INTO enrollments (user_id, course_id, status, source, due_at)
         VALUES ($1, $2, 'not_started', 'assigned', $3)
         ON CONFLICT (user_id, course_id) DO NOTHING`,
        [row.user_id, row.course_id, row.due_date]
      );
    }
    await client.query("COMMIT");
    console.log(`Created ${rows.length} enrollment(s).`);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
