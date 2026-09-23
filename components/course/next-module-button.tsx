import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AdjacentModule } from "@/lib/db/module-navigation";

/**
 * Shown once a module is complete. Points straight at the next launchable
 * module in the course, or back to the course page if this was the last one
 * - never a dead end.
 */
export function NextModuleButton({ courseId, next }: { courseId: string; next: AdjacentModule | null }) {
  if (!next) {
    return (
      <Link href={`/courses/${courseId}`}>
        <Button type="button">Back to Course</Button>
      </Link>
    );
  }

  return (
    <Link href={`/courses/${courseId}/${next.moduleType}/${next.moduleVersionId}`}>
      <Button type="button">
        Next: {next.title}
        <ArrowRight className="h-4 w-4" />
      </Button>
    </Link>
  );
}
