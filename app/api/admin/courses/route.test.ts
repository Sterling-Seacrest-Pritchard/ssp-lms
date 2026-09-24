import { describe, it, expect, vi, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { POST } from "./route";
import { db } from "@/lib/db/client";
import { courses, departments, users, departmentAdmins } from "@/lib/db/schema";
import { auth } from "@/auth";

const { DEPT_ADMIN_EMAIL } = vi.hoisted(() => ({
  DEPT_ADMIN_EMAIL: `dept-admin-course-create-${require("node:crypto").randomUUID()}@example.com`,
}));
vi.mock("@/auth", () => ({
  auth: vi.fn().mockResolvedValue({ user: { email: "org-admin@example.com", roles: ["OrgAdmin"] } }),
}));

describe("POST /api/admin/courses", () => {
  let createdId: string | undefined;

  afterAll(async () => {
    if (createdId) await db.delete(courses).where(eq(courses.id, createdId));
  });

  it("creates a draft course with the given title and returns its id", async () => {
    const request = new NextRequest("http://localhost/api/admin/courses", {
      method: "POST",
      body: JSON.stringify({ title: "My New Course" }),
    });
    const response = await POST(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.courseId).toBeTruthy();
    createdId = body.courseId;

    const [course] = await db.select().from(courses).where(eq(courses.id, body.courseId));
    expect(course.status).toBe("draft");
    expect(course.title).toBe("My New Course");
  });

  it("rejects a missing or blank title with 400, creating no row", async () => {
    const missing = await POST(new NextRequest("http://localhost/api/admin/courses", { method: "POST", body: "{}" }));
    expect(missing.status).toBe(400);

    const blank = await POST(
      new NextRequest("http://localhost/api/admin/courses", { method: "POST", body: JSON.stringify({ title: "   " }) })
    );
    expect(blank.status).toBe(400);
  });

  it("auto-scopes a new course to the caller's single administered department", async () => {
    vi.mocked(auth).mockResolvedValueOnce({
      user: { email: DEPT_ADMIN_EMAIL, roles: ["DepartmentAdmin"] },
    } as never);
    const [dept] = await db.insert(departments).values({ name: `Dept-${randomUUID()}` }).returning();
    const [user] = await db
      .insert(users)
      .values({ email: DEPT_ADMIN_EMAIL, displayName: "Dept Admin", entraRole: "Department Admin" })
      .returning();
    await db.insert(departmentAdmins).values({ userId: user.id, departmentId: dept.id });

    try {
      const request = new NextRequest("http://localhost/api/admin/courses", {
        method: "POST",
        body: JSON.stringify({ title: "New Scoped Course" }),
      });
      const response = await POST(request);
      const body = await response.json();
      const [course] = await db.select().from(courses).where(eq(courses.id, body.courseId));
      expect(course.departmentId).toBe(dept.id);
    } finally {
      await db.delete(courses).where(eq(courses.departmentId, dept.id));
      await db.delete(departmentAdmins).where(eq(departmentAdmins.userId, user.id));
      await db.delete(users).where(eq(users.id, user.id));
      await db.delete(departments).where(eq(departments.id, dept.id));
    }
  });

  it("rejects course creation for a Department Admin who administers no department yet", async () => {
    vi.mocked(auth).mockResolvedValueOnce({
      user: { email: DEPT_ADMIN_EMAIL, roles: ["DepartmentAdmin"] },
    } as never);
    const [user] = await db
      .insert(users)
      .values({ email: DEPT_ADMIN_EMAIL, displayName: "Dept Admin", entraRole: "Department Admin" })
      .returning();
    try {
      const request = new NextRequest("http://localhost/api/admin/courses", {
        method: "POST",
        body: JSON.stringify({ title: "Should Not Be Created" }),
      });
      const response = await POST(request);
      expect(response.status).toBe(400);
    } finally {
      await db.delete(users).where(eq(users.id, user.id));
    }
  });
});
