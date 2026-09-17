"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

export function TextEditorClient({
  courseId,
  moduleVersionId,
}: {
  courseId: string;
  moduleVersionId: string;
}) {
  const [body, setBody] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setLoadError(null);
      try {
        const response = await fetch(`/api/admin/text/${moduleVersionId}`);
        const data = await response.json();
        if (!response.ok) {
          setLoadError(data.error ?? "Could not load this text module");
          return;
        }
        setBody(data.body);
      } catch {
        setLoadError("Could not load this text module");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [moduleVersionId]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const response = await fetch(`/api/admin/text/${moduleVersionId}`, {
        method: "PATCH",
        body: JSON.stringify({ body }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setSaveError(data.error ?? "Could not save this text module");
        return;
      }
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <Link
          href={`/admin/content/builder/${courseId}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Course Builder
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Text Module</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Body</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </p>
          ) : loadError ? (
            <p className="text-sm text-destructive">{loadError}</p>
          ) : (
            <form onSubmit={handleSave} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="text-body">Body</Label>
                <Textarea
                  id="text-body"
                  value={body}
                  onChange={(e) => {
                    setBody(e.target.value);
                    setSaved(false);
                  }}
                  rows={16}
                  required
                />
              </div>
              {saveError && <p className="text-sm text-destructive">{saveError}</p>}
              <div className="flex items-center gap-3">
                <Button type="submit" disabled={saving}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Save
                </Button>
                {saved && <span className="text-sm text-muted-foreground">Saved</span>}
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
