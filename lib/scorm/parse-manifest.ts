import { XMLParser } from "fast-xml-parser";

export type ScormVersion = "1.2" | "2004";

export interface ParsedManifest {
  identifier: string;
  launchUrl: string;
  scormVersion: ScormVersion;
}

// SCORM 2004 manifests declare <metadata><schemaversion>2004 ...</schemaversion></metadata>;
// SCORM 1.2 manifests either omit <metadata> entirely or declare "1.2" there.
// No <metadata> block at all defaults to 1.2, matching most real-world 1.2 exports.
function detectScormVersion(manifest: Record<string, unknown>): ScormVersion {
  const metadata = manifest.metadata as { schemaversion?: unknown } | undefined;
  const schemaVersion = metadata?.schemaversion;
  if (typeof schemaVersion === "string" && schemaVersion.trim().startsWith("2004")) {
    return "2004";
  }
  return "1.2";
}

export function parseManifest(xml: string): ParsedManifest {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });
  const doc = parser.parse(xml);
  const manifest = doc.manifest;
  if (!manifest) {
    throw new Error("imsmanifest.xml is missing its <manifest> root element");
  }

  const identifier = manifest["@_identifier"];
  if (!identifier) {
    throw new Error("imsmanifest.xml <manifest> is missing an identifier attribute");
  }

  const resourceList = manifest.resources?.resource;
  const resource = Array.isArray(resourceList) ? resourceList[0] : resourceList;
  const launchUrl = resource?.["@_href"];
  if (!launchUrl) {
    throw new Error("imsmanifest.xml has no launchable <resource href=\"...\">");
  }

  return { identifier, launchUrl, scormVersion: detectScormVersion(manifest) };
}
