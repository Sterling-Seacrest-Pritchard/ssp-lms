import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { getUserIdByEmail } from "@/lib/db/users";
import { getDepartmentAdminDepartmentIds } from "@/lib/db/department-admins";
import { listDepartments } from "@/lib/db/departments";
import { isOrgAdmin } from "@/lib/roles";
import { UnavailableState } from "@/components/ui/unavailable-state";
import { BroadcastComposeClient } from "./broadcast-compose-client";

// This page intentionally mirrors /admin/org and /admin/department: it reads
// department data directly via the same DB functions those pages already use
// (listDepartments / getDepartmentAdminDepartmentIds) rather than through an
// API route. Neither of those pages exposes department listing as a fetchable
// endpoint today - see task-9-report.md for the investigation that confirmed
// this and the resulting decision to split this page into a Server Component
// (this file) plus a client sub-component, instead of a single client file
// calling a GET endpoint that doesn't exist.
export default async function AdminNotificationsPage() {
  const session = await auth();
  const userEmail = session?.user?.email;
  if (!userEmail) notFound();

  const orgAdmin = isOrgAdmin(session.user?.roles);

  let departments: { id: string; name: string }[];
  try {
    if (orgAdmin) {
      departments = await listDepartments();
    } else {
      const userId = await getUserIdByEmail(userEmail);
      const departmentIds = userId ? await getDepartmentAdminDepartmentIds(userId) : [];
      const all = await listDepartments();
      departments = all.filter((d) => departmentIds.includes(d.id));
    }
  } catch {
    return (
      <UnavailableState message="Could not load departments right now. Please try again in a moment." />
    );
  }

  return <BroadcastComposeClient isOrgAdmin={orgAdmin} departments={departments} />;
}
