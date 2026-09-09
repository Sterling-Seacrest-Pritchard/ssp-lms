import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "./client";
import {
  courses,
  moduleAttempts,
  modules,
  moduleVersions,
  scormAttemptState,
  scormModuleVersions,
  videoAttemptState,
  videoModuleVersions,
} from "./schema";
import { isUuid } from "@/lib/api/errors";
import { deleteScormPackage } from "@/lib/scorm/extract-package";
import { getMuxClient } from "@/lib/video/mux-client";

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
  departmentId?: string | null;
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
  if (fields.departmentId !== undefined) update.departmentId = fields.departmentId;
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

export async function removeModule(courseId: string, moduleId: string): Promise<void> {
  if (!isUuid(courseId) || !isUuid(moduleId)) return;

  const [courseModule] = await db
    .select()
    .from(modules)
    .where(and(eq(modules.id, moduleId), eq(modules.courseId, courseId)));
  if (!courseModule) return;

  // Collected inside the transaction, used after it commits: the DB rows are
  // the source of truth for what a package belongs to, so the Storage objects
  // only become orphans once those rows are actually gone.
  const storagePrefixes: string[] = [];
  const muxAssetIds: string[] = [];

  await db.transaction(async (tx) => {
    await tx.update(modules).set({ currentVersionId: null }).where(eq(modules.id, courseModule.id));

    const versions = await tx
      .select()
      .from(moduleVersions)
      .where(eq(moduleVersions.moduleId, courseModule.id));
    const versionIds = versions.map((v) => v.id);
    if (versionIds.length) {
      const scormVersions = await tx
        .select()
        .from(scormModuleVersions)
        .where(inArray(scormModuleVersions.moduleVersionId, versionIds));
      storagePrefixes.push(...scormVersions.map((v) => v.gcsPrefix));

      const videoVersions = await tx
        .select()
        .from(videoModuleVersions)
        .where(inArray(videoModuleVersions.moduleVersionId, versionIds));
      muxAssetIds.push(...videoVersions.map((v) => v.muxAssetId).filter((id): id is string => id !== null));

      // Learner attempt rows FIRST: `module_attempts.module_version_id` is a
      // NOT NULL foreign key with `onDelete: no action`, so deleting a
      // module_versions row while any attempt still references it raises a FK
      // violation that aborts this whole transaction - i.e. removing a module
      // any learner has ever started would 500. Same FK order as the test
      // cleanup helpers: the per-type attempt-state tables
      // (scorm_attempt_state, video_attempt_state - both also `onDelete: no
      // action` against module_attempts) -> module_attempts. Missing either
      // state table here 500s the removal, and for a video module that
      // matters twice over: removal is the only way to free a slot against
      // the Mux free-tier asset cap.
      const attempts = await tx
        .select({ id: moduleAttempts.id })
        .from(moduleAttempts)
        .where(inArray(moduleAttempts.moduleVersionId, versionIds));
      const attemptIds = attempts.map((a) => a.id);
      if (attemptIds.length) {
        await tx
          .delete(scormAttemptState)
          .where(inArray(scormAttemptState.moduleAttemptId, attemptIds));
        await tx
          .delete(videoAttemptState)
          .where(inArray(videoAttemptState.moduleAttemptId, attemptIds));
        await tx.delete(moduleAttempts).where(inArray(moduleAttempts.id, attemptIds));
      }

      await tx.delete(scormModuleVersions).where(inArray(scormModuleVersions.moduleVersionId, versionIds));
      await tx.delete(videoModuleVersions).where(inArray(videoModuleVersions.moduleVersionId, versionIds));
      await tx.delete(moduleVersions).where(inArray(moduleVersions.id, versionIds));
    }

    await tx.delete(modules).where(eq(modules.id, courseModule.id));
  });

  // A video placeholder has no uploaded package, so `storagePrefixes` is empty
  // for one and no Storage call is made. A failed delete leaves an orphaned
  // package but must NOT fail the removal: the DB is the source of truth and
  // the module is already gone from it, so log and carry on.
  for (const prefix of storagePrefixes) {
    try {
      await deleteScormPackage(prefix);
    } catch (error) {
      console.error(
        `removeModule: failed to delete SCORM package "${prefix}" from Storage; it is now orphaned`,
        error
      );
    }
  }

  // Same "log and continue, never fail the operation" pattern as the SCORM
  // Storage cleanup above: the DB rows are already gone, so a failed Mux
  // delete leaves an orphaned asset rather than aborting an already-committed
  // removal.
  const mux = getMuxClient();
  for (const assetId of muxAssetIds) {
    try {
      await mux.video.assets.delete(assetId);
    } catch (error) {
      console.error(
        `removeModule: failed to delete Mux asset "${assetId}"; it is now orphaned and still counts against the free-tier limit`,
        error
      );
    }
  }
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
