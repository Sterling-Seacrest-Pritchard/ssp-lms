"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  FileArchive,
  Loader2,
  UploadCloud,
  X,
  AlertCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { cn, formatBytes } from "@/lib/utils";

export default function UploadScormPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [courseCode, setCourseCode] = useState("");
  const [courseTitle, setCourseTitle] = useState("");
  const [moduleTitle, setModuleTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function pickFile(candidate: File | null) {
    if (candidate && !/\.zip$/i.test(candidate.name)) {
      setError("That doesn't look like a .zip file — SCORM packages must be zipped.");
      return;
    }
    setError(null);
    setFile(candidate);
  }

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
        <Link
          href="/admin/content"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Content Authoring
        </Link>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">Upload SCORM Package</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Upload a SCORM 1.2 or SCORM 2004 .zip package exported from Articulate, Captivate,
          iSpring, or any other authoring tool.
        </p>
      </div>

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle className="text-base">Package Details</CardTitle>
          <CardDescription>Tell us what this module is, then drop the package in.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="courseCode">Course Code</Label>
                <Input
                  id="courseCode"
                  value={courseCode}
                  onChange={(e) => setCourseCode(e.target.value)}
                  placeholder="COMPLIANCE-2026-Q1"
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="moduleTitle">Module Title</Label>
                <Input
                  id="moduleTitle"
                  value={moduleTitle}
                  onChange={(e) => setModuleTitle(e.target.value)}
                  placeholder="Introduction"
                  required
                />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="courseTitle">Course Title</Label>
              <Input
                id="courseTitle"
                value={courseTitle}
                onChange={(e) => setCourseTitle(e.target.value)}
                placeholder="Q1 Compliance Training"
                required
              />
            </div>

            <Separator />

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="package">SCORM Package</Label>
              <input
                ref={fileInputRef}
                id="package"
                type="file"
                accept=".zip,application/zip"
                className="sr-only"
                onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
              />

              <div
                role="button"
                tabIndex={0}
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click();
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragActive(true);
                }}
                onDragLeave={() => setDragActive(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragActive(false);
                  pickFile(e.dataTransfer.files?.[0] ?? null);
                }}
                className={cn(
                  "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors",
                  dragActive
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/50 hover:bg-muted/40"
                )}
              >
                {file ? (
                  <div
                    className="flex w-full max-w-sm items-center gap-3 rounded-md border bg-card px-3 py-2.5 text-left shadow-sm"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <FileArchive className="h-8 w-8 shrink-0 text-primary" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{file.name}</p>
                      <p className="text-xs text-muted-foreground">{formatBytes(file.size)}</p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Remove file"
                      onClick={() => pickFile(null)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <>
                    <UploadCloud className="h-8 w-8 text-muted-foreground" />
                    <p className="text-sm font-medium">
                      Drop a .zip file here, or{" "}
                      <span className="text-primary">browse</span>
                    </p>
                    <p className="text-xs text-muted-foreground">SCORM 1.2 or 2004, up to ~50MB</p>
                  </>
                )}
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <Button type="submit" disabled={submitting} className="self-start">
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <UploadCloud className="h-4 w-4" />
              )}
              {submitting ? "Uploading…" : "Upload and Launch"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
