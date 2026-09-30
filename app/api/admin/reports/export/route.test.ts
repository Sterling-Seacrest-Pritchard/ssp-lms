import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { GET } from "./route";
import { db } from "@/lib/db/client";
import { departments, users, courses, enrollments, departmentAdmins } from "@/lib/db/schema";
import { assignDepartmentAdmin } from "@/lib/db/department-admins";
import { auth } from "@/auth";

vi.mock("@/auth", () => ({
  auth: vi.fn().mockResolvedValue({ user: { email: "org-admin@example.com", roles: ["OrgAdmin"] } }),
}));

describe("GET /api/admin/reports/export", () => {
  it("returns 403 when a Department Admin omits dept", async () => {
    const [admin] = await db.insert(users).values({ email: `${randomUUID()}@example.com`, displayName: "Admin" }).returning();
    vi.mocked(auth).mockResolvedValueOnce({ user: { email: admin.email, roles: ["DepartmentAdmin"] } } as never);
    try {
      const response = await GET(new NextRequest("http://localhost/api/admin/reports/export"));
      expect(response.status).toBe(403);
    } finally {
      await db.delete(users).where(eq(users.id, admin.id));
    }
  });

  it("returns 403 when a Department Admin requests a dept they don't administer", async () => {
    const [dept] = await db.insert(departments).values({ name: `Dept-${randomUUID()}` }).returning();
    const [otherDept] = await db.insert(departments).values({ name: `Dept-${randomUUID()}` }).returning();
    const [admin] = await db.insert(users).values({ email: `${randomUUID()}@example.com`, displayName: "Admin" }).returning();
    await assignDepartmentAdmin(admin.id, dept.id, null);
    vi.mocked(auth).mockResolvedValueOnce({ user: { email: admin.email, roles: ["DepartmentAdmin"] } } as never);
    try {
      const response = await GET(new NextRequest(`http://localhost/api/admin/reports/export?dept=${otherDept.id}`));
      expect(response.status).toBe(403);
    } finally {
      await db.delete(departmentAdmins).where(eq(departmentAdmins.userId, admin.id));
      await db.delete(users).where(eq(users.id, admin.id));
      await db.delete(departments).where(eq(departments.id, dept.id));
      await db.delete(departments).where(eq(departments.id, otherDept.id));
    }
  });

  it("returns 400 for a dept that isn't a real department", async () => {
    const response = await GET(new NextRequest(`http://localhost/api/admin/reports/export?dept=${randomUUID()}`));
    expect(response.status).toBe(400);
  });

  it("returns a CSV with a UUID-based filename, never the department's raw name", async () => {
    const [dept] = await db.insert(departments).values({ name: `Dept, "quoted"! ${randomUUID()}` }).returning();
    const [admin] = await db.insert(users).values({ email: `${randomUUID()}@example.com`, displayName: "Admin" }).returning();
    await assignDepartmentAdmin(admin.id, dept.id, null);
    vi.mocked(auth).mockResolvedValueOnce({ user: { email: admin.email, roles: ["DepartmentAdmin"] } } as never);
    try {
      const response = await GET(new NextRequest(`http://localhost/api/admin/reports/export?dept=${dept.id}`));
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/csv");
      const disposition = response.headers.get("content-disposition") ?? "";
      expect(disposition).toContain(`progress-${dept.id}.csv`);
      expect(disposition).not.toContain("quoted");
    } finally {
      await db.delete(departmentAdmins).where(eq(departmentAdmins.userId, admin.id));
      await db.delete(users).where(eq(users.id, admin.id));
      await db.delete(departments).where(eq(departments.id, dept.id));
    }
  });

  it("returns a header row plus one row per (user, course) for an Org Admin's company-wide export", async () => {
    const [course] = await db.insert(courses).values({ code: `MP-${randomUUID()}`, title: "x" }).returning();
    const [user] = await db.insert(users).values({ email: `${randomUUID()}@example.com`, displayName: "x" }).returning();
    try {
      await db.insert(enrollments).values({ userId: user.id, courseId: course.id, status: "not_started" });
      const response = await GET(new NextRequest("http://localhost/api/admin/reports/export"));
      expect(response.status).toBe(200);
      const text = await response.text();
      const lines = text.trim().split("\n");
      expect(lines[0]).toBe("Name,Email,Course,Status,Due,Completed,Overdue,Compliance");
      expect(lines.some((l) => l.includes(user.email))).toBe(true);
    } finally {
      await db.delete(enrollments).where(eq(enrollments.userId, user.id));
      await db.delete(users).where(eq(users.id, user.id));
      await db.delete(courses).where(eq(courses.id, course.id));
    }
  });
});
