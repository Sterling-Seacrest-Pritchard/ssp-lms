"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface DepartmentOption {
  id: string;
  name: string;
}

type Scope = "all" | "department";

export function BroadcastComposeClient({
  isOrgAdmin,
  departments,
}: {
  isOrgAdmin: boolean;
  departments: DepartmentOption[];
}) {
  const scopeItems = isOrgAdmin
    ? [
        { value: "all", label: "All users" },
        { value: "department", label: "A department" },
      ]
    : [{ value: "department", label: "A department" }];
  const departmentItems = departments.map((d) => ({ value: d.id, label: d.name }));

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [scope, setScope] = useState<Scope>(isOrgAdmin ? "all" : "department");
  const [departmentId, setDepartmentId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recipientCount, setRecipientCount] = useState<number | null>(null);

  // A Department Admin with no department of their own has nothing valid to
  // send to - "all" is Org-Admin-only server-side, and "department" needs a
  // department they actually administer. Matches /admin/department's own
  // empty-state treatment.
  if (!isOrgAdmin && departments.length === 0) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col items-center gap-2 py-16 text-center">
        <h1 className="text-xl font-semibold">No department assigned yet</h1>
        <p className="text-sm text-muted-foreground">
          You&apos;re not the Department Admin of any department yet, so there&apos;s no
          audience to send a broadcast to. Ask an Org Admin to add you from the Org Admin page.
        </p>
      </div>
    );
  }

  const canSubmit =
    title.trim().length > 0 &&
    body.trim().length > 0 &&
    (scope === "all" || (scope === "department" && !!departmentId)) &&
    !submitting;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    setRecipientCount(null);
    try {
      const response = await fetch("/api/admin/notifications/broadcast", {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          body: body.trim(),
          targetScope: scope,
          ...(scope === "department" && departmentId ? { targetDepartmentId: departmentId } : {}),
        }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        setError(result?.error ?? "Could not send broadcast");
        setSubmitting(false);
        return;
      }
      setRecipientCount(result?.recipientCount ?? 0);
      setTitle("");
      setBody("");
      setDepartmentId(null);
      setSubmitting(false);
    } catch {
      setError("Could not send broadcast");
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Notifications</h1>
        <p className="text-sm text-muted-foreground">Compose a broadcast notification.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">New broadcast</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="broadcast-title">Title</Label>
            <Input
              id="broadcast-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Title"
              maxLength={200}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="broadcast-body">Message</Label>
            <Textarea
              id="broadcast-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Message"
              rows={5}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Send to</Label>
            <Select
              items={scopeItems}
              value={scope}
              onValueChange={(value) => {
                const next = value as Scope;
                setScope(next);
                if (next === "all") setDepartmentId(null);
              }}
            >
              <SelectTrigger className="min-w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {scopeItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {scope === "department" && (
            <div className="flex flex-col gap-1.5">
              <Label>Department</Label>
              <Select
                items={departmentItems}
                value={departmentId}
                onValueChange={(value) => setDepartmentId(value as string)}
              >
                <SelectTrigger className="min-w-56">
                  <SelectValue
                    placeholder={departments.length === 0 ? "No departments available" : "Choose a department"}
                  />
                </SelectTrigger>
                <SelectContent>
                  {departments.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
          {recipientCount !== null && (
            <p className="text-sm text-muted-foreground">
              Sent to {recipientCount} recipient{recipientCount === 1 ? "" : "s"}.
            </p>
          )}

          <div>
            <Button onClick={handleSubmit} disabled={!canSubmit}>
              {submitting ? "Sending…" : "Send broadcast"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
