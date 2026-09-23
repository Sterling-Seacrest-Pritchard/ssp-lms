import { notFound } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { auth } from "@/auth";
import { db } from "@/lib/db/client";
import { eq } from "drizzle-orm";
import { modules, moduleVersions, quizModuleVersions, quizQuestions, quizChoices } from "@/lib/db/schema";
import { getLatestQuizStatus } from "@/lib/quiz/completion-status";
import { getUserIdByEmail } from "@/lib/db/users";
import { getEnrollmentId } from "@/lib/db/enrollments";
import { isAdminRole } from "@/lib/roles";
import { QuizPlayer } from "@/components/quiz/quiz-player";
import { ModuleNavBar } from "@/components/course/module-nav-bar";
import { NextModuleButton } from "@/components/course/next-module-button";
import { getAdjacentModules } from "@/lib/db/module-navigation";
import { UnavailableState } from "@/components/ui/unavailable-state";
import { isNextNotFoundError } from "@/lib/utils";
import { isUuid } from "@/lib/api/errors";

export default async function LearnerQuizPage(
  props: PageProps<"/courses/[id]/quiz/[moduleId]">
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
    // as the SCORM/video pages) - never trust the URL's courseId without
    // confirming this module actually belongs to it.
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

    const { next } = await getAdjacentModules(courseId, moduleId);

    const quizStatus = await getLatestQuizStatus(moduleId, userId);
    if (quizStatus === "completed") {
      return (
        <div className="flex h-full w-full flex-col gap-3">
          <ModuleNavBar courseId={courseId} isComplete={true} />
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <CheckCircle2 className="h-10 w-10 text-emerald-600" />
            <p className="text-lg font-medium">Quiz passed</p>
            <p className="text-sm text-muted-foreground">You&apos;ve already completed this quiz.</p>
            <NextModuleButton courseId={courseId} next={next} />
          </div>
        </div>
      );
    }

    const [quizVersion] = await db
      .select()
      .from(quizModuleVersions)
      .where(eq(quizModuleVersions.moduleVersionId, moduleId));
    if (!quizVersion) {
      notFound();
    }
    const questions = await db
      .select()
      .from(quizQuestions)
      .where(eq(quizQuestions.quizModuleVersionId, moduleId))
      .orderBy(quizQuestions.sortOrder);
    const questionsWithChoices = await Promise.all(
      questions.map(async (question) => {
        const choices = await db
          .select({ id: quizChoices.id, choiceText: quizChoices.choiceText })
          .from(quizChoices)
          .where(eq(quizChoices.questionId, question.id))
          .orderBy(quizChoices.sortOrder);
        return { id: question.id, prompt: question.prompt, questionType: question.questionType, choices };
      })
    );

    if (questionsWithChoices.length === 0) {
      return <UnavailableState message="This quiz isn't ready yet. Please check back later." />;
    }

    return <QuizPlayer moduleVersionId={moduleId} questions={questionsWithChoices} courseId={courseId} next={next} />;
  } catch (err) {
    if (isNextNotFoundError(err)) {
      throw err;
    }
    return <UnavailableState message="Could not load this quiz right now. Please try again in a moment." />;
  }
}
