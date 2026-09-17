import { eq } from "drizzle-orm";
import { db } from "./client";
import { modules, moduleVersions, textModuleVersions } from "./schema";

export async function createTextModule(
  courseId: string,
  title: string,
  body: string
): Promise<{ moduleId: string; moduleVersionId: string }> {
  return db.transaction(async (tx) => {
    const [mod] = await tx.insert(modules).values({ courseId, moduleType: "text", title }).returning();
    const [version] = await tx
      .insert(moduleVersions)
      .values({ moduleId: mod.id, versionNumber: 1, status: "draft" })
      .returning();
    await tx.insert(textModuleVersions).values({ moduleVersionId: version.id, body });
    await tx.update(modules).set({ currentVersionId: version.id }).where(eq(modules.id, mod.id));
    return { moduleId: mod.id, moduleVersionId: version.id };
  });
}

export async function updateTextBody(moduleVersionId: string, body: string): Promise<void> {
  await db.update(textModuleVersions).set({ body }).where(eq(textModuleVersions.moduleVersionId, moduleVersionId));
}
