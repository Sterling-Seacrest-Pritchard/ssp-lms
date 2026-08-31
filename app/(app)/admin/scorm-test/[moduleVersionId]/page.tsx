import { notFound } from "next/navigation";
import { ScormLaunch } from "./scorm-launch";

export default async function ScormTestPage(
  props: PageProps<"/admin/scorm-test/[moduleVersionId]">
) {
  const { moduleVersionId } = await props.params;

  const infoResponse = await fetch(
    `${process.env.AUTH_URL ?? "http://localhost:3000"}/api/scorm/launch-info/${moduleVersionId}`,
    { cache: "no-store" }
  );
  if (infoResponse.status === 404) {
    notFound();
  }
  const { launchUrl } = await infoResponse.json();
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
      <ScormLaunch moduleVersionId={moduleVersionId} contentUrl={contentUrl} />
    </div>
  );
}
