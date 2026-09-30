"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { CourseStatusRow, MemberProgressRow } from "@/lib/db/member-progress";

function formatStatus(status: string): string {
  return status
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export function MemberProgress({
  members,
  exportHref,
}: {
  members: MemberProgressRow[];
  exportHref: string;
}) {
  const [search, setSearch] = useState("");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const [courseRowsByUser, setCourseRowsByUser] = useState<Record<string, CourseStatusRow[] | "loading" | "error">>({});
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const filtered = members.filter((m) => {
    const matchesSearch =
      m.displayName.toLowerCase().includes(search.toLowerCase()) || m.email.toLowerCase().includes(search.toLowerCase());
    return matchesSearch && (!overdueOnly || m.overdueCount > 0);
  });

  // Reset to page 1 whenever search/filter narrows or widens the result
  // set, so a stale page number never lands on an out-of-range, empty page.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resets pagination in response to a filter change, not a derivable render value
    setPage(1);
  }, [search, overdueOnly]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageStart = (page - 1) * pageSize;
  const paged = useMemo(() => filtered.slice(pageStart, pageStart + pageSize), [filtered, pageStart]);

  async function toggleExpand(userId: string) {
    if (expandedUserId === userId) {
      setExpandedUserId(null);
      return;
    }
    setExpandedUserId(userId);
    if (courseRowsByUser[userId] !== undefined) return;

    setCourseRowsByUser((prev) => ({ ...prev, [userId]: "loading" }));
    try {
      const response = await fetch(`/api/admin/reports/members/${userId}/courses`);
      if (!response.ok) throw new Error("request failed");
      const body = await response.json();
      setCourseRowsByUser((prev) => ({ ...prev, [userId]: body.rows }));
    } catch {
      setCourseRowsByUser((prev) => ({ ...prev, [userId]: "error" }));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Member Progress</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center gap-4">
          <Input
            placeholder="Search by name or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-xs"
          />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} />
            Needs attention (overdue only)
          </label>
          <a href={exportHref} download className="ml-auto text-sm text-primary underline">
            Export CSV
          </a>
        </div>

        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead className="text-right">Completed / Total</TableHead>
              <TableHead className="text-right">Overdue</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paged.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-sm text-muted-foreground">
                  No members match.
                </TableCell>
              </TableRow>
            ) : (
              paged.flatMap((member) => {
                const rows = [
                  <TableRow
                    key={member.userId}
                    className="cursor-pointer"
                    onClick={() => toggleExpand(member.userId)}
                  >
                    <TableCell className="font-medium">{member.displayName}</TableCell>
                    <TableCell>{member.email}</TableCell>
                    <TableCell className="text-right">
                      {member.completedCount} / {member.totalAssigned}
                    </TableCell>
                    <TableCell className="text-right">{member.overdueCount}</TableCell>
                  </TableRow>,
                ];
                if (expandedUserId === member.userId) {
                  const detail = courseRowsByUser[member.userId];
                  rows.push(
                    <TableRow key={`${member.userId}-detail`}>
                      <TableCell colSpan={4} className="bg-muted/30">
                        {detail === "loading" || detail === undefined ? (
                          <p className="text-sm text-muted-foreground">Loading…</p>
                        ) : detail === "error" ? (
                          <p className="text-sm text-destructive">Could not load this member&apos;s courses.</p>
                        ) : detail.length === 0 ? (
                          <p className="text-sm text-muted-foreground">No courses assigned.</p>
                        ) : (
                          <Table>
                            <TableHeader>
                              <TableRow className="bg-muted/40 hover:bg-muted/40">
                                <TableHead>Course</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead>Due</TableHead>
                                <TableHead>Completed</TableHead>
                                <TableHead className="text-right">Overdue</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {detail.map((row) => (
                                <TableRow key={row.courseId}>
                                  <TableCell className="font-medium">{row.courseTitle}</TableCell>
                                  <TableCell>{formatStatus(row.status)}</TableCell>
                                  <TableCell>{formatDate(row.dueAt)}</TableCell>
                                  <TableCell>{formatDate(row.completedAt)}</TableCell>
                                  <TableCell className="text-right">{row.overdue ? "Yes" : "No"}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                }
                return rows;
              })
            )}
          </TableBody>
        </Table>
        {filtered.length > 0 && (
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
    </Card>
  );
}
