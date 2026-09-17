import { notFound } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { auth } from "@/auth";
import { db } from "@/lib/db/client";
import { eq } from "drizzle-orm";
import { modules, moduleVersions, textModuleVersions } from "@/lib/db/schema";
import { getLatestTextStatus } from "@/lib/text/completion-status";
import { getUserIdByEmail } from "@/lib/db/users";
import { getEnrollmentId } from "@/lib/db/enrollments";
import { isAdminRole } from "@/lib/roles";
import { TextReader } from "@/components/text/text-reader";
import { UnavailableState } from "@/components/ui/unavailable-state";
import { isNextNotFoundError } from "@/lib/utils";
import { isUuid } from "@/lib/api/errors";

export default async function LearnerTextPage(
  props: PageProps<"/courses/[id]/text/[moduleId]">
) {
  const { id: courseId, moduleId } = await props.params;

  const session = await auth();
  const userEmail = session?.user?.email;
  if (!userEmail) {
    notFound();
  }
  const userId = await getUserIdByEmail(userEmail);
  if (!userId) {
    notFound();
  }
  if (!isUuid(moduleId)) {
    notFound();
  }

  try {
    // Resolve the module's real courseId ourselves (same anti-IDOR pattern
    // as the SCORM/video/quiz pages) - never trust the URL's courseId
    // without confirming this module actually belongs to it.
    const [moduleRow] = await db
      .select({ courseId: modules.courseId })
      .from(moduleVersions)
      .innerJoin(modules, eq(modules.id, moduleVersions.moduleId))
      .where(eq(moduleVersions.id, moduleId));
    if (!moduleRow || moduleRow.courseId !== courseId) {
      notFound();
    }

    if (!isAdminRole(session.user?.roles)) {
      const enrollmentId = await getEnrollmentId(userId, moduleRow.courseId);
      if (!enrollmentId) {
        notFound();
      }
    }

    const textStatus = await getLatestTextStatus(moduleId, userId);
    if (textStatus === "completed") {
      return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-center">
          <CheckCircle2 className="h-10 w-10 text-emerald-600" />
          <p className="text-lg font-medium">Marked complete</p>
          <p className="text-sm text-muted-foreground">You&apos;ve already completed this reading.</p>
        </div>
      );
    }

    const [textVersion] = await db
      .select()
      .from(textModuleVersions)
      .where(eq(textModuleVersions.moduleVersionId, moduleId));
    if (!textVersion) {
      return <UnavailableState message="This reading isn't ready yet. Please check back later." />;
    }

    return <TextReader moduleVersionId={moduleId} body={textVersion.body} />;
  } catch (err) {
    if (isNextNotFoundError(err)) {
      throw err;
    }
    return <UnavailableState message="Could not load this reading right now. Please try again in a moment." />;
  }
}
