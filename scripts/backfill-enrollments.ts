// Run with: npx tsx scripts/backfill-enrollments.ts [--dry-run]
//
// Finds every (user, course) pair that should have an enrollment but
// doesn't - because the user was assigned the course (course_assignments)
// and/or because they have real attempt history for it (module_attempts) -
// and creates the missing enrollment with real status AND real
// module_progress rows derived from their actual attempt history.
//
// Supersedes the two single-source scripts this replaces
// (backfill-enrollments-from-assignments.js, which hardcoded every backfilled
// enrollment to status "not_started" even when the learner had already
// finished the course, and backfill-enrollments-from-attempts.ts, which
// created the enrollment row but never wrote module_progress at all). Either
// gap left getCourseProgressForLearner (lib/scorm/course-progress.ts) - which
// reads only the persisted enrollment/module_progress rows, not live attempt
// history - rendering a learner who actually completed the course as
// not-started/0%, indefinitely.
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../lib/db/client";
import {
  computeLiveCourseProgress,
  getTrackedModuleVersionIds,
  isModuleFinishedForUser,
} from "../lib/scorm/course-progress";
import {
  courseAssignments,
  courses,
  enrollments,
  moduleAttempts,
  moduleProgress,
  moduleVersions,
  modules,
} from "../lib/db/schema";

const DRY_RUN = process.argv.includes("--dry-run");

interface Pair {
  userId: string;
  courseId: string;
}

async function findAssignmentOrphans(): Promise<Pair[]> {
  return db
    .selectDistinct({ userId: courseAssignments.userId, courseId: courseAssignments.courseId })
    .from(courseAssignments)
    .leftJoin(
      enrollments,
      and(eq(enrollments.userId, courseAssignments.userId), eq(enrollments.courseId, courseAssignments.courseId))
    )
    .where(isNull(enrollments.id));
}

async function findAttemptOrphans(): Promise<Pair[]> {
  return db
    .selectDistinct({ userId: moduleAttempts.userId, courseId: modules.courseId })
    .from(moduleAttempts)
    .innerJoin(moduleVersions, eq(moduleVersions.id, moduleAttempts.moduleVersionId))
    .innerJoin(modules, eq(modules.id, moduleVersions.moduleId))
    .leftJoin(
      enrollments,
      and(eq(enrollments.userId, moduleAttempts.userId), eq(enrollments.courseId, modules.courseId))
    )
    .where(isNull(enrollments.id));
}

function dedupePairs(pairs: Pair[]): Pair[] {
  const seen = new Map<string, Pair>();
  for (const pair of pairs) {
    seen.set(`${pair.userId}:${pair.courseId}`, pair);
  }
  return Array.from(seen.values());
}

async function main() {
  const pairs = dedupePairs([...(await findAssignmentOrphans()), ...(await findAttemptOrphans())]);
  console.log(`${pairs.length} (user, course) pair(s) need a backfilled enrollment.`);

  for (const pair of pairs) {
    // computeLiveCourseProgress's second parameter is a users.id UUID (not an
    // email) now that module_attempts.user_id is a real FK (Task 10 cutover)
    // - pair.userId is already that UUID (selected straight from
    // course_assignments.user_id or module_attempts.user_id above), so no
    // separate email lookup is needed here.
    const progress = await computeLiveCourseProgress(pair.courseId, pair.userId);
    const status =
      progress.status === "completed"
        ? "completed"
        : progress.status === "in-progress"
          ? "in_progress"
          : "not_started";

    if (DRY_RUN) {
      console.log(` - would create enrollment: user ${pair.userId}, course ${pair.courseId}, status ${status}`);
      continue;
    }

    const [course] = await db.select({ dueDate: courses.dueDate }).from(courses).where(eq(courses.id, pair.courseId));

    const [enrollment] = await db
      .insert(enrollments)
      .values({
        userId: pair.userId,
        courseId: pair.courseId,
        status,
        source: "auto",
        dueAt: course?.dueDate ?? null,
        completedAt: status === "completed" ? new Date() : null,
      })
      .onConflictDoNothing()
      .returning();
    if (!enrollment) continue; // already existed - nothing more to backfill

    // Populate module_progress from the same tracked-module set and
    // finished/unfinished determination the live read path uses, so
    // getCourseProgressForLearner has real per-module data instead of an
    // empty set for this newly-created enrollment.
    const courseModules = await db.select().from(modules).where(eq(modules.courseId, pair.courseId));
    const trackable = courseModules.flatMap((m) =>
      m.currentVersionId
        ? [{ moduleType: m.moduleType, moduleVersionId: m.currentVersionId, moduleId: m.id }]
        : []
    );
    const trackedVersionIds = await getTrackedModuleVersionIds(trackable);
    const trackedModules = trackable.filter((m) => trackedVersionIds.has(m.moduleVersionId));

    for (const trackedModule of trackedModules) {
      const finished = await isModuleFinishedForUser(
        trackedModule.moduleType,
        trackedModule.moduleVersionId,
        pair.userId
      );
      await db
        .insert(moduleProgress)
        .values({
          enrollmentId: enrollment.id,
          moduleId: trackedModule.moduleId,
          status: finished ? "completed" : "incomplete",
        })
        .onConflictDoNothing();
    }
  }
  console.log(DRY_RUN ? "Dry run complete." : `Backfilled ${pairs.length} enrollment(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
