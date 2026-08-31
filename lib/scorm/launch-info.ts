import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { scormModuleVersions } from "@/lib/db/schema";

export interface ScormLaunchInfo {
  launchUrl: string;
  gcsPrefix: string;
}

export async function getScormLaunchInfo(
  moduleVersionId: string
): Promise<ScormLaunchInfo | null> {
  const [row] = await db
    .select()
    .from(scormModuleVersions)
    .where(eq(scormModuleVersions.moduleVersionId, moduleVersionId));

  if (!row) {
    return null;
  }

  return { launchUrl: row.launchUrl, gcsPrefix: row.gcsPrefix };
}
