"use client";

import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export function TextReader({ moduleVersionId, body }: { moduleVersionId: string; body: string }) {
  const [completing, setCompleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);

  async function handleComplete() {
    setCompleting(true);
    setError(null);
    try {
      const res = await fetch("/api/text/complete", {
        method: "POST",
        body: JSON.stringify({ moduleVersionId }),
      });
      if (!res.ok) throw new Error(`Failed to mark this reading complete (status ${res.status})`);
      setCompleted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to mark this reading complete");
    } finally {
      setCompleting(false);
    }
  }

  if (completed) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-center">
        <CheckCircle2 className="h-10 w-10 text-emerald-600" />
        <p className="text-lg font-medium">Marked complete</p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <Card>
        <CardContent className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap pt-6">
          {body}
        </CardContent>
      </Card>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="button" onClick={handleComplete} disabled={completing} className="self-start">
        Mark as Complete
      </Button>
    </div>
  );
}
