import { auth } from "@/auth";
import { getUserIdByEmail } from "@/lib/db/users";
import { getDepartmentAdminDepartmentIds } from "@/lib/db/department-admins";
import { listDepartments } from "@/lib/db/departments";
import { isOrgAdmin } from "@/lib/roles";
import { ContentAuthoringClient } from "./content-authoring-client";

export default async function ContentAuthoringPage() {
  const session = await auth();

  let administeredDepartments: { id: string; name: string }[] = [];
  if (!isOrgAdmin(session?.user?.roles)) {
    const userId = session?.user?.email ? await getUserIdByEmail(session.user.email) : null;
    const administeredIds = userId ? await getDepartmentAdminDepartmentIds(userId) : [];
    if (administeredIds.length >= 2) {
      const allDepartments = await listDepartments();
      administeredDepartments = allDepartments.filter((d) => administeredIds.includes(d.id));
    }
  }

  return <ContentAuthoringClient administeredDepartments={administeredDepartments} />;
}
