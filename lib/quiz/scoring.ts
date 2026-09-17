export type QuestionType = "single_choice" | "multi_choice" | "true_false";

export interface ScorableQuestion {
  questionType: QuestionType;
  choices: { id: string; isCorrect: boolean }[];
}

/**
 * All-or-nothing for every question type, per the spec: selected set must
 * exactly equal the set of choices marked correct. single_choice/true_false
 * fall out of this same rule since they only ever have one correct choice.
 */
export function scoreAnswer(question: ScorableQuestion, selectedChoiceIds: string[]): boolean {
  const correctIds = new Set(question.choices.filter((c) => c.isCorrect).map((c) => c.id));
  const selectedIds = new Set(selectedChoiceIds);
  if (correctIds.size !== selectedIds.size) return false;
  for (const id of correctIds) {
    if (!selectedIds.has(id)) return false;
  }
  return true;
}

export interface ScoredAttempt {
  earnedPoints: number;
  totalPoints: number;
  percentage: number;
  passed: boolean;
}

export function scoreAttempt(
  answeredQuestions: { points: number; isCorrect: boolean }[],
  passingScorePct: number
): ScoredAttempt {
  const totalPoints = answeredQuestions.reduce((sum, q) => sum + q.points, 0);
  const earnedPoints = answeredQuestions.filter((q) => q.isCorrect).reduce((sum, q) => sum + q.points, 0);
  const percentage = totalPoints === 0 ? 0 : Math.round((earnedPoints / totalPoints) * 100);
  return { earnedPoints, totalPoints, percentage, passed: percentage >= passingScorePct };
}
