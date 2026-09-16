// Run with: npx tsx scripts/backfill-enrollments-from-attempts.ts [--dry-run]
import { db } from "../lib/db/client";
import { computeLiveCourseProgress } from "../lib/scorm/course-progress";
import { courseAssignments, enrollments, moduleAttempts, moduleVersions, modules } from "../lib/db/schema";
import { and, eq, isNull } from "drizzle-orm";

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  const orphanPairs = await db
    .selectDistinct({ userId: moduleAttempts.userId, courseId: modules.courseId })
    .from(moduleAttempts)
    .innerJoin(moduleVersions, eq(moduleVersions.id, moduleAttempts.moduleVersionId))
    .innerJoin(modules, eq(modules.id, moduleVersions.moduleId))
    .leftJoin(
      courseAssignments,
      and(eq(courseAssignments.userId, moduleAttempts.userId), eq(courseAssignments.courseId, modules.courseId))
    )
    .leftJoin(
      enrollments,
      and(eq(enrollments.userId, moduleAttempts.userId), eq(enrollments.courseId, modules.courseId))
    )
    .where(and(isNull(courseAssignments.id), isNull(enrollments.id)));

  console.log(`${orphanPairs.length} (user, course) pair(s) have attempt history but no assignment or enrollment.`);

  for (const pair of orphanPairs) {
    // computeLiveCourseProgress's second parameter is a users.id UUID (not an
    // email) now that module_attempts.user_id is a real FK (Task 10 cutover)
    // - pair.userId, selected straight from module_attempts.user_id above, is
    // already that UUID, so no separate email lookup is needed here.
    const progress = await computeLiveCourseProgress(pair.courseId, pair.userId);
    const status = progress.status === "completed" ? "completed" : progress.status === "in-progress" ? "in_progress" : "not_started";

    if (DRY_RUN) {
      console.log(` - would create enrollment: user ${pair.userId}, course ${pair.courseId}, status ${status}`);
      continue;
    }
    await db
      .insert(enrollments)
      .values({ userId: pair.userId, courseId: pair.courseId, status, source: "auto" })
      .onConflictDoNothing();
  }
  console.log(DRY_RUN ? "Dry run complete." : `Backfilled ${orphanPairs.length} enrollment(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
