"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { ModuleNavBar } from "@/components/course/module-nav-bar";
import { NextModuleButton } from "@/components/course/next-module-button";
import type { AdjacentModule } from "@/lib/db/module-navigation";

type QuizQuestion = {
  id: string;
  prompt: string;
  questionType: string;
  choices: { id: string; choiceText: string }[];
};

export function QuizPlayer({
  moduleVersionId,
  questions,
  courseId,
  next,
}: {
  moduleVersionId: string;
  questions: QuizQuestion[];
  courseId: string;
  next: AdjacentModule | null;
}) {
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selections, setSelections] = useState<Record<string, string[]>>({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ percentage: number; passed: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/quiz/attempts", {
      method: "POST",
      body: JSON.stringify({ moduleVersionId }),
    })
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to start this quiz (status ${res.status})`);
        return res.json();
      })
      .then((body) => {
        if (cancelled) return;
        setAttemptId(body.attemptId);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to start this quiz");
      });
    return () => {
      cancelled = true;
    };
  }, [moduleVersionId]);

  function selectSingle(questionId: string, choiceId: string) {
    setSelections((prev) => ({ ...prev, [questionId]: [choiceId] }));
  }

  function toggleMulti(questionId: string, choiceId: string) {
    setSelections((prev) => {
      const current = prev[questionId] ?? [];
      const next = current.includes(choiceId)
        ? current.filter((id) => id !== choiceId)
        : [...current, choiceId];
      return { ...prev, [questionId]: next };
    });
  }

  async function handleSubmit() {
    if (!attemptId) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/quiz/submit", {
        method: "POST",
        body: JSON.stringify({
          attemptId,
          answers: Object.entries(selections).map(([questionId, selectedChoiceIds]) => ({
            questionId,
            selectedChoiceIds,
          })),
        }),
      });
      if (!res.ok) throw new Error(`Failed to submit this quiz (status ${res.status})`);
      const body = await res.json();
      setResult({ percentage: body.percentage, passed: body.passed });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit this quiz");
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    return (
      <div className="flex h-full w-full flex-col gap-3">
        <ModuleNavBar courseId={courseId} isComplete={result.passed} />
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
          {result.passed ? (
            <CheckCircle2 className="h-10 w-10 text-emerald-600" />
          ) : (
            <XCircle className="h-10 w-10 text-destructive" />
          )}
          <p className="text-lg font-medium">{result.passed ? "Quiz passed" : "Quiz not passed"}</p>
          <p className="text-sm text-muted-foreground">Score: {result.percentage}%</p>
          {result.passed && <NextModuleButton courseId={courseId} next={next} />}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col gap-3">
        <ModuleNavBar courseId={courseId} isComplete={false} />
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  if (!attemptId) {
    return (
      <div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <ModuleNavBar courseId={courseId} isComplete={false} />
      {questions.map((question) => (
        <Card key={question.id}>
          <CardHeader>
            <CardTitle className="text-base font-medium">{question.prompt}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {question.choices.map((choice) => {
              const isMulti = question.questionType === "multi_choice";
              const selected = (selections[question.id] ?? []).includes(choice.id);
              return (
                <Label key={choice.id} className="cursor-pointer font-normal">
                  <input
                    type={isMulti ? "checkbox" : "radio"}
                    name={question.id}
                    checked={selected}
                    onChange={() =>
                      isMulti ? toggleMulti(question.id, choice.id) : selectSingle(question.id, choice.id)
                    }
                    className="h-4 w-4"
                  />
                  {choice.choiceText}
                </Label>
              );
            })}
          </CardContent>
        </Card>
      ))}
      <Button type="button" onClick={handleSubmit} disabled={!attemptId || submitting} className="self-start">
        Submit
      </Button>
    </div>
  );
}
