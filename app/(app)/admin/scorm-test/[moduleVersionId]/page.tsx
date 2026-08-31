import { notFound } from "next/navigation";
import { ScormLaunch } from "./scorm-launch";

export default async function ScormTestPage(
  props: PageProps<"/admin/scorm-test/[moduleVersionId]">
) {
  const { moduleVersionId } = await props.params;
  const supabaseUrl = process.env.SUPABASE_URL;

  const infoResponse = await fetch(
    `${process.env.AUTH_URL ?? "http://localhost:3000"}/api/scorm/launch-info/${moduleVersionId}`,
    { cache: "no-store" }
  );
  if (infoResponse.status === 404) {
    notFound();
  }
  const { launchUrl, gcsPrefix } = await infoResponse.json();
  const contentUrl = `${supabaseUrl}/storage/v1/object/public/scorm-packages/${gcsPrefix}/${launchUrl}`;

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
