"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, XCircle, RotateCcw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Quiz } from "@/lib/mock-data/quizzes";

export function QuizRunner({
  courseId,
  courseTitle,
  moduleTitle,
  quiz,
}: {
  courseId: string;
  courseTitle: string;
  moduleTitle: string;
  quiz: Quiz;
}) {
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [submitted, setSubmitted] = useState(false);

  const allAnswered = quiz.questions.every((q) => answers[q.id] !== undefined);
  const correctCount = quiz.questions.filter((q) => answers[q.id] === q.correctIndex).length;
  const scorePercent = Math.round((correctCount / quiz.questions.length) * 100);
  const passed = scorePercent >= quiz.passThreshold;

  const retake = () => {
    setAnswers({});
    setSubmitted(false);
  };

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <Link
          href={`/courses/${courseId}`}
          className="text-sm text-muted-foreground hover:underline"
        >
          &larr; Back to {courseTitle}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{moduleTitle}</h1>
        <p className="text-sm text-muted-foreground">
          {quiz.questions.length} questions &middot; {quiz.passThreshold}% required to pass
        </p>
      </div>

      {submitted && (
        <Card className={passed ? "border-emerald-300" : "border-destructive/40"}>
          <CardContent className="flex items-center gap-4 py-5">
            {passed ? (
              <CheckCircle2 className="h-8 w-8 shrink-0 text-emerald-600" />
            ) : (
              <XCircle className="h-8 w-8 shrink-0 text-destructive" />
            )}
            <div className="flex-1">
              <p className="text-lg font-semibold">
                {scorePercent}% &middot; {correctCount}/{quiz.questions.length} correct
              </p>
              <p className="text-sm text-muted-foreground">
                {passed ? "Passed — nice work." : `Not quite — ${quiz.passThreshold}% required to pass.`}
              </p>
            </div>
            <Badge variant={passed ? "secondary" : "destructive"}>
              {passed ? "Passed" : "Not passed"}
            </Badge>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-col gap-4">
        {quiz.questions.map((q, qIndex) => {
          const selected = answers[q.id];
          return (
            <Card key={q.id}>
              <CardHeader>
                <CardTitle className="text-base">
                  {qIndex + 1}. {q.question}
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {q.options.map((option, optIndex) => {
                  const isSelected = selected === optIndex;
                  const isCorrect = optIndex === q.correctIndex;
                  const showResult = submitted;
                  return (
                    <button
                      key={optIndex}
                      type="button"
                      disabled={submitted}
                      onClick={() =>
                        setAnswers((prev) => ({ ...prev, [q.id]: optIndex }))
                      }
                      className={cn(
                        "flex items-center justify-between rounded-lg border px-4 py-2.5 text-left text-sm transition-colors",
                        !showResult &&
                          (isSelected
                            ? "border-primary bg-primary/5"
                            : "border-border hover:bg-muted"),
                        showResult &&
                          isCorrect &&
                          "border-emerald-400 bg-emerald-50 dark:bg-emerald-950/30",
                        showResult &&
                          isSelected &&
                          !isCorrect &&
                          "border-destructive/50 bg-destructive/5"
                      )}
                    >
                      {option}
                      {showResult && isCorrect && (
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                      )}
                      {showResult && isSelected && !isCorrect && (
                        <XCircle className="h-4 w-4 shrink-0 text-destructive" />
                      )}
                    </button>
                  );
                })}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="flex items-center gap-3">
        {!submitted ? (
          <Button disabled={!allAnswered} onClick={() => setSubmitted(true)}>
            Submit Quiz
          </Button>
        ) : (
          <>
            <Button variant="outline" onClick={retake}>
              <RotateCcw className="h-4 w-4" />
              Retake Quiz
            </Button>
            <Link href={`/courses/${courseId}`}>
              <Button>Back to Course</Button>
            </Link>
          </>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Demo only — results aren&apos;t saved. Course progress won&apos;t reflect this attempt yet.
      </p>
    </div>
  );
}
