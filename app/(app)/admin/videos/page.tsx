import { Upload, PlayCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { courses } from "@/lib/mock-data/courses";

const videoAssets = courses
  .flatMap((course) =>
    course.modules
      .filter((m) => m.type === "video")
      .map((m) => ({ ...m, courseTitle: course.title }))
  )
  .slice(0, 6);

export default function VideoLibraryPage() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Video Library</h1>
          <p className="text-sm text-muted-foreground">
            Upload → Mux/Cloudflare Stream ingest → playback (mock UI, no real ingest yet).
          </p>
        </div>
        <Button>
          <Upload className="h-4 w-4" />
          Upload Video
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {videoAssets.map((video) => (
          <Card key={`${video.id}-${video.title}`}>
            <div className="flex h-32 items-center justify-center rounded-t-xl bg-slate-900">
              <PlayCircle className="h-10 w-10 text-white/70" />
            </div>
            <CardHeader>
              <CardTitle className="text-sm leading-snug">{video.title}</CardTitle>
              <p className="text-xs text-muted-foreground">{video.courseTitle}</p>
            </CardHeader>
            <CardContent className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {video.durationMinutes} min
              </span>
              <Badge variant="secondary">Ready</Badge>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
