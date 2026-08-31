import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { courses, modules, moduleVersions, scormModuleVersions } from "@/lib/db/schema";
import { parseManifest } from "@/lib/scorm/parse-manifest";
import { readScormManifest, uploadScormPackage, assertLaunchFileExists } from "@/lib/scorm/extract-package";
import { badRequest, serverError } from "@/lib/api/errors";

export async function POST(request: NextRequest) {
  try {
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return badRequest("Request body must be valid multipart/form-data");
    }

    const file = formData.get("package");
    const courseCode = formData.get("courseCode");
    const courseTitle = formData.get("courseTitle");
    const moduleTitle = formData.get("moduleTitle");

    if (
      !(file instanceof File) ||
      typeof courseCode !== "string" ||
      typeof courseTitle !== "string" ||
      typeof moduleTitle !== "string"
    ) {
      return badRequest(
        "package, courseCode, courseTitle, and moduleTitle are all required"
      );
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

    const existing = await db.select().from(courses).where(eq(courses.code, courseCode));
    const course =
      existing[0] ??
      (await db.insert(courses).values({ code: courseCode, title: courseTitle }).returning())[0];

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
