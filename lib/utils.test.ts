import { describe, it, expect } from "vitest";
import { isSafeInternalHref } from "./utils";

describe("isSafeInternalHref", () => {
  it.each([
    ["/courses/abc-123", true],
    ["/", true],
    ["courses/abc-123", false],
    ["//evil.com", false],
    ["/\\evil.com", false],
    ["/%2Fevil.com", false],
    ["/%5Cevil.com", false],
    ["javascript:alert(1)", false],
    ["https://evil.com", false],
    ["http://evil.com", false],
    ["", false],
  ])("isSafeInternalHref(%j) === %p", (href, expected) => {
    expect(isSafeInternalHref(href)).toBe(expected);
  });
});
