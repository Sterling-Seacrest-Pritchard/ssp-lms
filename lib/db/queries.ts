import { eq, sql } from "drizzle-orm";
import { db } from "./client";
import { courses, modules } from "./schema";

export interface RealCourseSummary {
  id: string;
  code: string;
  title: string;
  moduleCount: number;
}

export async function listRealCourses(): Promise<RealCourseSummary[]> {
  return db
    .select({
      id: courses.id,
      code: courses.code,
      title: courses.title,
      moduleCount: sql<number>`count(${modules.id})::int`,
    })
    .from(courses)
    .leftJoin(modules, eq(modules.courseId, courses.id))
    .groupBy(courses.id, courses.code, courses.title)
    .orderBy(courses.createdAt);
}

export interface RealCourseDetail {
  id: string;
  title: string;
  modules: {
    id: string;
    title: string;
    moduleVersionId: string;
  }[];
}

export async function getRealCourseDetail(courseId: string): Promise<RealCourseDetail | null> {
  const [course] = await db.select().from(courses).where(eq(courses.id, courseId));
  if (!course) return null;

  const courseModules = await db.select().from(modules).where(eq(modules.courseId, course.id));

  return {
    id: course.id,
    title: course.title,
    modules: courseModules
      .filter((m) => m.currentVersionId !== null)
      .map((m) => ({ id: m.id, title: m.title, moduleVersionId: m.currentVersionId as string })),
  };
}
