import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "./client";
import { courses, modules, moduleVersions, scormModuleVersions, videoModuleVersions } from "./schema";

export async function createDraftCourse(): Promise<{ id: string }> {
  const [course] = await db
    .insert(courses)
    .values({ code: `DRAFT-${randomUUID().slice(0, 8)}`, title: "Untitled Course" })
    .returning();
  return { id: course.id };
}

export interface CourseDetailsUpdate {
  title?: string;
  code?: string;
  department?: string | null;
  compliance?: boolean;
  dueDate?: string | null;
  thumbnail?: string | null;
}

export async function updateCourseDetails(
  courseId: string,
  fields: CourseDetailsUpdate
): Promise<void> {
  const update: Record<string, unknown> = {};
  if (fields.title !== undefined) update.title = fields.title;
  if (fields.code !== undefined) update.code = fields.code;
  if (fields.department !== undefined) update.department = fields.department;
  if (fields.compliance !== undefined) update.compliance = fields.compliance;
  if (fields.dueDate !== undefined) {
    update.dueDate = fields.dueDate ? new Date(fields.dueDate) : null;
  }
  if (fields.thumbnail !== undefined) update.thumbnail = fields.thumbnail;
  if (Object.keys(update).length === 0) return;
  await db.update(courses).set(update).where(eq(courses.id, courseId));
}

export async function publishCourse(
  courseId: string
): Promise<{ ok: true } | { error: string }> {
  const courseModules = await db.select().from(modules).where(eq(modules.courseId, courseId));
  if (courseModules.length === 0) {
    return { error: "Add at least one module before publishing" };
  }
  await db.update(courses).set({ status: "published" }).where(eq(courses.id, courseId));
  return { ok: true };
}

export async function addVideoPlaceholderModule(
  courseId: string,
  title: string,
  durationMinutes: number | null
): Promise<{ moduleVersionId: string }> {
  const [courseModule] = await db
    .insert(modules)
    .values({ courseId, moduleType: "video", title })
    .returning();
  const [version] = await db
    .insert(moduleVersions)
    .values({ moduleId: courseModule.id, versionNumber: 1, status: "published", publishedAt: new Date() })
    .returning();
  await db.insert(videoModuleVersions).values({ moduleVersionId: version.id, durationMinutes });
  await db.update(modules).set({ currentVersionId: version.id }).where(eq(modules.id, courseModule.id));
  return { moduleVersionId: version.id };
}

export async function removeModule(courseId: string, moduleId: string): Promise<void> {
  const [courseModule] = await db
    .select()
    .from(modules)
    .where(and(eq(modules.id, moduleId), eq(modules.courseId, courseId)));
  if (!courseModule) return;

  await db.update(modules).set({ currentVersionId: null }).where(eq(modules.id, courseModule.id));

  const versions = await db
    .select()
    .from(moduleVersions)
    .where(eq(moduleVersions.moduleId, courseModule.id));
  const versionIds = versions.map((v) => v.id);
  if (versionIds.length) {
    await db.delete(scormModuleVersions).where(inArray(scormModuleVersions.moduleVersionId, versionIds));
    await db.delete(videoModuleVersions).where(inArray(videoModuleVersions.moduleVersionId, versionIds));
    await db.delete(moduleVersions).where(inArray(moduleVersions.id, versionIds));
  }

  await db.delete(modules).where(eq(modules.id, courseModule.id));
}

export async function reorderModules(courseId: string, orderedModuleIds: string[]): Promise<void> {
  await db.transaction(async (tx) => {
    for (let i = 0; i < orderedModuleIds.length; i++) {
      await tx
        .update(modules)
        .set({ sortOrder: i })
        .where(and(eq(modules.id, orderedModuleIds[i]), eq(modules.courseId, courseId)));
    }
  });
}
