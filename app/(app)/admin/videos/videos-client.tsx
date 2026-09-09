"use client";

import { useEffect, useState } from "react";
import { Loader2, PlayCircle, Trash2, Upload } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { LibraryVideo } from "@/lib/video/assets";

function statusBadge(status: string) {
  if (status === "ready") return <Badge variant="secondary">Ready</Badge>;
  if (status === "errored") return <Badge variant="destructive">Errored</Badge>;
  return <Badge variant="outline">{status}</Badge>;
}

export function VideosClient() {
  const [videos, setVideos] = useState<LibraryVideo[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);

  async function load() {
    setLoadError(null);
    try {
      const response = await fetch("/api/admin/videos");
      const body = await response.json();
      if (!response.ok) {
        setLoadError(body.error ?? "Could not load the Video Library");
        return;
      }
      setVideos(body.videos);
    } catch {
      setLoadError("Could not load the Video Library");
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setUploadError("Choose a video file to upload");
      return;
    }
    setUploading(true);
    setUploadError(null);
    setUploadStatus("waiting");

    const createResponse = await fetch("/api/admin/videos", {
      method: "POST",
      body: JSON.stringify({ title }),
    });
    const createBody = await createResponse.json();
    if (!createResponse.ok) {
      setUploadError(createBody.error ?? "Could not start the upload");
      setUploading(false);
      setUploadStatus(null);
      return;
    }

    const putResponse = await fetch(createBody.uploadUrl, { method: "PUT", body: file });
    if (!putResponse.ok) {
      setUploadError("Upload to Mux failed");
      setUploading(false);
      setUploadStatus(null);
      return;
    }

    setUploadStatus("preparing");
    const { videoAssetId } = createBody;
    const MAX_POLL_ATTEMPTS = 100;
    const MAX_CONSECUTIVE_FAILURES = 5;
    let attempts = 0;
    let consecutiveFailures = 0;
    const poll = async () => {
      attempts += 1;
      let statusBody: { status?: string; error?: string } | undefined;
      try {
        const statusResponse = await fetch(`/api/admin/videos/${videoAssetId}/status`);
        statusBody = await statusResponse.json();
        if (!statusResponse.ok) {
          throw new Error(statusBody?.error ?? "Status check failed");
        }
      } catch {
        consecutiveFailures += 1;
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          setUploadError("Lost connection while checking upload status. Reload the page to check on it.");
          setUploading(false);
          return;
        }
        setTimeout(poll, 3000);
        return;
      }
      consecutiveFailures = 0;

      if (statusBody?.status === "ready" || statusBody?.status === "errored") {
        setUploadStatus(statusBody.status);
        setUploading(false);
        if (statusBody.status === "ready") {
          setTitle("");
          setFile(null);
          setUploadOpen(false);
          load();
        }
        return;
      }

      if (attempts >= MAX_POLL_ATTEMPTS) {
        setUploadError("Upload is taking longer than expected — check back later or reload.");
        setUploading(false);
        return;
      }

      setUploadStatus(statusBody?.status ?? null);
      setTimeout(poll, 3000);
    };
    poll();
  }

  async function handleRename(video: LibraryVideo) {
    if (!renameValue.trim()) return;
    const response = await fetch(`/api/admin/videos/${video.id}`, {
      method: "PATCH",
      body: JSON.stringify({ title: renameValue.trim() }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setRowError({ id: video.id, message: body.error ?? "Could not rename" });
      return;
    }
    setRenamingId(null);
    load();
  }

  async function handleDelete(video: LibraryVideo) {
    setDeletingId(video.id);
    setRowError(null);
    const response = await fetch(`/api/admin/videos/${video.id}`, { method: "DELETE" });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setRowError({ id: video.id, message: body.error ?? "Could not delete" });
      setDeletingId(null);
      return;
    }
    setDeletingId(null);
    load();
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Video Library</h1>
          <p className="text-sm text-muted-foreground">
            Every video in Mux, reusable across any course module. Add existing videos to a
            module from the course builder.
          </p>
        </div>
        <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
          <DialogTrigger
            render={
              <Button type="button">
                <Upload className="h-4 w-4" />
                Upload Video
              </Button>
            }
          />
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Upload Video</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleUpload} className="flex flex-col gap-4 pt-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="libraryVideoTitle">Title</Label>
                <Input
                  id="libraryVideoTitle"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="libraryVideoFile">Video File</Label>
                <input
                  id="libraryVideoFile"
                  type="file"
                  accept="video/*"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
                {file && (
                  <p className="flex items-center gap-2 text-xs text-muted-foreground">
                    <PlayCircle className="h-3.5 w-3.5" />
                    {file.name}
                  </p>
                )}
              </div>
              {uploadStatus && (
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  {uploading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Status: {uploadStatus}
                </p>
              )}
              {uploadError && <p className="text-sm text-destructive">{uploadError}</p>}
              <Button type="submit" disabled={uploading}>
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {uploading ? "Uploading…" : "Upload"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {loadError && <p className="text-sm text-destructive">{loadError}</p>}
      {videos === null && !loadError && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading videos…
        </p>
      )}
      {videos?.length === 0 && (
        <p className="text-sm text-muted-foreground">No videos yet — upload one to get started.</p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {videos?.map((video) => (
          <Card key={video.id}>
            <div className="flex h-32 items-center justify-center rounded-t-xl bg-slate-900">
              <PlayCircle className="h-10 w-10 text-white/70" />
            </div>
            <CardHeader>
              {renamingId === video.id ? (
                <div className="flex gap-2">
                  <Input
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleRename(video);
                      if (e.key === "Escape") setRenamingId(null);
                    }}
                  />
                  <Button type="button" size="sm" onClick={() => handleRename(video)}>
                    Save
                  </Button>
                </div>
              ) : (
                <CardTitle
                  className="cursor-pointer text-sm leading-snug hover:underline"
                  onClick={() => {
                    setRenamingId(video.id);
                    setRenameValue(video.title);
                  }}
                >
                  {video.title}
                </CardTitle>
              )}
              <p className="text-xs text-muted-foreground">
                {video.moduleCount > 0
                  ? `Used in ${video.moduleCount} module${video.moduleCount === 1 ? "" : "s"}`
                  : "Not used in any module"}
              </p>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  {video.durationSeconds ? `${Math.round(video.durationSeconds / 60)} min` : "—"}
                </span>
                {statusBadge(video.status)}
              </div>
              {rowError?.id === video.id && <p className="text-xs text-destructive">{rowError.message}</p>}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={video.moduleCount > 0 || deletingId === video.id}
                onClick={() => handleDelete(video)}
                title={video.moduleCount > 0 ? "Remove this video from every module first" : "Delete"}
              >
                {deletingId === video.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4 text-destructive" />
                )}
                Delete
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
