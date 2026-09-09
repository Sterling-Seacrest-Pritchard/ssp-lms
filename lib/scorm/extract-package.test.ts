import { describe, it, expect, afterAll } from "vitest";
import AdmZip from "adm-zip";
import { randomUUID } from "node:crypto";
import {
  readScormManifest,
  uploadScormPackage,
  assertLaunchFileExists,
  normalizeEntryName,
} from "./extract-package";
import { gcsStorage as supabaseStorage } from "@/lib/storage/gcs";

describe("SCORM package extraction", () => {
  const prefix = `test-${randomUUID()}`;

  afterAll(async () => {
    await supabaseStorage.from("ssp-lms-scorm-packages").remove([
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

    const { data } = await supabaseStorage.from("ssp-lms-scorm-packages").list(prefix);
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
    const { data, error } = await supabaseStorage.from("ssp-lms-scorm-packages").list(prefix);

    expect(error).toBeNull();
    const indexHtml = (data ?? []).find((f) => f.name === "index.html");
    expect(indexHtml?.metadata?.mimetype).toBe("text/html");
  });

  it("throws when the zip has no imsmanifest.xml", () => {
    const zip = new AdmZip();
    zip.addFile("index.html", Buffer.from("<html></html>"));

    expect(() => readScormManifest(zip.toBuffer())).toThrow(/imsmanifest\.xml/);
  });

  it("assertLaunchFileExists passes when the referenced launch file is in the zip", () => {
    const zip = new AdmZip();
    zip.addFile("imsmanifest.xml", Buffer.from("<manifest identifier=\"x\"></manifest>"));
    zip.addFile("index.html", Buffer.from("<html></html>"));

    expect(() => assertLaunchFileExists(zip.toBuffer(), "index.html")).not.toThrow();
  });

  it("normalizeEntryName converts backslash separators to forward slashes", () => {
    // Real bug, found live against 03_scorm2004_multisco.zip: zips built on
    // Windows can store entry names with literal backslashes
    // ("sco1\\index.html") in their central directory even though manifest
    // hrefs are always forward-slash ("sco1/index.html", per XML/web
    // convention) - confirmed via a raw AdmZip read of that exact file.
    // Supabase Storage itself silently normalizes backslash-in-key to
    // forward slash on upload/download (verified directly against the live
    // bucket), which is why the content proxy already worked for these
    // packages before assertLaunchFileExists existed - so this check has to
    // treat them as equivalent too, or it rejects perfectly valid packages.
    // AdmZip's own addFile() strips backslashes rather than preserving them
    // (confirmed empirically), so this can't be reproduced through a
    // round-tripped in-memory fixture - tested as a pure function instead.
    expect(normalizeEntryName("sco1\\index.html")).toBe("sco1/index.html");
    expect(normalizeEntryName("sco1/index.html")).toBe("sco1/index.html");
  });

  it("assertLaunchFileExists throws a descriptive error when the launch file is missing", () => {
    const zip = new AdmZip();
    zip.addFile("imsmanifest.xml", Buffer.from("<manifest identifier=\"x\"></manifest>"));
    zip.addFile("index.html", Buffer.from("<html></html>"));

    expect(() => assertLaunchFileExists(zip.toBuffer(), "does_not_exist.html")).toThrow(
      /does_not_exist\.html/
    );
  });
});
