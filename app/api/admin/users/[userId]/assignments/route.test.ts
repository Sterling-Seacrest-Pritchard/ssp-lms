import { describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { GET, POST } from "./route";
import { db } from "@/lib/db/client";
import { courses, courseAssignments, enrollments, users } from "@/lib/db/schema";
import { auth } from "@/auth";

vi.mock("@/auth", () => ({
  auth: vi.fn().mockResolvedValue({ user: { email: "org-admin@example.com", roles: ["OrgAdmin"] } }),
}));

describe("GET /api/admin/users/[userId]/assignments", () => {
  it("allows an Org Admin", async () => {
    const [user] = await db
      .insert(users)
      .values({ email: `assignments-get-${randomUUID()}@example.com`, displayName: "Test" })
      .returning();
    try {
      const response = await GET(new NextRequest("http://localhost/x"), { params: Promise.resolve({ userId: user.id }) });
      expect(response.status).toBe(200);
    } finally {
      await db.delete(users).where(eq(users.id, user.id));
    }
  });

  it("rejects a Department Admin with 403", async () => {
    const [user] = await db
      .insert(users)
      .values({ email: `assignments-get-403-${randomUUID()}@example.com`, displayName: "Test" })
      .returning();
    vi.mocked(auth).mockResolvedValueOnce({
      user: { email: "dept-admin@example.com", roles: ["DepartmentAdmin"] },
    } as never);
    try {
      const response = await GET(new NextRequest("http://localhost/x"), { params: Promise.resolve({ userId: user.id }) });
      expect(response.status).toBe(403);
    } finally {
      await db.delete(users).where(eq(users.id, user.id));
    }
  });
});

describe("POST /api/admin/users/[userId]/assignments", () => {
  it("allows an Org Admin to assign a course to any employee", async () => {
    const [user] = await db
      .insert(users)
      .values({ email: `assignments-post-${randomUUID()}@example.com`, displayName: "Test" })
      .returning();
    const [course] = await db.insert(courses).values({ code: `ASSIGN-${randomUUID()}`, title: "x" }).returning();
    try {
      const request = new NextRequest("http://localhost/x", { method: "POST", body: JSON.stringify({ courseId: course.id }) });
      const response = await POST(request, { params: Promise.resolve({ userId: user.id }) });
      expect(response.status).toBe(200);
      expect(await db.select().from(courseAssignments).where(eq(courseAssignments.userId, user.id))).toHaveLength(1);
    } finally {
      await db.delete(enrollments).where(eq(enrollments.userId, user.id));
      await db.delete(courseAssignments).where(eq(courseAssignments.userId, user.id));
      await db.delete(users).where(eq(users.id, user.id));
      await db.delete(courses).where(eq(courses.id, course.id));
    }
  });

  it("rejects a Department Admin with 403, creating no assignment - this route is org-wide, not department-scoped", async () => {
    const [user] = await db
      .insert(users)
      .values({ email: `assignments-post-403-${randomUUID()}@example.com`, displayName: "Test" })
      .returning();
    const [course] = await db.insert(courses).values({ code: `ASSIGN-403-${randomUUID()}`, title: "x" }).returning();
    vi.mocked(auth).mockResolvedValueOnce({
      user: { email: "dept-admin@example.com", roles: ["DepartmentAdmin"] },
    } as never);
    try {
      const request = new NextRequest("http://localhost/x", { method: "POST", body: JSON.stringify({ courseId: course.id }) });
      const response = await POST(request, { params: Promise.resolve({ userId: user.id }) });
      expect(response.status).toBe(403);
      expect(await db.select().from(courseAssignments).where(eq(courseAssignments.userId, user.id))).toHaveLength(0);
    } finally {
      await db.delete(users).where(eq(users.id, user.id));
      await db.delete(courses).where(eq(courses.id, course.id));
    }
  });
});
