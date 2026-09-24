import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { getUserIdByEmail } from "@/lib/db/users";
import { getDepartmentAdminDepartmentIds } from "@/lib/db/department-admins";
import { isOrgAdmin } from "@/lib/roles";
import { UnavailableState } from "@/components/ui/unavailable-state";
import { DepartmentView } from "./department-view";

export default async function DepartmentAdminPage(props: {
  searchParams: Promise<{ dept?: string }>;
}) {
  const session = await auth();
  const userEmail = session?.user?.email;
  if (!userEmail) notFound();

  // An Org Admin has no personal "my department" - this page is exclusively
  // for the Department Admin tier's own scoped view.
  if (isOrgAdmin(session.user?.roles)) notFound();

  const userId = await getUserIdByEmail(userEmail);
  if (!userId) notFound();

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
          You have Department Admin access, but an Org Admin hasn&apos;t assigned you to a
          department yet. Ask an Org Admin to add you from the Org Admin page.
        </p>
      </div>
    );
  }

  const { dept: selectedFromQuery } = await props.searchParams;
  const selectedDepartmentId =
    selectedFromQuery && departmentIds.includes(selectedFromQuery) ? selectedFromQuery : departmentIds[0];

  return <DepartmentView departmentIds={departmentIds} selectedDepartmentId={selectedDepartmentId} />;
}
