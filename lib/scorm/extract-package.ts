import AdmZip from "adm-zip";
import { gcsStorage as supabaseStorage } from "@/lib/storage/gcs";
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
 * Zips built on Windows can store entry names with literal backslash path
 * separators ("sco1\index.html") even though manifest hrefs are always
 * forward-slash ("sco1/index.html", the web/XML convention) - confirmed
 * against a real SCORM 2004 test package. Supabase Storage silently
 * normalizes backslash-in-key to forward slash on upload/download (verified
 * directly against the live bucket), so treating them as equivalent here
 * matches what actually happens once a file reaches Storage.
 */
export function normalizeEntryName(entryName: string): string {
  return entryName.replace(/\\/g, "/");
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
 * Assert that the manifest's declared launch file actually exists in the zip.
 *
 * A manifest can be syntactically valid and still reference a file that was
 * never packaged (e.g. `<resource href="does_not_exist.html">`) - the upload
 * would otherwise "succeed" and only fail later, opaquely, when the content
 * proxy tries to serve a file that was never uploaded.
 */
export function assertLaunchFileExists(zipBuffer: Buffer, launchUrl: string): void {
  const exists = packageEntries(zipBuffer).some(
    (entry) => normalizeEntryName(entry.entryName) === launchUrl
  );
  if (!exists) {
    throw new Error(
      `imsmanifest.xml references "${launchUrl}" as the launch file, but the zip doesn't contain it`
    );
  }
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
    const path = `${prefix}/${normalizeEntryName(entry.entryName)}`;
    const { error } = await supabaseStorage
      .from("ssp-lms-scorm-packages")
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

/**
 * List every object stored under `prefix`, recursively.
 *
 * `list()` is NOT recursive: for a package with subdirectories it returns a
 * synthetic "folder" row per immediate subdirectory (identifiable by a null
 * `id` - real objects always carry one) rather than the files inside it. A
 * flat listing would therefore leave most of a real SCORM package behind.
 */
async function listPackageObjects(prefix: string): Promise<string[]> {
  const { data, error } = await supabaseStorage.from("ssp-lms-scorm-packages").list(prefix);
  if (error) {
    throw new Error(`Failed to list ${prefix}: ${error.message}`);
  }

  const paths: string[] = [];
  for (const entry of data ?? []) {
    const path = `${prefix}/${entry.name}`;
    if (entry.id === null) {
      paths.push(...(await listPackageObjects(path)));
    } else {
      paths.push(path);
    }
  }
  return paths;
}

/**
 * Delete every uploaded file of a SCORM package from the `scorm-packages`
 * bucket.
 *
 * Call this when the DB rows referencing a package are gone (or are about to
 * be), so a removed module doesn't leave its package orphaned in Storage with
 * nothing pointing at it - the same "never orphan a package" principle the
 * upload path applies by validating a manifest before uploading anything.
 */
export async function deleteScormPackage(prefix: string): Promise<void> {
  const paths = await listPackageObjects(prefix);
  if (paths.length === 0) return;

  const { error } = await supabaseStorage.from("ssp-lms-scorm-packages").remove(paths);
  if (error) {
    throw new Error(`Failed to delete ${prefix}: ${error.message}`);
  }
}
