import { describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "./client";

describe("db client", () => {
  it("connects to the database and runs a query", async () => {
    const result = await db.execute(sql`select 1 as value`);
    expect(Number(result.rows[0].value)).toBe(1);
  });
});
