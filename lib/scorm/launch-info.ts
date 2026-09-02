import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { scormModuleVersions } from "@/lib/db/schema";
import { isUuid } from "@/lib/api/errors";

export interface ScormLaunchInfo {
  launchUrl: string;
  gcsPrefix: string;
  scormVersion: string;
}

export async function getScormLaunchInfo(
  moduleVersionId: string
): Promise<ScormLaunchInfo | null> {
  if (!isUuid(moduleVersionId)) return null;

  const [row] = await db
    .select()
    .from(scormModuleVersions)
    .where(eq(scormModuleVersions.moduleVersionId, moduleVersionId));

  if (!row) {
    return null;
  }

  return { launchUrl: row.launchUrl, gcsPrefix: row.gcsPrefix, scormVersion: row.scormVersion };
}
