"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Back-to-course link shown at the top of every module player. While the
 * module isn't finished yet, leaving loses unsaved progress (a SCORM SCO
 * that hasn't committed, a quiz not yet submitted, a video not yet watched
 * to the end) - so this warns before navigating away, rather than doing it
 * silently. Once `isComplete`, there's nothing left to lose, so it just
 * navigates.
 */
export function ModuleNavBar({ courseId, isComplete }: { courseId: string; isComplete: boolean }) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);

  function handleBackClick() {
    if (isComplete) {
      router.push(`/courses/${courseId}`);
      return;
    }
    setConfirmOpen(true);
  }

  return (
    <>
      <Button type="button" variant="ghost" size="sm" onClick={handleBackClick} className="self-start">
        <ArrowLeft className="h-4 w-4" />
        Back to Course
      </Button>
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Leave this module?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Your progress in this module won&apos;t be saved.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" onClick={() => router.push(`/courses/${courseId}`)}>
              Leave
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
