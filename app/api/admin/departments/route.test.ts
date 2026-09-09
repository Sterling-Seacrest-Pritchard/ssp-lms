import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { POST } from "./route";
import { db } from "@/lib/db/client";
import { departments } from "@/lib/db/schema";

describe("POST /api/admin/departments", () => {
  it("creates a department and returns it", async () => {
    const name = `Dept-${randomUUID()}`;
    const request = new NextRequest("http://localhost/api/admin/departments", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    const response = await POST(request);
    const body = await response.json();
    try {
      expect(response.status).toBe(201);
      expect(body.name).toBe(name);
      const [row] = await db.select().from(departments).where(eq(departments.id, body.id));
      expect(row).toBeDefined();
    } finally {
      await db.delete(departments).where(eq(departments.id, body.id));
    }
  });

  it("returns 400 for a blank name", async () => {
    const request = new NextRequest("http://localhost/api/admin/departments", {
      method: "POST",
      body: JSON.stringify({ name: "  " }),
    });
    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  it("returns 400 for a duplicate name", async () => {
    const name = `Dept-${randomUUID()}`;
    const first = await POST(
      new NextRequest("http://localhost/api/admin/departments", {
        method: "POST",
        body: JSON.stringify({ name }),
      })
    );
    const firstBody = await first.json();
    try {
      const second = await POST(
        new NextRequest("http://localhost/api/admin/departments", {
          method: "POST",
          body: JSON.stringify({ name }),
        })
      );
      expect(second.status).toBe(400);
    } finally {
      await db.delete(departments).where(eq(departments.id, firstBody.id));
    }
  });
});
