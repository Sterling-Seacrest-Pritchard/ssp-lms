export type Role = "Learner" | "Admin";

export function roleFromClaims(roles: string[] | undefined): { role: Role; label: string } {
  if (roles?.includes("OrgAdmin")) return { role: "Admin", label: "Org Admin" };
  if (roles?.includes("DepartmentAdmin")) return { role: "Admin", label: "Department Admin" };
  return { role: "Learner", label: "Learner" };
}

export function isAdminRole(roles: string[] | undefined): boolean {
  return roleFromClaims(roles).role === "Admin";
}
