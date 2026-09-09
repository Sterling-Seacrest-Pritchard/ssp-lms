import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { PATCH } from "./route";
import { createDraftCourse } from "@/lib/db/course-authoring";
import { db } from "@/lib/db/client";
import { courses, departments } from "@/lib/db/schema";

describe("PATCH /api/admin/courses/[courseId]", () => {
  it("updates the given fields", async () => {
    const { id } = await createDraftCourse();
    try {
      const [dept] = await db.select().from(departments).where(eq(departments.name, "HR"));
      const request = new NextRequest(`http://localhost/api/admin/courses/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ title: "Renamed", departmentId: dept.id, compliance: true }),
      });
      const response = await PATCH(request, { params: Promise.resolve({ courseId: id }) });
      expect(response.status).toBe(200);

      const [course] = await db.select().from(courses).where(eq(courses.id, id));
      expect(course.title).toBe("Renamed");
      expect(course.departmentId).toBe(dept.id);
      expect(course.compliance).toBe(true);
    } finally {
      await db.delete(courses).where(eq(courses.id, id));
    }
  });

  it("returns 400 for a non-UUID courseId", async () => {
    const request = new NextRequest("http://localhost/api/admin/courses/not-a-uuid", {
      method: "PATCH",
      body: JSON.stringify({ title: "X" }),
    });
    const response = await PATCH(request, { params: Promise.resolve({ courseId: "not-a-uuid" }) });
    expect(response.status).toBe(400);
  });
});
