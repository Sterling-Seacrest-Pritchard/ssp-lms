import AdmZip from "adm-zip";
import { supabaseStorage } from "@/lib/storage/supabase";

export interface ExtractedPackage {
  prefix: string;
  manifestXml: string;
}

export async function extractScormPackage(
  zipBuffer: Buffer,
  prefix: string
): Promise<ExtractedPackage> {
  const zip = new AdmZip(zipBuffer);
  const entries = zip.getEntries().filter((entry) => !entry.isDirectory);

  const manifestEntry = entries.find(
    (entry) => entry.entryName.toLowerCase() === "imsmanifest.xml"
  );
  if (!manifestEntry) {
    throw new Error("SCORM package is missing imsmanifest.xml at its root");
  }
  const manifestXml = manifestEntry.getData().toString("utf-8");

  for (const entry of entries) {
    const path = `${prefix}/${entry.entryName}`;
    const { error } = await supabaseStorage
      .from("scorm-packages")
      .upload(path, entry.getData(), { upsert: true });
    if (error) {
      throw new Error(`Failed to upload ${path}: ${error.message}`);
    }
  }

  return { prefix, manifestXml };
}
