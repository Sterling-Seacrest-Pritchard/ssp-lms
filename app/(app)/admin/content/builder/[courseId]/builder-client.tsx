"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  FileArchive,
  GripVertical,
  Loader2,
  PlayCircle,
  Trash2,
  UploadCloud,
} from "lucide-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { CourseForBuilder, BuilderModule } from "@/lib/db/queries";

function ModuleRow({
  module,
  onRemove,
}: {
  module: BuilderModule;
  onRemove: (moduleId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: module.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2.5"
    >
      <button
        type="button"
        className="cursor-grab text-muted-foreground touch-none"
        aria-label="Drag to reorder"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <div className="flex-1">
        <p className="text-sm font-medium">{module.title}</p>
      </div>
      <Badge variant="outline" className="text-[10px] uppercase">
        {module.moduleType}
      </Badge>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Remove module"
        onClick={() => onRemove(module.id)}
      >
        <Trash2 className="h-4 w-4 text-destructive" />
      </Button>
    </div>
  );
}

export function BuilderClient({
  initialCourse,
  departments,
}: {
  initialCourse: CourseForBuilder;
  departments: { id: string; name: string }[];
}) {
  const [course, setCourse] = useState(initialCourse);
  const [addModuleOpen, setAddModuleOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [videoTitle, setVideoTitle] = useState("");
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUploading, setVideoUploading] = useState(false);
  const [videoStatus, setVideoStatus] = useState<string | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [scormFile, setScormFile] = useState<File | null>(null);
  const [scormTitle, setScormTitle] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // KeyboardSensor alongside the pointer one so the drag handle - already a
  // focusable <button> carrying the dnd-kit activator props - can reorder
  // modules with Space/Enter + arrow keys. Without it, reordering was
  // mouse/touch-only.
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  async function patchDetails(fields: Record<string, unknown>) {
    await fetch(`/api/admin/courses/${course.id}`, {
      method: "PATCH",
      body: JSON.stringify(fields),
    });
  }

  function updateField<K extends keyof CourseForBuilder>(key: K, value: CourseForBuilder[K]) {
    setCourse((prev) => ({ ...prev, [key]: value }));
  }

  async function handleRemoveModule(moduleId: string) {
    setCourse((prev) => ({ ...prev, modules: prev.modules.filter((m) => m.id !== moduleId) }));
    await fetch(`/api/admin/courses/${course.id}/modules/${moduleId}`, { method: "DELETE" });
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = course.modules.findIndex((m) => m.id === active.id);
    const newIndex = course.modules.findIndex((m) => m.id === over.id);
    const reordered = arrayMove(course.modules, oldIndex, newIndex);
    setCourse((prev) => ({ ...prev, modules: reordered }));

    await fetch(`/api/admin/courses/${course.id}/modules/reorder`, {
      method: "PATCH",
      body: JSON.stringify({ moduleIds: reordered.map((m) => m.id) }),
    });
  }

  async function handleAddVideo(e: React.FormEvent) {
    e.preventDefault();
    if (!videoFile) {
      setVideoError("Choose a video file to upload");
      return;
    }
    setVideoUploading(true);
    setVideoError(null);
    setVideoStatus("waiting");

    const createResponse = await fetch(`/api/admin/courses/${course.id}/modules/video`, {
      method: "POST",
      body: JSON.stringify({ title: videoTitle }),
    });
    const createBody = await createResponse.json();
    if (!createResponse.ok) {
      setVideoError(createBody.error ?? "Could not start the upload");
      setVideoUploading(false);
      setVideoStatus(null);
      return;
    }

    const putResponse = await fetch(createBody.uploadUrl, { method: "PUT", body: videoFile });
    if (!putResponse.ok) {
      setVideoError("Upload to Mux failed");
      setVideoUploading(false);
      setVideoStatus(null);
      return;
    }

    setVideoStatus("preparing");
    const { moduleId } = createBody;
    // Mux processing is usually done in well under a minute, but give it
    // plenty of headroom before giving up: 100 attempts * 3s = 5 minutes.
    const MAX_POLL_ATTEMPTS = 100;
    // A handful of consecutive transient network failures shouldn't kill the
    // whole poll loop, but a persistent failure should surface, not spin
    // forever.
    const MAX_CONSECUTIVE_FAILURES = 5;
    let attempts = 0;
    let consecutiveFailures = 0;
    const poll = async () => {
      attempts += 1;
      let statusBody: { status?: string; error?: string } | undefined;
      try {
        const statusResponse = await fetch(`/api/admin/courses/${course.id}/modules/${moduleId}/video-status`);
        statusBody = await statusResponse.json();
        if (!statusResponse.ok) {
          throw new Error(statusBody?.error ?? "Status check failed");
        }
      } catch {
        consecutiveFailures += 1;
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          setVideoError("Lost connection while checking upload status. Reload the page to check on it.");
          setVideoUploading(false);
          return;
        }
        setTimeout(poll, 3000);
        return;
      }
      consecutiveFailures = 0;

      if (statusBody?.status === "ready" || statusBody?.status === "errored") {
        setVideoStatus(statusBody.status);
        setVideoUploading(false);
        if (statusBody.status === "ready") {
          setVideoTitle("");
          setVideoFile(null);
          setAddModuleOpen(false);
          window.location.reload();
        }
        return;
      }

      if (attempts >= MAX_POLL_ATTEMPTS) {
        setVideoError("Upload is taking longer than expected — check back later or reload.");
        setVideoUploading(false);
        return;
      }

      setVideoStatus(statusBody?.status ?? null);
      setTimeout(poll, 3000);
    };
    poll();
  }

  async function handleUploadScorm(e: React.FormEvent) {
    e.preventDefault();
    if (!scormFile) {
      setUploadError("Choose a SCORM .zip package to upload");
      return;
    }
    setUploading(true);
    setUploadError(null);
    const form = new FormData();
    form.set("package", scormFile);
    form.set("courseId", course.id);
    form.set("moduleTitle", scormTitle);

    const response = await fetch("/api/admin/scorm-upload", { method: "POST", body: form });
    const body = await response.json();
    if (!response.ok) {
      setUploadError(body.error ?? "Upload failed");
      setUploading(false);
      return;
    }
    setScormFile(null);
    setScormTitle("");
    setUploading(false);
    setAddModuleOpen(false);
    window.location.reload();
  }

  async function handlePublish() {
    setPublishing(true);
    setPublishError(null);
    const response = await fetch(`/api/admin/courses/${course.id}/publish`, { method: "POST" });
    const body = await response.json();
    if (!response.ok) {
      setPublishError(body.error ?? "Could not publish");
      setPublishing(false);
      return;
    }
    setCourse((prev) => ({ ...prev, status: "published" }));
    setPublishing(false);
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <Link
            href="/admin/content"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Content Authoring
          </Link>
          <div className="mt-2 flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{course.title}</h1>
            <Badge variant={course.status === "published" ? "secondary" : "outline"}>
              {course.status === "published" ? "Published" : "Draft"}
            </Badge>
          </div>
        </div>
        <Button
          onClick={handlePublish}
          disabled={publishing || course.modules.length === 0}
        >
          {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {course.status === "published" ? "Republish" : "Publish"}
        </Button>
      </div>
      {publishError && <p className="text-sm text-destructive">{publishError}</p>}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Course Details</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                value={course.title}
                onChange={(e) => updateField("title", e.target.value)}
                onBlur={() => patchDetails({ title: course.title })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="code">Course Code</Label>
              <Input
                id="code"
                value={course.code}
                onChange={(e) => updateField("code", e.target.value)}
                onBlur={() => patchDetails({ code: course.code })}
              />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="department">Department</Label>
              <Select
                value={course.departmentId ?? "none"}
                items={[
                  { value: "none", label: "General" },
                  ...departments.map((dept) => ({ value: dept.id, label: dept.name })),
                ]}
                onValueChange={(value) => {
                  const departmentId = value === "none" ? null : (value as string);
                  updateField("departmentId", departmentId);
                  patchDetails({ departmentId });
                }}
              >
                <SelectTrigger id="department" className="w-full">
                  <SelectValue placeholder="General" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">General</SelectItem>
                  {departments.map((dept) => (
                    <SelectItem key={dept.id} value={dept.id}>
                      {dept.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="dueDate">Due Date (optional)</Label>
              <Input
                id="dueDate"
                type="date"
                value={course.dueDate ? course.dueDate.slice(0, 10) : ""}
                onChange={(e) => updateField("dueDate", e.target.value || null)}
                onBlur={() => patchDetails({ dueDate: course.dueDate })}
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="compliance"
              checked={course.compliance}
              onCheckedChange={(checked: boolean) => {
                updateField("compliance", checked);
                patchDetails({ compliance: checked });
              }}
            />
            <Label htmlFor="compliance">Compliance required</Label>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Modules</CardTitle>
          <Dialog open={addModuleOpen} onOpenChange={setAddModuleOpen}>
            <DialogTrigger
              render={
                <Button size="sm" type="button">
                  Add Module
                </Button>
              }
            />
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Module</DialogTitle>
              </DialogHeader>
              <Tabs defaultValue="scorm">
                <TabsList>
                  <TabsTrigger value="scorm">Upload SCORM Package</TabsTrigger>
                  <TabsTrigger value="video">Upload Video</TabsTrigger>
                </TabsList>
                <TabsContent value="scorm">
                  <form onSubmit={handleUploadScorm} className="flex flex-col gap-4 pt-4">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="scormModuleTitle">Module Title</Label>
                      <Input
                        id="scormModuleTitle"
                        value={scormTitle}
                        onChange={(e) => setScormTitle(e.target.value)}
                        required
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="scormPackage">SCORM Package (.zip)</Label>
                      <input
                        ref={fileInputRef}
                        id="scormPackage"
                        type="file"
                        accept=".zip,application/zip"
                        onChange={(e) => setScormFile(e.target.files?.[0] ?? null)}
                      />
                      {scormFile && (
                        <p className="flex items-center gap-2 text-xs text-muted-foreground">
                          <FileArchive className="h-3.5 w-3.5" />
                          {scormFile.name}
                        </p>
                      )}
                    </div>
                    {uploadError && <p className="text-sm text-destructive">{uploadError}</p>}
                    <Button type="submit" disabled={uploading}>
                      {uploading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <UploadCloud className="h-4 w-4" />
                      )}
                      {uploading ? "Uploading…" : "Upload"}
                    </Button>
                  </form>
                </TabsContent>
                <TabsContent value="video">
                  <form onSubmit={handleAddVideo} className="flex flex-col gap-4 pt-4">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="videoTitle">Module Title</Label>
                      <Input
                        id="videoTitle"
                        value={videoTitle}
                        onChange={(e) => setVideoTitle(e.target.value)}
                        required
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="videoFile">Video File</Label>
                      <input
                        id="videoFile"
                        type="file"
                        accept="video/*"
                        onChange={(e) => setVideoFile(e.target.files?.[0] ?? null)}
                      />
                      {videoFile && (
                        <p className="flex items-center gap-2 text-xs text-muted-foreground">
                          <PlayCircle className="h-3.5 w-3.5" />
                          {videoFile.name}
                        </p>
                      )}
                    </div>
                    {videoStatus && (
                      <p className="flex items-center gap-2 text-xs text-muted-foreground">
                        {videoUploading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                        Status: {videoStatus}
                      </p>
                    )}
                    {videoError && <p className="text-sm text-destructive">{videoError}</p>}
                    <Button type="submit" disabled={videoUploading}>
                      {videoUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
                      {videoUploading ? "Uploading…" : "Upload Video"}
                    </Button>
                  </form>
                </TabsContent>
              </Tabs>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <Separator />
        <CardContent className="flex flex-col gap-2 pt-4">
          {course.modules.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No modules yet — add one to be able to publish this course.
            </p>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext
                items={course.modules.map((m) => m.id)}
                strategy={verticalListSortingStrategy}
              >
                {course.modules.map((module) => (
                  <ModuleRow key={module.id} module={module} onRemove={handleRemoveModule} />
                ))}
              </SortableContext>
            </DndContext>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
