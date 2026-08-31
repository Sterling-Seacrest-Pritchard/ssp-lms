import { XMLParser } from "fast-xml-parser";

export interface ParsedManifest {
  identifier: string;
  launchUrl: string;
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

  return { identifier, launchUrl };
}
