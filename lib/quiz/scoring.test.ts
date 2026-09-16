import { describe, it, expect } from "vitest";
import { scoreAnswer, scoreAttempt } from "./scoring";

describe("scoreAnswer", () => {
  it("single_choice: correct when the one selected choice is the one marked correct", () => {
    const question = {
      questionType: "single_choice" as const,
      choices: [
        { id: "a", isCorrect: false },
        { id: "b", isCorrect: true },
      ],
    };
    expect(scoreAnswer(question, ["b"])).toBe(true);
    expect(scoreAnswer(question, ["a"])).toBe(false);
  });

  it("true_false: correct when the selected choice matches the correct one", () => {
    const question = {
      questionType: "true_false" as const,
      choices: [
        { id: "true", isCorrect: true },
        { id: "false", isCorrect: false },
      ],
    };
    expect(scoreAnswer(question, ["true"])).toBe(true);
    expect(scoreAnswer(question, ["false"])).toBe(false);
  });

  it("multi_choice: all-or-nothing - correct only when the selected set exactly matches the correct set", () => {
    const question = {
      questionType: "multi_choice" as const,
      choices: [
        { id: "a", isCorrect: true },
        { id: "b", isCorrect: true },
        { id: "c", isCorrect: false },
      ],
    };
    expect(scoreAnswer(question, ["a", "b"])).toBe(true);
    expect(scoreAnswer(question, ["b", "a"])).toBe(true);
    expect(scoreAnswer(question, ["a"])).toBe(false);
    expect(scoreAnswer(question, ["a", "b", "c"])).toBe(false);
  });

  it("an unanswered question (empty selection) is never correct", () => {
    const question = {
      questionType: "single_choice" as const,
      choices: [{ id: "a", isCorrect: true }],
    };
    expect(scoreAnswer(question, [])).toBe(false);
  });
});

describe("scoreAttempt", () => {
  it("computes percentage and pass/fail against passingScorePct", () => {
    const result = scoreAttempt(
      [
        { points: 1, isCorrect: true },
        { points: 1, isCorrect: true },
        { points: 2, isCorrect: false },
      ],
      70
    );
    expect(result).toEqual({ earnedPoints: 2, totalPoints: 4, percentage: 50, passed: false });
  });

  it("passes when the percentage meets the threshold exactly", () => {
    const result = scoreAttempt([{ points: 1, isCorrect: true }, { points: 1, isCorrect: false }], 50);
    expect(result.passed).toBe(true);
  });

  it("returns 0%/failed for a quiz with zero total points rather than dividing by zero", () => {
    const result = scoreAttempt([], 70);
    expect(result).toEqual({ earnedPoints: 0, totalPoints: 0, percentage: 0, passed: false });
  });
});
