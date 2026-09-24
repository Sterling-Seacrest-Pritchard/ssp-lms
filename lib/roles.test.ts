import { describe, it, expect } from "vitest";
import { roleFromClaims, isAdminRole, isOrgAdmin } from "./roles";

describe("roleFromClaims", () => {
  it("resolves OrgAdmin", () => {
    expect(roleFromClaims(["OrgAdmin"])).toEqual({ role: "OrgAdmin", label: "Org Admin" });
  });
  it("resolves DepartmentAdmin", () => {
    expect(roleFromClaims(["DepartmentAdmin"])).toEqual({ role: "DepartmentAdmin", label: "Department Admin" });
  });
  it("defaults to Learner", () => {
    expect(roleFromClaims([])).toEqual({ role: "Learner", label: "Learner" });
    expect(roleFromClaims(undefined)).toEqual({ role: "Learner", label: "Learner" });
  });
  it("prefers OrgAdmin over DepartmentAdmin when both claims are present", () => {
    expect(roleFromClaims(["DepartmentAdmin", "OrgAdmin"])).toEqual({ role: "OrgAdmin", label: "Org Admin" });
  });
});

describe("isAdminRole", () => {
  it("is true for both admin tiers and false for Learner", () => {
    expect(isAdminRole(["OrgAdmin"])).toBe(true);
    expect(isAdminRole(["DepartmentAdmin"])).toBe(true);
    expect(isAdminRole([])).toBe(false);
    expect(isAdminRole(undefined)).toBe(false);
  });
});

describe("isOrgAdmin", () => {
  it("is true only for OrgAdmin", () => {
    expect(isOrgAdmin(["OrgAdmin"])).toBe(true);
    expect(isOrgAdmin(["DepartmentAdmin"])).toBe(false);
    expect(isOrgAdmin([])).toBe(false);
  });
});
