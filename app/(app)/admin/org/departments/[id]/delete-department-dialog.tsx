"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

const CONFIRM_PHRASE = "DELETE";

export function DeleteDepartmentDialog({ departmentId }: { departmentId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/departments/${departmentId}`, { method: "DELETE" });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setError(body?.error ?? "Could not delete this department");
        setSubmitting(false);
        return;
      }
      router.push("/admin/org");
      router.refresh();
    } catch {
      setError("Could not delete this department");
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setConfirmText("");
          setError(null);
        }
      }}
    >
      <DialogTrigger
        render={
          <Button variant="destructive">
            <Trash2 className="h-4 w-4" />
            Delete Department
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete this department?</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 pt-2">
          <p className="text-sm text-muted-foreground">
            This permanently removes the department, its course assignments, and its department-admin
            assignments. Members and courses currently assigned to it are unassigned, not deleted - their
            history is kept. This cannot be undone.
          </p>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="confirmDelete">
              Type <span className="font-mono font-semibold">{CONFIRM_PHRASE}</span> to confirm
            </Label>
            <Input
              id="confirmDelete"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              autoComplete="off"
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button
            variant="destructive"
            disabled={confirmText !== CONFIRM_PHRASE || submitting}
            onClick={handleDelete}
          >
            {submitting ? "Deleting…" : "Delete Department"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
