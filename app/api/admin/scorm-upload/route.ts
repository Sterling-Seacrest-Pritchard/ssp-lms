import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { courses, modules, moduleVersions, scormModuleVersions } from "@/lib/db/schema";
import { parseManifest } from "@/lib/scorm/parse-manifest";
import { extractScormPackage } from "@/lib/scorm/extract-package";

export async function POST(request: NextRequest) {
  const formData = await request.formData();
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
    return NextResponse.json(
      { error: "package, courseCode, courseTitle, and moduleTitle are all required" },
      { status: 400 }
    );
  }

  const zipBuffer = Buffer.from(await file.arrayBuffer());
  const moduleVersionId = randomUUID();
  const { prefix, manifestXml } = await extractScormPackage(zipBuffer, moduleVersionId);
  const { identifier, launchUrl } = parseManifest(manifestXml);

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
    launchUrl,
    rawManifestXml: manifestXml,
  });

  await db
    .update(modules)
    .set({ currentVersionId: version.id })
    .where(eq(modules.id, courseModule.id));

  return NextResponse.json({ moduleVersionId: version.id, launchUrl, prefix });
}
