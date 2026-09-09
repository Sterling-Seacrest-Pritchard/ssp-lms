import { eq, sql } from "drizzle-orm";
import { db } from "./client";
import { courses, modules, departments } from "./schema";
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
  department: departments.name,
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
    .leftJoin(departments, eq(departments.id, courses.departmentId))
    .groupBy(
      courses.id,
      courses.code,
      courses.title,
      departments.name,
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
    .leftJoin(departments, eq(departments.id, courses.departmentId))
    .where(eq(courses.status, "published"))
    .groupBy(
      courses.id,
      courses.code,
      courses.title,
      departments.name,
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
    /**
     * "scorm" | "video". The learner detail page needs this to decide whether a
     * module is launchable: only SCORM modules have a player, so linking a
     * video placeholder to `/courses/{id}/scorm/{moduleVersionId}` 404s.
     */
    moduleType: string;
    moduleVersionId: string;
  }[];
}

export async function getRealCourseDetail(courseId: string): Promise<RealCourseDetail | null> {
  if (!isUuid(courseId)) return null;

  const [row] = await db
    .select({ course: courses, departmentName: departments.name })
    .from(courses)
    .leftJoin(departments, eq(departments.id, courses.departmentId))
    .where(eq(courses.id, courseId));
  if (!row || row.course.status !== "published") return null;
  const course = row.course;

  const courseModules = await db
    .select()
    .from(modules)
    .where(eq(modules.courseId, course.id))
    .orderBy(modules.sortOrder);

  return {
    id: course.id,
    title: course.title,
    department: row.departmentName,
    thumbnail: course.thumbnail,
    compliance: course.compliance,
    dueDate: course.dueDate ? course.dueDate.toISOString() : null,
    modules: courseModules.flatMap((m) =>
      m.currentVersionId
        ? [
            {
              id: m.id,
              title: m.title,
              moduleType: m.moduleType,
              moduleVersionId: m.currentVersionId,
            },
          ]
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
  departmentId: string | null;
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
    departmentId: course.departmentId,
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
