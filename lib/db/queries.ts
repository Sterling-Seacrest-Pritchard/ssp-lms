import { eq, sql } from "drizzle-orm";
import { db } from "./client";
import { courses, modules } from "./schema";
import { isUuid } from "@/lib/api/errors";

export interface RealCourseSummary {
  id: string;
  code: string;
  title: string;
  moduleCount: number;
  department: string | null;
  thumbnail: string | null;
  compliance: boolean;
  dueDate: string | null;
}

const courseSummaryColumns = {
  id: courses.id,
  code: courses.code,
  title: courses.title,
  department: courses.department,
  thumbnail: courses.thumbnail,
  compliance: courses.compliance,
  dueDate: courses.dueDate,
  moduleCount: sql<number>`count(${modules.id}) filter (where ${modules.currentVersionId} is not null)::int`,
};

function toSummary(row: {
  id: string;
  code: string;
  title: string;
  department: string | null;
  thumbnail: string | null;
  compliance: boolean;
  dueDate: Date | null;
  moduleCount: number;
}): RealCourseSummary {
  return { ...row, dueDate: row.dueDate ? row.dueDate.toISOString() : null };
}

export async function listRealCourses(): Promise<RealCourseSummary[]> {
  const rows = await db
    .select(courseSummaryColumns)
    .from(courses)
    .leftJoin(modules, eq(modules.courseId, courses.id))
    .groupBy(
      courses.id,
      courses.code,
      courses.title,
      courses.department,
      courses.thumbnail,
      courses.compliance,
      courses.dueDate
    )
    .orderBy(courses.createdAt);
  return rows.map(toSummary);
}

export async function listPublishedCourses(): Promise<RealCourseSummary[]> {
  const rows = await db
    .select(courseSummaryColumns)
    .from(courses)
    .leftJoin(modules, eq(modules.courseId, courses.id))
    .where(eq(courses.status, "published"))
    .groupBy(
      courses.id,
      courses.code,
      courses.title,
      courses.department,
      courses.thumbnail,
      courses.compliance,
      courses.dueDate
    )
    .orderBy(courses.createdAt);
  return rows.map(toSummary);
}

export interface RealCourseDetail {
  id: string;
  title: string;
  department: string | null;
  thumbnail: string | null;
  compliance: boolean;
  dueDate: string | null;
  modules: {
    id: string;
    title: string;
    moduleVersionId: string;
  }[];
}

export async function getRealCourseDetail(courseId: string): Promise<RealCourseDetail | null> {
  if (!isUuid(courseId)) return null;

  const [course] = await db
    .select()
    .from(courses)
    .where(eq(courses.id, courseId));
  if (!course || course.status !== "published") return null;

  const courseModules = await db.select().from(modules).where(eq(modules.courseId, course.id));

  return {
    id: course.id,
    title: course.title,
    department: course.department,
    thumbnail: course.thumbnail,
    compliance: course.compliance,
    dueDate: course.dueDate ? course.dueDate.toISOString() : null,
    modules: courseModules.flatMap((m) =>
      m.currentVersionId
        ? [{ id: m.id, title: m.title, moduleVersionId: m.currentVersionId }]
        : []
    ),
  };
}

export interface BuilderModule {
  id: string;
  title: string;
  moduleType: string;
  moduleVersionId: string | null;
  sortOrder: number;
}

export interface CourseForBuilder {
  id: string;
  code: string;
  title: string;
  status: string;
  department: string | null;
  thumbnail: string | null;
  compliance: boolean;
  dueDate: string | null;
  modules: BuilderModule[];
}

export async function getCourseForBuilder(courseId: string): Promise<CourseForBuilder | null> {
  if (!isUuid(courseId)) return null;

  const [course] = await db.select().from(courses).where(eq(courses.id, courseId));
  if (!course) return null;

  const courseModules = await db
    .select()
    .from(modules)
    .where(eq(modules.courseId, course.id))
    .orderBy(modules.sortOrder);

  return {
    id: course.id,
    code: course.code,
    title: course.title,
    status: course.status,
    department: course.department,
    thumbnail: course.thumbnail,
    compliance: course.compliance,
    dueDate: course.dueDate ? course.dueDate.toISOString() : null,
    modules: courseModules.map((m) => ({
      id: m.id,
      title: m.title,
      moduleType: m.moduleType,
      moduleVersionId: m.currentVersionId,
      sortOrder: m.sortOrder,
    })),
  };
}
