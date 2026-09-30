import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { isOrgAdmin } from "@/lib/roles";
import { getUserIdByEmail } from "@/lib/db/users";
import { getDepartmentAdminDepartmentIds } from "@/lib/db/department-admins";
import { listDepartments } from "@/lib/db/departments";
import { listCourseStatusRows, type CourseStatusRow } from "@/lib/db/member-progress";
import { badRequest, isUuid } from "@/lib/api/errors";

function csvField(value: string): string {
  // Neutralize Excel/Sheets formula-injection prefixes (=, +, -, @, tab, CR)
  // by prepending a literal quote, which forces the cell to be read as text
  // instead of evaluated - course titles and display names are free text an
  // admin (course author, or synced from Entra) controls, not this app.
  const needsPrefixGuard = /^[=+\-@\t\r]/.test(value);
  const body = needsPrefixGuard ? `'${value}` : value;
  if (needsPrefixGuard || /["\r\n,]/.test(body)) {
    return `"${body.replace(/"/g, '""')}"`;
  }
  return body;
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
  const session = await auth();

  if (!isOrgAdmin(session?.user?.roles)) {
    // A Department Admin's dept is checked entirely against their own real
    // assignments before anything else runs - malformed, missing, and
    // foreign all collapse to the same generic 403, so a caller can never
    // learn "that dept exists" from a distinguishing status code before
    // being told they can't see it.
    if (dept === null || !isUuid(dept)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const email = session?.user?.email;
    const callerId = email ? await getUserIdByEmail(email) : null;
    const administeredIds = callerId ? await getDepartmentAdminDepartmentIds(callerId) : [];
    if (!administeredIds.includes(dept)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  } else if (dept !== null) {
    // An Org Admin can see any department, so a malformed/nonexistent dept
    // here is just a bad request, not an authorization question.
    if (!isUuid(dept)) return badRequest("dept must be a UUID");
    const realDepartments = await listDepartments();
    if (!realDepartments.some((d) => d.id === dept)) return badRequest("dept not found");
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
