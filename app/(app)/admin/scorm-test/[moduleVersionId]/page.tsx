import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getScormLaunchInfo } from "@/lib/scorm/launch-info";
import { ScormLaunch } from "./scorm-launch";

export default async function ScormTestPage(
  props: PageProps<"/admin/scorm-test/[moduleVersionId]">
) {
  const { moduleVersionId } = await props.params;

  const info = await getScormLaunchInfo(moduleVersionId);
  if (!info) {
    notFound();
  }
  const { launchUrl, scormVersion } = info;
  // Same-origin content proxy, NOT the Supabase public object URL: a SCORM 1.2
  // SCO finds the LMS runtime by reading `.API` off each window up the parent
  // chain, and that read throws a DOMException on a cross-origin frame - so a
  // cross-origin iframe can never complete LMSInitialize. Serving the package
  // through this app's own origin also lets the bucket stay private.
  const contentUrl = `/api/scorm/content/${moduleVersionId}/${launchUrl}`;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div>
        <Link
          href="/admin/content"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Content Authoring
        </Link>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">SCORM Import Test Harness</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Admin-only manual test page — not part of the learner-facing product.
        </p>
      </div>
      <ScormLaunch
        moduleVersionId={moduleVersionId}
        contentUrl={contentUrl}
        scormVersion={scormVersion}
      />
    </div>
  );
}
