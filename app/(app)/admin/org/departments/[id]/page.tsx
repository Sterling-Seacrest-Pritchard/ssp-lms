import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { UnavailableState } from "@/components/ui/unavailable-state";
import { getDepartmentWithMembers, listUsersNotInDepartment } from "@/lib/db/departments";
import { RosterClient } from "./roster-client";

export default async function DepartmentDetailPage(
  props: PageProps<"/admin/org/departments/[id]">
) {
  const { id } = await props.params;

  let department;
  let eligibleUsers;
  try {
    department = await getDepartmentWithMembers(id);
    eligibleUsers = department ? await listUsersNotInDepartment(id) : [];
  } catch {
    return <UnavailableState message="Could not load this department right now. Please try again in a moment." />;
  }
  if (!department) {
    notFound();
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <Link
          href="/admin/org"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Org Admin
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{department.name}</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Roster</CardTitle>
        </CardHeader>
        <CardContent>
          <RosterClient departmentId={department.id} members={department.members} eligibleUsers={eligibleUsers} />
        </CardContent>
      </Card>
    </div>
  );
}
