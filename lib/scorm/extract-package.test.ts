import { describe, it, expect, afterAll } from "vitest";
import AdmZip from "adm-zip";
import { randomUUID } from "node:crypto";
import { readScormManifest, uploadScormPackage } from "./extract-package";
import { supabaseStorage } from "@/lib/storage/supabase";

describe("SCORM package extraction", () => {
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
    const zipBuffer = zip.toBuffer();

    const manifestXml = readScormManifest(zipBuffer);
    expect(manifestXml).toContain("identifier=\"x\"");

    const result = await uploadScormPackage(zipBuffer, prefix);
    expect(result.prefix).toBe(prefix);

    const { data } = await supabaseStorage.from("scorm-packages").list(prefix);
    const names = (data ?? []).map((f) => f.name).sort();
    expect(names).toEqual(["imsmanifest.xml", "index.html"].sort());
  });

  it("stores files with a real Content-Type, not text/plain", async () => {
    // Supabase Storage defaults a Buffer upload with no explicit contentType to
    // "text/plain;charset=UTF-8". Assert against the STORED object metadata:
    // Supabase separately (and deliberately) re-serves HTML objects over HTTP as
    // text/plain to blunt stored-XSS on its own domain, so the response
    // Content-Type is not a usable signal here - which is precisely why the
    // same-origin proxy at /api/scorm/content sets Content-Type from its own
    // extension mapping instead of echoing Supabase's.
    const { data, error } = await supabaseStorage.from("scorm-packages").list(prefix);

    expect(error).toBeNull();
    const indexHtml = (data ?? []).find((f) => f.name === "index.html");
    expect(indexHtml?.metadata?.mimetype).toBe("text/html");
  });

  it("throws when the zip has no imsmanifest.xml", () => {
    const zip = new AdmZip();
    zip.addFile("index.html", Buffer.from("<html></html>"));

    expect(() => readScormManifest(zip.toBuffer())).toThrow(/imsmanifest\.xml/);
  });
});
