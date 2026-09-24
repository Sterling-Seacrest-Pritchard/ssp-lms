"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Admin {
  userId: string;
  displayName: string;
  email: string;
}

interface EligibleUser {
  id: string;
  displayName: string;
  email: string;
}

export function DepartmentAdminsClient({
  departmentId,
  admins,
  eligibleUsers,
}: {
  departmentId: string;
  admins: Admin[];
  eligibleUsers: EligibleUser[];
}) {
  const router = useRouter();
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleAdd() {
    if (!selectedUserId) return;
    setAdding(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/department-admins", {
        method: "POST",
        body: JSON.stringify({ userId: selectedUserId, departmentId }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setError(body?.error ?? "Could not add admin");
        setAdding(false);
        return;
      }
      setSelectedUserId(null);
      setAdding(false);
      router.refresh();
    } catch {
      setError("Could not add admin");
      setAdding(false);
    }
  }

  async function handleRemove(userId: string) {
    setRemovingId(userId);
    setError(null);
    try {
      const response = await fetch(`/api/admin/department-admins/${userId}/${departmentId}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        setError("Could not remove admin");
        setRemovingId(null);
        return;
      }
      setRemovingId(null);
      router.refresh();
    } catch {
      setError("Could not remove admin");
      setRemovingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Select value={selectedUserId} onValueChange={(value) => setSelectedUserId(value as string)}>
          <SelectTrigger className="min-w-56">
            <SelectValue placeholder={eligibleUsers.length === 0 ? "No eligible users" : "Choose a user"} />
          </SelectTrigger>
          <SelectContent>
            {eligibleUsers.map((user) => (
              <SelectItem key={user.id} value={user.id}>
                {user.displayName} ({user.email})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button onClick={handleAdd} disabled={!selectedUserId || adding}>
          {adding ? "Adding…" : "Add"}
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <p className="text-xs text-muted-foreground">
        Only users currently holding the Department Admin role in Entra are eligible.
      </p>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {admins.length === 0 ? (
            <TableRow>
              <TableCell colSpan={3} className="text-center text-sm text-muted-foreground">
                No admins assigned yet.
              </TableCell>
            </TableRow>
          ) : (
            admins.map((admin) => (
              <TableRow key={admin.userId}>
                <TableCell className="font-medium">{admin.displayName}</TableCell>
                <TableCell>{admin.email}</TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Remove as department admin"
                    disabled={removingId === admin.userId}
                    onClick={() => handleRemove(admin.userId)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
