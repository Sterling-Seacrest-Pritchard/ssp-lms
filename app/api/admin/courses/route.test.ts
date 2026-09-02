import { describe, it, expect, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { POST } from "./route";
import { db } from "@/lib/db/client";
import { courses } from "@/lib/db/schema";

describe("POST /api/admin/courses", () => {
  let createdId: string | undefined;

  afterAll(async () => {
    if (createdId) await db.delete(courses).where(eq(courses.id, createdId));
  });

  it("creates a draft course and returns its id", async () => {
    const request = new NextRequest("http://localhost/api/admin/courses", { method: "POST" });
    const response = await POST(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.courseId).toBeTruthy();
    createdId = body.courseId;

    const [course] = await db.select().from(courses).where(eq(courses.id, body.courseId));
    expect(course.status).toBe("draft");
  });
});
