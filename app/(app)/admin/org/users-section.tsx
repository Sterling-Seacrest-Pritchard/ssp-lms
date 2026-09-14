"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, RefreshCw, UserPlus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { UserWithStatus, AssignedCourse } from "@/lib/db/course-assignments";

interface CourseOption {
  id: string;
  title: string;
  code: string;
}

export function UsersSection() {
  const [users, setUsers] = useState<UserWithStatus[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [manageUser, setManageUser] = useState<UserWithStatus | null>(null);
  const [page, setPage] = useState(1);
  const pageSize = 20;

  async function loadUsers() {
    setLoadError(null);
    try {
      const response = await fetch("/api/admin/users");
      const body = await response.json();
      if (!response.ok) {
        setLoadError(body.error ?? "Could not load users");
        return;
      }
      setUsers(body.users);
    } catch {
      setLoadError("Could not load users");
    }
  }

  useEffect(() => {
    loadUsers();
  }, []);

  async function handleSync() {
    setSyncing(true);
    setSyncError(null);
    setSyncResult(null);
    const response = await fetch("/api/admin/entra-sync", { method: "POST" });
    const body = await response.json();
    if (!response.ok) {
      setSyncError(body.error ?? "Sync failed");
      setSyncing(false);
      return;
    }
    setSyncResult(`${body.total} assigned in Entra — ${body.created} new, ${body.updated} updated`);
    setSyncing(false);
    loadUsers();
  }

  const filtered = users?.filter(
    (u) =>
      u.displayName.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase())
  );

  // Reset to page 1 whenever the search narrows/widens the result set, so a
  // stale page number never lands on an out-of-range, empty page.
  useEffect(() => {
    setPage(1);
  }, [search]);

  const totalPages = filtered ? Math.max(1, Math.ceil(filtered.length / pageSize)) : 1;
  const pageStart = (page - 1) * pageSize;
  const paged = useMemo(() => filtered?.slice(pageStart, pageStart + pageSize), [filtered, pageStart]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Users</CardTitle>
        <Button type="button" size="sm" variant="outline" onClick={handleSync} disabled={syncing}>
          {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Sync from Entra
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {syncResult && <p className="text-sm text-muted-foreground">{syncResult}</p>}
        {syncError && <p className="text-sm text-destructive">{syncError}</p>}
        {loadError && <p className="text-sm text-destructive">{loadError}</p>}
        <Input
          placeholder="Search by name or email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Courses</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!paged || paged.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-sm text-muted-foreground">
                  {users === null ? "Loading…" : "No users found."}
                </TableCell>
              </TableRow>
            ) : (
              paged.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">
                    {u.displayName}
                    {u.entraRole && (
                      <span className="ml-2 text-xs font-normal text-muted-foreground">{u.entraRole}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{u.email}</TableCell>
                  <TableCell>
                    <Badge variant={u.status === "active" ? "secondary" : "outline"}>
                      {u.status === "active" ? "Active" : "Not yet signed in"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button type="button" size="sm" variant="ghost" onClick={() => setManageUser(u)}>
                      <UserPlus className="h-4 w-4" />
                      Assign
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        {filtered && filtered.length > 0 && (
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
              {pageStart + 1}–{Math.min(pageStart + pageSize, filtered.length)} of {filtered.length}
            </span>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
              >
                <ChevronLeft className="h-4 w-4" />
                Prev
              </Button>
              <span>
                Page {page} of {totalPages}
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </CardContent>

      <Dialog open={manageUser !== null} onOpenChange={(open) => !open && setManageUser(null)}>
        <DialogContent>
          {manageUser && <ManageAssignments user={manageUser} />}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function ManageAssignments({ user }: { user: UserWithStatus }) {
  const [assignments, setAssignments] = useState<AssignedCourse[] | null>(null);
  const [courses, setCourses] = useState<CourseOption[] | null>(null);
  const [selectedCourseId, setSelectedCourseId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const [assignmentsRes, coursesRes] = await Promise.all([
      fetch(`/api/admin/users/${user.id}/assignments`),
      fetch("/api/admin/courses/list"),
    ]);
    const assignmentsBody = await assignmentsRes.json();
    const coursesBody = await coursesRes.json();
    setAssignments(assignmentsBody.assignments ?? []);
    setCourses(coursesBody.courses ?? []);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id]);

  async function handleAssign() {
    if (!selectedCourseId) return;
    setBusy(true);
    setError(null);
    const response = await fetch(`/api/admin/users/${user.id}/assignments`, {
      method: "POST",
      body: JSON.stringify({ courseId: selectedCourseId }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(body.error ?? "Could not assign course");
      setBusy(false);
      return;
    }
    setSelectedCourseId("");
    setBusy(false);
    load();
  }

  async function handleUnassign(courseId: string) {
    setBusy(true);
    await fetch(`/api/admin/users/${user.id}/assignments/${courseId}`, { method: "DELETE" });
    setBusy(false);
    load();
  }

  const assignedIds = new Set((assignments ?? []).map((a) => a.courseId));
  const availableCourses = (courses ?? []).filter((c) => !assignedIds.has(c.id));

  return (
    <div className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>Assign Courses — {user.displayName}</DialogTitle>
      </DialogHeader>

      <div className="flex flex-col gap-2">
        {assignments === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : assignments.length === 0 ? (
          <p className="text-sm text-muted-foreground">No courses assigned yet.</p>
        ) : (
          assignments.map((a) => (
            <div key={a.courseId} className="flex items-center justify-between rounded-lg border px-3 py-2">
              <span className="text-sm font-medium">{a.title}</span>
              <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => handleUnassign(a.courseId)}>
                Remove
              </Button>
            </div>
          ))
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex gap-2">
        <select
          className="flex-1 rounded-md border bg-background px-3 py-2 text-sm"
          value={selectedCourseId}
          onChange={(e) => setSelectedCourseId(e.target.value)}
        >
          <option value="">Choose a course…</option>
          {availableCourses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
        <Button type="button" onClick={handleAssign} disabled={!selectedCourseId || busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Assign
        </Button>
      </div>
    </div>
  );
}
