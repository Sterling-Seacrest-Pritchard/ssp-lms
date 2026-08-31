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
});
