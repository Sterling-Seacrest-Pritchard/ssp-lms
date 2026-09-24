export type Role = "Learner" | "DepartmentAdmin" | "OrgAdmin";

export function roleFromClaims(roles: string[] | undefined): { role: Role; label: string } {
  if (roles?.includes("OrgAdmin")) return { role: "OrgAdmin", label: "Org Admin" };
  if (roles?.includes("DepartmentAdmin")) return { role: "DepartmentAdmin", label: "Department Admin" };
  return { role: "Learner", label: "Learner" };
}

export function isAdminRole(roles: string[] | undefined): boolean {
  const role = roleFromClaims(roles).role;
  return role === "DepartmentAdmin" || role === "OrgAdmin";
}

export function isOrgAdmin(roles: string[] | undefined): boolean {
  return roleFromClaims(roles).role === "OrgAdmin";
}
