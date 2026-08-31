import { describe, it, expect, afterAll } from "vitest";
import AdmZip from "adm-zip";
import { randomUUID } from "node:crypto";
import { extractScormPackage } from "./extract-package";
import { supabaseStorage } from "@/lib/storage/supabase";

describe("extractScormPackage", () => {
  const prefix = `test-${randomUUID()}`;

  afterAll(async () => {
    await supabaseStorage.from("scorm-packages").remove([
      `${prefix}/imsmanifest.xml`,
      `${prefix}/index.html`,
    ]);
  });

  it("unzips and uploads every file, returning the manifest XML", async () => {
    const zip = new AdmZip();
    zip.addFile("imsmanifest.xml", Buffer.from("<manifest identifier=\"x\"></manifest>"));
    zip.addFile("index.html", Buffer.from("<html></html>"));

    const result = await extractScormPackage(zip.toBuffer(), prefix);

    expect(result.prefix).toBe(prefix);
    expect(result.manifestXml).toContain("identifier=\"x\"");

    const { data } = await supabaseStorage.from("scorm-packages").list(prefix);
    const names = (data ?? []).map((f) => f.name).sort();
    expect(names).toEqual(["imsmanifest.xml", "index.html"].sort());
  });

  it("throws when the zip has no imsmanifest.xml", async () => {
    const zip = new AdmZip();
    zip.addFile("index.html", Buffer.from("<html></html>"));

    await expect(extractScormPackage(zip.toBuffer(), `${prefix}-broken`)).rejects.toThrow(
      /imsmanifest\.xml/
    );
  });
});
