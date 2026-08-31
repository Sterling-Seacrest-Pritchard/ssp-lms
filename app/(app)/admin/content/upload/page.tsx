"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Upload } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function UploadScormPage() {
  const router = useRouter();
  const [courseCode, setCourseCode] = useState("");
  const [courseTitle, setCourseTitle] = useState("");
  const [moduleTitle, setModuleTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setError("Choose a SCORM .zip package to upload");
      return;
    }
    setSubmitting(true);
    setError(null);

    const form = new FormData();
    form.set("package", file);
    form.set("courseCode", courseCode);
    form.set("courseTitle", courseTitle);
    form.set("moduleTitle", moduleTitle);

    try {
      const response = await fetch("/api/admin/scorm-upload", {
        method: "POST",
        body: form,
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error ?? "Upload failed");
        setSubmitting(false);
        return;
      }
      router.push(`/admin/scorm-test/${body.moduleVersionId}`);
    } catch {
      setError("Upload failed — check your connection and try again");
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <Link href="/admin/content" className="text-sm text-muted-foreground hover:underline">
          &larr; Back to Content Authoring
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Upload SCORM Package</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Upload a SCORM 1.2 or SCORM 2004 .zip package exported from Articulate, Captivate,
          iSpring, or any other authoring tool.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Package Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="courseCode">Course Code</Label>
              <Input
                id="courseCode"
                value={courseCode}
                onChange={(e) => setCourseCode(e.target.value)}
                placeholder="e.g. COMPLIANCE-2026-Q1"
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="courseTitle">Course Title</Label>
              <Input
                id="courseTitle"
                value={courseTitle}
                onChange={(e) => setCourseTitle(e.target.value)}
                placeholder="e.g. Q1 Compliance Training"
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="moduleTitle">Module Title</Label>
              <Input
                id="moduleTitle"
                value={moduleTitle}
                onChange={(e) => setModuleTitle(e.target.value)}
                placeholder="e.g. Introduction"
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="package">SCORM Package (.zip)</Label>
              <Input
                id="package"
                type="file"
                accept=".zip,application/zip"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                required
              />
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <Button type="submit" disabled={submitting} className="mt-2 self-start">
              <Upload className="h-4 w-4" />
              {submitting ? "Uploading…" : "Upload and Launch"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
