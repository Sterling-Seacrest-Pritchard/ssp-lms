import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db/client";
import { courses, modules, moduleVersions, scormModuleVersions } from "@/lib/db/schema";
import { parseManifest } from "@/lib/scorm/parse-manifest";
import { readScormManifest, uploadScormPackage, assertLaunchFileExists } from "@/lib/scorm/extract-package";
import { badRequest, isUuid, serverError } from "@/lib/api/errors";
import { assertCourseAccess, resolveCourseCreationDepartmentId } from "@/lib/api/course-access";
import { createDraftCourse } from "@/lib/db/course-authoring";

export async function POST(request: NextRequest) {
  try {
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return badRequest("Request body must be valid multipart/form-data");
    }

    const file = formData.get("package");
    const courseId = formData.get("courseId");
    const courseTitle = formData.get("courseTitle");
    const moduleTitle = formData.get("moduleTitle");

    if (!(file instanceof File) || typeof moduleTitle !== "string") {
      return badRequest("package and moduleTitle are required");
    }
    const attachToExistingCourse = typeof courseId === "string" && courseId.length > 0;
    if (!attachToExistingCourse && typeof courseTitle !== "string") {
      return badRequest("courseTitle is required unless courseId is provided");
    }
    if (attachToExistingCourse && !isUuid(courseId as string)) {
      return badRequest("courseId must be a UUID");
    }

    // Resolve (and validate) the attach-mode course BEFORE any Storage upload
    // happens: a nonexistent courseId is a 400, and per the same principle as
    // the manifest validation below, we must not write a package to Storage
    // for a request we're about to reject. Also resolve create-mode's
    // department scoping here, before the upload - never a client-supplied
    // departmentId alone, and never silently global: this endpoint can mint
    // a brand-new course exactly like POST /api/admin/courses can, so it
    // must apply the same session-derived scoping.
    // Definite-assignment assertion: TS can't see across the two `if`s below,
    // but they exhaustively cover attachToExistingCourse true/false and each
    // either assigns `course` or returns early.
    let course!: typeof courses.$inferSelect;
    let newCourseDepartmentId: string | null = null;
    if (attachToExistingCourse) {
      const [existing] = await db.select().from(courses).where(eq(courses.id, courseId as string));
      if (!existing) {
        return badRequest("No course exists with that courseId");
      }
      const denied = await assertCourseAccess(courseId as string);
      if (denied) return denied;
      course = existing;
    } else {
      // Create-mode never takes a client-supplied course code - there is no
      // "attach by code" path anymore. Letting a caller pick `code` directly
      // would mean anyone who knows or guesses another course's title can
      // compute its code and probe for it by submitting it here: a 404
      // (access denied) confirms it exists in a department they can't see,
      // and a 200 both reveals its absence AND spends a real Storage upload
      // + course row creating a throwaway course - a mutating side effect of
      // a failed guess. createDraftCourse derives an unguessable,
      // entropy-bearing code from the title instead, exactly like the
      // Course Builder's "New Course" dialog (POST /api/admin/courses).
      const session = await auth();
      const requestedDepartmentId = formData.get("departmentId");
      const scoped = await resolveCourseCreationDepartmentId(
        session,
        typeof requestedDepartmentId === "string" && requestedDepartmentId ? requestedDepartmentId : null
      );
      if ("error" in scoped) {
        return badRequest(scoped.error);
      }
      newCourseDepartmentId = scoped.departmentId;
    }

    const zipBuffer = Buffer.from(await file.arrayBuffer());
    const moduleVersionId = randomUUID();

    // Read + validate the manifest BEFORE uploading anything: both of these
    // throw on malformed input (missing/non-root imsmanifest.xml, no launchable
    // resource), and their messages are descriptive enough to hand back as a
    // 400. Uploading first would orphan a full copy of the package in Storage
    // with no DB row referencing it.
    let manifestXml: string;
    let identifier: string;
    let launchUrl: string;
    let scormVersion: string;
    try {
      manifestXml = readScormManifest(zipBuffer);
      ({ identifier, launchUrl, scormVersion } = parseManifest(manifestXml));
      assertLaunchFileExists(zipBuffer, launchUrl);
    } catch (error) {
      return badRequest(
        error instanceof Error ? error.message : "SCORM package could not be read"
      );
    }

    const { prefix } = await uploadScormPackage(zipBuffer, moduleVersionId);

    if (!attachToExistingCourse) {
      const { id } = await createDraftCourse(courseTitle as string, newCourseDepartmentId);
      const [created] = await db.select().from(courses).where(eq(courses.id, id));
      course = created;
    }

    const [courseModule] = await db
      .insert(modules)
      .values({ courseId: course.id, moduleType: "scorm", title: moduleTitle })
      .returning();

    const [version] = await db
      .insert(moduleVersions)
      .values({
        id: moduleVersionId,
        moduleId: courseModule.id,
        versionNumber: 1,
        status: "published",
        publishedAt: new Date(),
      })
      .returning();

    await db.insert(scormModuleVersions).values({
      moduleVersionId: version.id,
      gcsPrefix: prefix,
      manifestIdentifier: identifier,
      scormVersion,
      launchUrl,
      rawManifestXml: manifestXml,
    });

    await db
      .update(modules)
      .set({ currentVersionId: version.id })
      .where(eq(modules.id, courseModule.id));

    return NextResponse.json({ moduleVersionId: version.id, launchUrl, prefix });
  } catch (error) {
    return serverError(error);
  }
}
