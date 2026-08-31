import AdmZip from "adm-zip";
import { supabaseStorage } from "@/lib/storage/supabase";
import { mimeTypeForPath } from "@/lib/scorm/mime-types";

export interface UploadedPackage {
  prefix: string;
}

// `adm-zip` exposes IZipEntry only on its `export =` namespace, which an
// esModuleInterop default import can't name directly; derive it from the class.
type ZipEntry = ReturnType<AdmZip["getEntries"]>[number];

function packageEntries(zipBuffer: Buffer): ZipEntry[] {
  return new AdmZip(zipBuffer).getEntries().filter((entry) => !entry.isDirectory);
}

/**
 * Read `imsmanifest.xml` out of the zip WITHOUT uploading anything.
 *
 * This is deliberately separate from `uploadScormPackage` so a caller can
 * validate the manifest (via `parseManifest`) BEFORE any bytes reach Supabase
 * Storage. Uploading first would leave a full orphaned copy of the package in
 * Storage whenever manifest validation fails, with no DB row referencing it.
 *
 * Throws if the zip has no `imsmanifest.xml` at its root.
 */
export function readScormManifest(zipBuffer: Buffer): string {
  const manifestEntry = packageEntries(zipBuffer).find(
    (entry) => entry.entryName.toLowerCase() === "imsmanifest.xml"
  );
  if (!manifestEntry) {
    throw new Error("SCORM package is missing imsmanifest.xml at its root");
  }
  return manifestEntry.getData().toString("utf-8");
}

/**
 * Upload every file in the zip to the `scorm-packages` bucket under `prefix/`.
 *
 * Call this only after the manifest has been read and validated
 * (see `readScormManifest`).
 *
 * Each upload passes an explicit `contentType`: Supabase Storage otherwise
 * defaults to `text/plain;charset=UTF-8`, which stops the browser rendering the
 * launch `.html` or executing the package's `.js`.
 */
export async function uploadScormPackage(
  zipBuffer: Buffer,
  prefix: string
): Promise<UploadedPackage> {
  for (const entry of packageEntries(zipBuffer)) {
    const path = `${prefix}/${entry.entryName}`;
    const { error } = await supabaseStorage
      .from("scorm-packages")
      .upload(path, entry.getData(), {
        upsert: true,
        contentType: mimeTypeForPath(entry.entryName),
      });
    if (error) {
      throw new Error(`Failed to upload ${path}: ${error.message}`);
    }
  }

  return { prefix };
}
