import { describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { DELETE } from "./route";
import { db } from "@/lib/db/client";
import { courses, courseAssignments, users } from "@/lib/db/schema";
import { auth } from "@/auth";

vi.mock("@/auth", () => ({
  auth: vi.fn().mockResolvedValue({ user: { email: "org-admin@example.com", roles: ["OrgAdmin"] } }),
}));

describe("DELETE /api/admin/users/[userId]/assignments/[courseId]", () => {
  it("allows an Org Admin to remove any employee's assignment", async () => {
    const [user] = await db
      .insert(users)
      .values({ email: `unassign-${randomUUID()}@example.com`, displayName: "Test" })
      .returning();
    const [course] = await db.insert(courses).values({ code: `UNASSIGN-${randomUUID()}`, title: "x" }).returning();
    await db.insert(courseAssignments).values({ userId: user.id, courseId: course.id });
    try {
      const response = await DELETE(new NextRequest("http://localhost/x", { method: "DELETE" }), {
        params: Promise.resolve({ userId: user.id, courseId: course.id }),
      });
      expect(response.status).toBe(200);
      expect(await db.select().from(courseAssignments).where(eq(courseAssignments.userId, user.id))).toHaveLength(0);
    } finally {
      await db.delete(courseAssignments).where(eq(courseAssignments.userId, user.id));
      await db.delete(users).where(eq(users.id, user.id));
      await db.delete(courses).where(eq(courses.id, course.id));
    }
  });

  it("rejects a Department Admin with 403, leaving the assignment intact", async () => {
    const [user] = await db
      .insert(users)
      .values({ email: `unassign-403-${randomUUID()}@example.com`, displayName: "Test" })
      .returning();
    const [course] = await db.insert(courses).values({ code: `UNASSIGN-403-${randomUUID()}`, title: "x" }).returning();
    await db.insert(courseAssignments).values({ userId: user.id, courseId: course.id });
    vi.mocked(auth).mockResolvedValueOnce({
      user: { email: "dept-admin@example.com", roles: ["DepartmentAdmin"] },
    } as never);
    try {
      const response = await DELETE(new NextRequest("http://localhost/x", { method: "DELETE" }), {
        params: Promise.resolve({ userId: user.id, courseId: course.id }),
      });
      expect(response.status).toBe(403);
      expect(await db.select().from(courseAssignments).where(eq(courseAssignments.userId, user.id))).toHaveLength(1);
    } finally {
      await db.delete(courseAssignments).where(eq(courseAssignments.userId, user.id));
      await db.delete(users).where(eq(users.id, user.id));
      await db.delete(courses).where(eq(courses.id, course.id));
    }
  });
});
