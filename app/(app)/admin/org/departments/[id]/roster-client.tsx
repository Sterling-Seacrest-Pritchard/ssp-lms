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

interface RosterMember {
  id: string;
  email: string;
  displayName: string;
}

interface EligibleUser extends RosterMember {
  currentDepartmentName: string | null;
}

export function RosterClient({
  departmentId,
  members,
  eligibleUsers,
}: {
  departmentId: string;
  members: RosterMember[];
  eligibleUsers: EligibleUser[];
}) {
  const router = useRouter();
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectItems = eligibleUsers.map((user) => ({ value: user.id, label: user.displayName }));

  async function handleAdd() {
    if (selectedUserIds.length === 0) return;
    setAdding(true);
    setError(null);
    try {
      const results = await Promise.all(
        selectedUserIds.map((userId) =>
          fetch(`/api/admin/departments/${departmentId}/members`, {
            method: "PATCH",
            body: JSON.stringify({ userId }),
          })
        )
      );
      const failed = results.some((response) => !response.ok);
      if (failed) {
        setError("Could not add one or more members");
        setAdding(false);
        return;
      }
      setSelectedUserIds([]);
      setAdding(false);
      router.refresh();
    } catch {
      setError("Could not add member");
      setAdding(false);
    }
  }

  async function handleRemove(userId: string) {
    setRemovingId(userId);
    setError(null);
    try {
      const response = await fetch(`/api/admin/departments/${departmentId}/members`, {
        method: "DELETE",
        body: JSON.stringify({ userId }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setError(body?.error ?? "Could not remove member");
        setRemovingId(null);
        return;
      }
      setRemovingId(null);
      router.refresh();
    } catch {
      setError("Could not remove member");
      setRemovingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Select
          items={selectItems}
          multiple
          value={selectedUserIds}
          onValueChange={(value) => setSelectedUserIds(value)}
        >
          <SelectTrigger className="min-w-56">
            <SelectValue placeholder={eligibleUsers.length === 0 ? "No eligible users" : "Choose one or more users"} />
          </SelectTrigger>
          <SelectContent>
            {eligibleUsers.map((user) => (
              <SelectItem key={user.id} value={user.id}>
                {user.displayName} ({user.email})
                {user.currentDepartmentName ? ` — currently in ${user.currentDepartmentName}` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button onClick={handleAdd} disabled={selectedUserIds.length === 0 || adding}>
          {adding ? "Adding…" : selectedUserIds.length > 1 ? `Add ${selectedUserIds.length}` : "Add"}
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {members.length === 0 ? (
            <TableRow>
              <TableCell colSpan={3} className="text-center text-sm text-muted-foreground">
                No members yet.
              </TableCell>
            </TableRow>
          ) : (
            members.map((member) => (
              <TableRow key={member.id}>
                <TableCell className="font-medium">{member.displayName}</TableCell>
                <TableCell>{member.email}</TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Remove from department"
                    disabled={removingId === member.id}
                    onClick={() => handleRemove(member.id)}
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
