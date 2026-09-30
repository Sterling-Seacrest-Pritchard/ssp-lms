import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { isOrgAdmin } from "@/lib/roles";
import { getUserIdByEmail } from "@/lib/db/users";
import { getDepartmentAdminDepartmentIds } from "@/lib/db/department-admins";
import { listDepartments } from "@/lib/db/departments";
import { listCourseStatusRows, type CourseStatusRow } from "@/lib/db/member-progress";
import { badRequest, isUuid } from "@/lib/api/errors";

function csvField(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function toCsv(rows: CourseStatusRow[]): string {
  const header = "Name,Email,Course,Status,Due,Completed,Overdue,Compliance";
  const lines = rows.map((r) =>
    [
      csvField(r.displayName),
      csvField(r.email),
      csvField(r.courseTitle),
      r.status,
      r.dueAt ?? "",
      r.completedAt ?? "",
      String(r.overdue),
      String(r.compliance),
    ].join(",")
  );
  return [header, ...lines].join("\n");
}

export async function GET(request: NextRequest) {
  const dept = request.nextUrl.searchParams.get("dept");

  if (dept !== null) {
    if (!isUuid(dept)) return badRequest("dept must be a UUID");
    const realDepartments = await listDepartments();
    if (!realDepartments.some((d) => d.id === dept)) return badRequest("dept not found");
  }

  const session = await auth();
  if (!isOrgAdmin(session?.user?.roles)) {
    if (dept === null) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const email = session?.user?.email;
    const callerId = email ? await getUserIdByEmail(email) : null;
    const administeredIds = callerId ? await getDepartmentAdminDepartmentIds(callerId) : [];
    if (!administeredIds.includes(dept)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const rows = await listCourseStatusRows(dept ? { departmentId: dept } : {});
  const csv = toCsv(rows);
  const scope = dept ?? "company-wide";

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="progress-${scope}.csv"`,
    },
  });
}
