"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { CourseStatusRow, MemberProgressRow } from "@/lib/db/member-progress";

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

  const filtered = members.filter((m) => {
    const matchesSearch =
      m.displayName.toLowerCase().includes(search.toLowerCase()) || m.email.toLowerCase().includes(search.toLowerCase());
    return matchesSearch && (!overdueOnly || m.overdueCount > 0);
  });

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
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead className="text-right">Completed / Total</TableHead>
              <TableHead className="text-right">Overdue</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-sm text-muted-foreground">
                  No members match.
                </TableCell>
              </TableRow>
            ) : (
              filtered.flatMap((member) => {
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
                              <TableRow>
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
                                  <TableCell>{row.courseTitle}</TableCell>
                                  <TableCell>{row.status}</TableCell>
                                  <TableCell>{row.dueAt ?? "—"}</TableCell>
                                  <TableCell>{row.completedAt ?? "—"}</TableCell>
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
      </CardContent>
    </Card>
  );
}
