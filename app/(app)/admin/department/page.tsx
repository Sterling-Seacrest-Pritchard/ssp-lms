import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { getUserIdByEmail } from "@/lib/db/users";
import { getDepartmentAdminDepartmentIds } from "@/lib/db/department-admins";
import { listUsersNotInDepartment } from "@/lib/db/departments";
import { UnavailableState } from "@/components/ui/unavailable-state";
import { DepartmentView } from "./department-view";

export default async function DepartmentAdminPage(props: {
  searchParams: Promise<{ dept?: string }>;
}) {
  const session = await auth();
  const userEmail = session?.user?.email;
  if (!userEmail) notFound();

  const userId = await getUserIdByEmail(userEmail);
  if (!userId) notFound();

  // Scoped purely to the caller's own department_admins rows, regardless of
  // their Entra tier - this is what lets an Org Admin who is ALSO a real
  // Department Admin somewhere (or who is just previewing the Department
  // Admin view) reach this page too, not just the Department Admin tier.
  let departmentIds: string[];
  try {
    departmentIds = await getDepartmentAdminDepartmentIds(userId);
  } catch {
    return <UnavailableState message="Could not load your department right now. Please try again in a moment." />;
  }

  if (departmentIds.length === 0) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col items-center gap-2 py-16 text-center">
        <h1 className="text-xl font-semibold">No department assigned yet</h1>
        <p className="text-sm text-muted-foreground">
          You&apos;re not the Department Admin of any department yet. Ask an Org Admin to add you
          from the Org Admin page.
        </p>
      </div>
    );
  }

  const { dept: selectedFromQuery } = await props.searchParams;
  const selectedDepartmentId =
    selectedFromQuery && departmentIds.includes(selectedFromQuery) ? selectedFromQuery : departmentIds[0];

  let eligibleUsers;
  try {
    eligibleUsers = await listUsersNotInDepartment(selectedDepartmentId);
  } catch {
    return <UnavailableState message="Could not load this department right now. Please try again in a moment." />;
  }

  return (
    <DepartmentView
      departmentIds={departmentIds}
      selectedDepartmentId={selectedDepartmentId}
      eligibleUsers={eligibleUsers}
    />
  );
}
