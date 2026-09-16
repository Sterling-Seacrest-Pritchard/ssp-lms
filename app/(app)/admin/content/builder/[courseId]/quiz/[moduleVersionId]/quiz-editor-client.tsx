"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type QuestionType = "single_choice" | "multi_choice" | "true_false";

const QUESTION_TYPES: { value: QuestionType; label: string }[] = [
  { value: "single_choice", label: "Single choice" },
  { value: "multi_choice", label: "Multiple choice" },
  { value: "true_false", label: "True / False" },
];

interface QuizChoice {
  id: string;
  choiceText: string;
  isCorrect: boolean;
}

interface QuizQuestion {
  id: string;
  questionType: QuestionType;
  prompt: string;
  points: number;
  choices: QuizChoice[];
}

interface DraftChoice {
  choiceText: string;
  isCorrect: boolean;
}

function defaultChoicesFor(type: QuestionType): DraftChoice[] {
  if (type === "true_false") {
    return [
      { choiceText: "True", isCorrect: true },
      { choiceText: "False", isCorrect: false },
    ];
  }
  return [
    { choiceText: "", isCorrect: true },
    { choiceText: "", isCorrect: false },
  ];
}

export function QuizEditorClient({
  courseId,
  moduleVersionId,
}: {
  courseId: string;
  moduleVersionId: string;
}) {
  const [questions, setQuestions] = useState<QuizQuestion[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [prompt, setPrompt] = useState("");
  const [points, setPoints] = useState("1");
  const [questionType, setQuestionType] = useState<QuestionType>("single_choice");
  const [choices, setChoices] = useState<DraftChoice[]>(defaultChoicesFor("single_choice"));
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [passingScorePct, setPassingScorePct] = useState("70");
  const [savingScore, setSavingScore] = useState(false);
  const [scoreSaved, setScoreSaved] = useState(false);
  const [scoreError, setScoreError] = useState<string | null>(null);

  async function loadQuestions() {
    setLoadError(null);
    try {
      const response = await fetch(`/api/admin/quiz/${moduleVersionId}/questions`);
      const body = await response.json();
      if (!response.ok) {
        setLoadError(body.error ?? "Could not load questions");
        return;
      }
      setQuestions(body.questions);
    } catch {
      setLoadError("Could not load questions");
    }
  }

  useEffect(() => {
    loadQuestions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moduleVersionId]);

  function handleTypeChange(value: QuestionType) {
    setQuestionType(value);
    setChoices(defaultChoicesFor(value));
  }

  function updateChoiceText(index: number, text: string) {
    setChoices((prev) => prev.map((c, i) => (i === index ? { ...c, choiceText: text } : c)));
  }

  function toggleChoiceCorrect(index: number) {
    setChoices((prev) =>
      prev.map((c, i) => {
        if (questionType === "multi_choice") {
          return i === index ? { ...c, isCorrect: !c.isCorrect } : c;
        }
        return { ...c, isCorrect: i === index };
      })
    );
  }

  function addChoiceRow() {
    setChoices((prev) => [...prev, { choiceText: "", isCorrect: false }]);
  }

  function removeChoiceRow(index: number) {
    setChoices((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleAddQuestion(e: React.FormEvent) {
    e.preventDefault();
    setAddError(null);

    if (!prompt.trim()) {
      setAddError("Enter a question prompt");
      return;
    }
    const pointsNum = Number(points);
    if (!Number.isFinite(pointsNum) || pointsNum <= 0) {
      setAddError("Points must be a positive number");
      return;
    }
    if (questionType !== "true_false" && choices.some((c) => !c.choiceText.trim())) {
      setAddError("All choices need text");
      return;
    }
    if (!choices.some((c) => c.isCorrect)) {
      setAddError("Mark at least one choice as correct");
      return;
    }

    setAdding(true);
    const response = await fetch(`/api/admin/quiz/${moduleVersionId}/questions`, {
      method: "POST",
      body: JSON.stringify({
        questionType,
        prompt,
        points: pointsNum,
        choices,
      }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setAddError(body.error ?? "Could not add question");
      setAdding(false);
      return;
    }
    setPrompt("");
    setPoints("1");
    setQuestionType("single_choice");
    setChoices(defaultChoicesFor("single_choice"));
    setAdding(false);
    loadQuestions();
  }

  async function handleDeleteQuestion(questionId: string) {
    setDeletingId(questionId);
    await fetch(`/api/admin/quiz/${moduleVersionId}/questions/${questionId}`, {
      method: "DELETE",
    });
    setDeletingId(null);
    loadQuestions();
  }

  async function handleSavePassingScore(e: React.FormEvent) {
    e.preventDefault();
    setScoreError(null);
    setScoreSaved(false);
    const scoreNum = Number(passingScorePct);
    if (!Number.isFinite(scoreNum) || scoreNum < 0 || scoreNum > 100) {
      setScoreError("Passing score must be between 0 and 100");
      return;
    }
    setSavingScore(true);
    const response = await fetch(`/api/admin/quiz/${moduleVersionId}`, {
      method: "PATCH",
      body: JSON.stringify({ passingScorePct: scoreNum }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setScoreError(body.error ?? "Could not save passing score");
      setSavingScore(false);
      return;
    }
    setSavingScore(false);
    setScoreSaved(true);
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <Link
          href={`/admin/content/builder/${courseId}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Course Builder
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Quiz Questions</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Passing Score</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSavePassingScore} className="flex items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="passingScore">Passing score (%)</Label>
              <Input
                id="passingScore"
                type="number"
                min={0}
                max={100}
                value={passingScorePct}
                onChange={(e) => {
                  setPassingScorePct(e.target.value);
                  setScoreSaved(false);
                }}
                className="w-32"
              />
            </div>
            <Button type="submit" disabled={savingScore}>
              {savingScore ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Save
            </Button>
            {scoreSaved && <span className="text-sm text-muted-foreground">Saved</span>}
          </form>
          {scoreError && <p className="mt-2 text-sm text-destructive">{scoreError}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Questions</CardTitle>
        </CardHeader>
        <Separator />
        <CardContent className="flex flex-col gap-3 pt-4">
          {loadError && <p className="text-sm text-destructive">{loadError}</p>}
          {questions === null && !loadError ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading questions…
            </p>
          ) : questions && questions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No questions yet — add one below.</p>
          ) : (
            questions?.map((question, i) => (
              <div key={question.id} className="flex flex-col gap-2 rounded-lg border bg-card px-3 py-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <p className="text-sm font-medium">
                      {i + 1}. {question.prompt}
                    </p>
                    <div className="mt-1 flex items-center gap-2">
                      <Badge variant="outline" className="text-[10px] uppercase">
                        {question.questionType.replace("_", " ")}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {question.points} point{question.points === 1 ? "" : "s"}
                      </span>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Delete question"
                    disabled={deletingId === question.id}
                    onClick={() => handleDeleteQuestion(question.id)}
                  >
                    {deletingId === question.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4 text-destructive" />
                    )}
                  </Button>
                </div>
                <ul className="flex flex-col gap-1 pl-4 text-sm">
                  {question.choices.map((choice) => (
                    <li
                      key={choice.id}
                      className={choice.isCorrect ? "font-medium text-foreground" : "text-muted-foreground"}
                    >
                      {choice.isCorrect ? "✓ " : "— "}
                      {choice.choiceText}
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add Question</CardTitle>
        </CardHeader>
        <Separator />
        <CardContent className="pt-4">
          <form onSubmit={handleAddQuestion} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="prompt">Prompt</Label>
              <Input
                id="prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                required
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="questionType">Question type</Label>
                <Select
                  value={questionType}
                  items={QUESTION_TYPES}
                  onValueChange={(value) => handleTypeChange(value as QuestionType)}
                >
                  <SelectTrigger id="questionType" className="w-full">
                    <SelectValue placeholder="Single choice" />
                  </SelectTrigger>
                  <SelectContent>
                    {QUESTION_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="points">Points</Label>
                <Input
                  id="points"
                  type="number"
                  min={1}
                  value={points}
                  onChange={(e) => setPoints(e.target.value)}
                />
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Label>Choices</Label>
              {choices.map((choice, index) => (
                <div key={index} className="flex items-center gap-2">
                  <input
                    type={questionType === "multi_choice" ? "checkbox" : "radio"}
                    name="correctChoice"
                    checked={choice.isCorrect}
                    onChange={() => toggleChoiceCorrect(index)}
                    aria-label={`Choice ${index + 1} is correct`}
                  />
                  <Input
                    value={choice.choiceText}
                    onChange={(e) => updateChoiceText(index, e.target.value)}
                    placeholder={`Choice ${index + 1}`}
                    disabled={questionType === "true_false"}
                    className="flex-1"
                  />
                  {questionType !== "true_false" && choices.length > 2 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Remove choice"
                      onClick={() => removeChoiceRow(index)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  )}
                </div>
              ))}
              {questionType !== "true_false" && (
                <Button type="button" variant="outline" size="sm" onClick={addChoiceRow}>
                  Add Choice
                </Button>
              )}
            </div>

            {addError && <p className="text-sm text-destructive">{addError}</p>}
            <Button type="submit" disabled={adding}>
              {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {adding ? "Adding…" : "Add Question"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
