import { UserPlus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { departmentCompletion } from "@/lib/mock-data/reporting";

const admins = [
  { name: "Priya Nair", department: "Compliance", role: "Department Admin" },
  { name: "Marcus Webb", department: "HR", role: "Department Admin" },
  { name: "Sofia Delgado", department: "Underwriting", role: "Department Admin" },
  { name: "Ian Harrison", department: "Engineering", role: "Org Admin" },
];

export default function OrgAdminPage() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Org Admin</h1>
          <p className="text-sm text-muted-foreground">
            Department and role management — company-wide reporting (mock UI).
          </p>
        </div>
        <Button>
          <UserPlus className="h-4 w-4" />
          Grant Admin Access
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Department Admins</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Role</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {admins.map((admin) => (
                  <TableRow key={admin.name}>
                    <TableCell className="font-medium">{admin.name}</TableCell>
                    <TableCell>{admin.department}</TableCell>
                    <TableCell>
                      <Badge variant={admin.role === "Org Admin" ? "default" : "secondary"}>
                        {admin.role}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
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
