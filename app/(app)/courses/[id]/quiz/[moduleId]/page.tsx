import { notFound } from "next/navigation";
import { courses } from "@/lib/mock-data/courses";
import { getQuiz } from "@/lib/mock-data/quizzes";
import { QuizRunner } from "@/components/quiz/quiz-runner";

export default async function QuizPage(props: PageProps<"/courses/[id]/quiz/[moduleId]">) {
  const { id, moduleId } = await props.params;
  const course = courses.find((c) => c.id === id);
  const courseModule = course?.modules.find((m) => m.id === moduleId);
  const quiz = getQuiz(id, moduleId);

  if (!course || !courseModule || !quiz) {
    notFound();
  }

  return (
    <QuizRunner
      courseId={course.id}
      courseTitle={course.title}
      moduleTitle={courseModule.title}
      quiz={quiz}
    />
  );
}
