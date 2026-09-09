import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { UnavailableState } from "@/components/ui/unavailable-state";
import { listDepartmentsWithCounts } from "@/lib/db/departments";
import { departmentCompletion } from "@/lib/mock-data/reporting";
import { NewDepartmentDialog } from "./new-department-dialog";

export default async function OrgAdminPage() {
  let departments;
  try {
    departments = await listDepartmentsWithCounts();
  } catch {
    return <UnavailableState message="Could not load departments right now. Please try again in a moment." />;
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Org Admin</h1>
          <p className="text-sm text-muted-foreground">
            Department and role management — company-wide reporting.
          </p>
        </div>
        <NewDepartmentDialog />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Departments</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="text-right">Members</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {departments.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={2} className="text-center text-sm text-muted-foreground">
                      No departments yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  departments.map((dept) => (
                    <TableRow key={dept.id}>
                      <TableCell className="font-medium">
                        <Link href={`/admin/org/departments/${dept.id}`} className="hover:underline">
                          {dept.name}
                        </Link>
                      </TableCell>
                      <TableCell className="text-right">{dept.memberCount}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Department Completion Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Department</TableHead>
                  <TableHead className="text-right">Completed</TableHead>
                  <TableHead className="text-right">In Progress</TableHead>
                  <TableHead className="text-right">Not Started</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {departmentCompletion.map((row) => (
                  <TableRow key={row.department}>
                    <TableCell className="font-medium">{row.department}</TableCell>
                    <TableCell className="text-right">{row.completed}%</TableCell>
                    <TableCell className="text-right">{row.inProgress}%</TableCell>
                    <TableCell className="text-right">{row.notStarted}%</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
