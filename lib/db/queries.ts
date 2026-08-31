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
