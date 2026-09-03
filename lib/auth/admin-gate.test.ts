import { describe, it, expect } from "vitest";
import { requiresAdminRole, adminForbiddenResponse } from "./admin-gate";

describe("requiresAdminRole", () => {
  it("gates the admin UI", () => {
    expect(requiresAdminRole("/admin")).toBe(true);
    expect(requiresAdminRole("/admin/content")).toBe(true);
    expect(requiresAdminRole("/admin/content/builder/abc")).toBe(true);
  });

  it("gates every admin API route this branch adds", () => {
    const adminApiPaths = [
      "/api/admin/courses",
      "/api/admin/courses/list",
      "/api/admin/courses/11111111-1111-1111-1111-111111111111",
      "/api/admin/courses/11111111-1111-1111-1111-111111111111/publish",
      "/api/admin/courses/11111111-1111-1111-1111-111111111111/modules/video",
      "/api/admin/courses/11111111-1111-1111-1111-111111111111/modules/reorder",
      "/api/admin/courses/11111111-1111-1111-1111-111111111111/modules/22222222-2222-2222-2222-222222222222",
      "/api/admin/scorm-upload",
    ];
    for (const path of adminApiPaths) {
      expect(requiresAdminRole(path), path).toBe(true);
    }
  });

  it("leaves learner paths ungated", () => {
    expect(requiresAdminRole("/")).toBe(false);
    expect(requiresAdminRole("/courses")).toBe(false);
    expect(requiresAdminRole("/courses/abc/scorm/def")).toBe(false);
    expect(requiresAdminRole("/api/scorm/attempts")).toBe(false);
    expect(requiresAdminRole("/api/scorm/launch-info/abc")).toBe(false);
  });

  it("does not treat a path that merely starts with the same letters as admin-only", () => {
    expect(requiresAdminRole("/administrators")).toBe(false);
    expect(requiresAdminRole("/api/administrators")).toBe(false);
  });
});

describe("adminForbiddenResponse", () => {
  it("returns 403 JSON for an API path instead of redirecting a fetch caller", async () => {
    const response = adminForbiddenResponse(
      "/api/admin/courses",
      "http://localhost/api/admin/courses"
    );
    expect(response.status).toBe(403);
    expect(response.headers.get("location")).toBeNull();
    await expect(response.json()).resolves.toEqual({ error: "Admin role required" });
  });

  it("redirects a page request to the app root", () => {
    const response = adminForbiddenResponse("/admin/content", "http://localhost/admin/content");
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/");
  });
});
