import { notFound } from "next/navigation";
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
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <h1 className="text-xl font-semibold">SCORM Import Test Harness</h1>
      <p className="text-sm text-muted-foreground">
        Admin-only manual test page — not part of the learner-facing product.
      </p>
      <ScormLaunch
        moduleVersionId={moduleVersionId}
        contentUrl={contentUrl}
        scormVersion={scormVersion}
      />
    </div>
  );
}
