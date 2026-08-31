import { describe, it, expect } from "vitest";
import { parseManifest } from "./parse-manifest";

const SAMPLE_MANIFEST = `<?xml version="1.0" standalone="no" ?>
<manifest identifier="com_scorm_sample_course" version="1"
  xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2">
  <organizations default="sample_org">
    <organization identifier="sample_org">
      <title>Sample Course</title>
      <item identifier="item_1" identifierref="resource_1">
        <title>Lesson 1</title>
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="resource_1" type="webcontent" href="index.html">
      <file href="index.html" />
    </resource>
  </resources>
</manifest>`;

const SCORM_2004_MANIFEST = `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="COM.TEST.SCORM2004" version="1"
    xmlns="http://www.imsglobal.org/xsd/imscp_v1p1">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>2004 4th Edition</schemaversion>
  </metadata>
  <organizations default="ORG-1">
    <organization identifier="ORG-1">
      <title>2004 Course</title>
      <item identifier="ITEM-1" identifierref="RES-1"><title>Module 1</title></item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="RES-1" type="webcontent" href="sco1/index.html">
      <file href="sco1/index.html" />
    </resource>
  </resources>
</manifest>`;

const SCORM_12_MANIFEST_WITH_METADATA = `<?xml version="1.0" standalone="no" ?>
<manifest identifier="COM.TEST.SCORM12" version="1"
    xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>1.2</schemaversion>
  </metadata>
  <organizations default="ORG-1">
    <organization identifier="ORG-1">
      <title>1.2 Course</title>
      <item identifier="ITEM-1" identifierref="RES-1"><title>Module 1</title></item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="RES-1" type="webcontent" href="index.html">
      <file href="index.html" />
    </resource>
  </resources>
</manifest>`;

describe("parseManifest", () => {
  it("extracts the manifest identifier and launch URL", () => {
    const result = parseManifest(SAMPLE_MANIFEST);
    expect(result.identifier).toBe("com_scorm_sample_course");
    expect(result.launchUrl).toBe("index.html");
  });

  it("throws when the manifest has no resource href", () => {
    const broken = `<manifest identifier="x"><resources></resources></manifest>`;
    expect(() => parseManifest(broken)).toThrow(/launchable/);
  });

  it("defaults scormVersion to 1.2 when there's no <metadata> block", () => {
    const result = parseManifest(SAMPLE_MANIFEST);
    expect(result.scormVersion).toBe("1.2");
  });

  it("reads scormVersion 1.2 from an explicit <schemaversion>1.2</schemaversion>", () => {
    const result = parseManifest(SCORM_12_MANIFEST_WITH_METADATA);
    expect(result.scormVersion).toBe("1.2");
  });

  it("reads scormVersion 2004 from a <schemaversion>2004 4th Edition</schemaversion>", () => {
    const result = parseManifest(SCORM_2004_MANIFEST);
    expect(result.scormVersion).toBe("2004");
    expect(result.launchUrl).toBe("sco1/index.html");
  });
});
