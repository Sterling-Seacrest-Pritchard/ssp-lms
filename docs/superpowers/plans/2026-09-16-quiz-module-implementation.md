# Quiz Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a real quiz module type (schema, in-app authoring, auto-graded learner runtime) that plugs into the persisted enrollment/progress system shipped 2026-09-16.

**Architecture:** Quiz follows the exact `module_versions` fork pattern SCORM/video already use — a new `quiz_module_versions` (1:1) plus `quiz_questions`/`quiz_choices` children, all immutable once the parent version is published. Quiz attempts reuse the existing generic `module_attempts` table (not a new quiz-specific attempts table); a new `quiz_attempt_answers` table holds per-question detail. Scoring is a pure function, called once at submission time; `module_attempts.status` becomes the quiz's own finished-state signal (unlike SCORM/video, which derive finished-ness from a sibling state table).

**Tech Stack:** Next.js 16 (App Router), Drizzle ORM, Postgres (Cloud SQL), Vitest.

**Spec:** `docs/superpowers/specs/2026-09-16-quiz-module-design.md`

## Global Constraints

- v1 supports exactly three question types: `single_choice`, `multi_choice`, `true_false`. `text` is schema-legal but rejected by every application code path (authoring and submission) with a 400.
- No per-quiz configurability beyond `passing_score_pct` — `time_limit_seconds`, `max_attempts`, `shuffle_questions`, `instructions` are schema columns only, unused by any code this pass.
- `multi_choice` scoring is all-or-nothing: correct only when the learner's selected choice set exactly equals the set of choices marked `is_correct`.
- No FK indexes beyond what a PK/unique constraint creates — matches existing schema-wide pattern.
- Every schema-altering migration runs against production Cloud SQL via a one-off `pg` `Client` script (`drizzle-kit migrate` hangs on this connection), as the `postgres` superuser, split on `--> statement-breakpoint`. **Requires user's explicit go-ahead each time.**
- Enrollment/ownership checks on quiz routes: missing attempt and someone else's attempt collapse to the same 404 (matches SCORM/video pattern — a 403 would leak that the id is real).
- Learner quiz launch page applies the same courseId-vs-moduleId cross-check fixed on SCORM/video pages earlier today (`info.courseId !== courseId` → `notFound()`).

---

## File Structure

- **Modify** `lib/db/schema.ts` — add `quizModuleVersions`, `quizQuestions`, `quizChoices`, `quizAttemptAnswers`.
- **Create** `drizzle/migrations/0013_quiz_module.sql`.
- **Create** `lib/db/quiz-authoring.ts` — admin CRUD for questions/choices on a draft quiz module version, plus `createQuizModule`.
- **Create** `lib/quiz/scoring.ts` — pure scoring functions (no DB access).
- **Create** `lib/quiz/completion-status.ts` — `getLatestQuizStatus`, mirrors `lib/scorm/completion-status.ts`/`lib/video/completion-status.ts`.
- **Modify** `lib/db/module-progress.ts` — add `quiz` branch to `isModuleFinished`.
- **Modify** `lib/scorm/course-progress.ts` — add `"quiz"` to `TRACKED_MODULE_TYPES`.
- **Create** `app/api/quiz/attempts/route.ts` — `POST` creates a `module_attempts` row, mirrors `app/api/scorm/attempts/route.ts`.
- **Create** `app/api/quiz/submit/route.ts` — `POST` scores a submission, writes `quiz_attempt_answers`, calls `recordModuleCompletion`.
- **Create** `app/api/admin/courses/[courseId]/modules/quiz/route.ts` — `POST` creates empty quiz module.
- **Create** `app/api/admin/quiz/[moduleVersionId]/questions/route.ts` — `GET`/`POST`; `app/api/admin/quiz/[moduleVersionId]/questions/[questionId]/route.ts` — `PATCH`/`DELETE`; `app/api/admin/quiz/[moduleVersionId]/route.ts` — `PATCH` passing score.
- **Modify** `app/(app)/admin/content/builder/[courseId]/builder-client.tsx` — add "Quiz" tab to Add Module dialog; add "Edit Questions" link on quiz-type `ModuleRow`s.
- **Create** `app/(app)/admin/content/builder/[courseId]/quiz/[moduleVersionId]/page.tsx` + `quiz-editor-client.tsx` — question/choice editor.
- **Create** `app/(app)/courses/[id]/quiz/[moduleId]/page.tsx` + `components/quiz/quiz-player.tsx` — learner-facing quiz-taking UI.
- **Modify** `app/(app)/courses/[id]/page.tsx` — add `quiz` branch to real-course module `done`/launch-link logic (currently only `video`/`scorm`).

---

## Task 1: Schema — quiz tables

**Files:**
- Modify: `lib/db/schema.ts`
- Create: `drizzle/migrations/0013_quiz_module.sql`
- Test: `lib/db/schema.test.ts`

**Interfaces:**
- Produces: `quizModuleVersions`, `quizQuestions`, `quizChoices`, `quizAttemptAnswers` exports from `lib/db/schema.ts`, used by every later task.

- [ ] **Step 1: Write the failing schema test**

Add to `lib/db/schema.test.ts` (merge these names into the file's existing `./schema` import — don't add a second import line):

```ts
describe("quiz schema", () => {
  it("supports a full quiz module version with questions, choices, and a scored attempt answer", async () => {
    const [user] = await db
      .insert(users)
      .values({ email: `quiz-schema-${randomUUID()}@example.com`, displayName: "Quiz Schema Test" })
      .returning();
    const [course] = await db
      .insert(courses)
      .values({ code: `QUIZ-SCHEMA-${randomUUID()}`, title: "Quiz Schema Course" })
      .returning();
    const [mod] = await db
      .insert(modules)
      .values({ courseId: course.id, moduleType: "quiz", title: "Quiz Module" })
      .returning();
    const [version] = await db
      .insert(moduleVersions)
      .values({ moduleId: mod.id, versionNumber: 1, status: "draft" })
      .returning();
    const [quizVersion] = await db
      .insert(quizModuleVersions)
      .values({ moduleVersionId: version.id, passingScorePct: 70 })
      .returning();
    const [question] = await db
      .insert(quizQuestions)
      .values({
        quizModuleVersionId: quizVersion.moduleVersionId,
        sortOrder: 0,
        questionType: "single_choice",
        prompt: "2 + 2?",
        points: 1,
      })
      .returning();
    const [choiceA] = await db
      .insert(quizChoices)
      .values({ questionId: question.id, sortOrder: 0, choiceText: "3", isCorrect: false })
      .returning();
    const [choiceB] = await db
      .insert(quizChoices)
      .values({ questionId: question.id, sortOrder: 1, choiceText: "4", isCorrect: true })
      .returning();
    const [attempt] = await db
      .insert(moduleAttempts)
      .values({ moduleVersionId: version.id, userId: user.id, attemptNumber: 1 })
      .returning();

    try {
      const [answer] = await db
        .insert(quizAttemptAnswers)
        .values({
          moduleAttemptId: attempt.id,
          questionId: question.id,
          selectedChoiceIds: [choiceB.id],
          isCorrect: true,
        })
        .returning();
      expect(answer.isCorrect).toBe(true);
      expect(answer.selectedChoiceIds).toEqual([choiceB.id]);

      await expect(
        db.insert(quizAttemptAnswers).values({
          moduleAttemptId: attempt.id,
          questionId: question.id,
          selectedChoiceIds: [choiceA.id],
          isCorrect: false,
        })
      ).rejects.toThrow();
    } finally {
      await db.delete(quizAttemptAnswers).where(eq(quizAttemptAnswers.moduleAttemptId, attempt.id));
      await db.delete(moduleAttempts).where(eq(moduleAttempts.id, attempt.id));
      await db.delete(quizChoices).where(eq(quizChoices.questionId, question.id));
      await db.delete(quizQuestions).where(eq(quizQuestions.id, question.id));
      await db.delete(quizModuleVersions).where(eq(quizModuleVersions.moduleVersionId, version.id));
      await db.delete(moduleVersions).where(eq(moduleVersions.id, version.id));
      await db.delete(modules).where(eq(modules.id, mod.id));
      await db.delete(courses).where(eq(courses.id, course.id));
      await db.delete(users).where(eq(users.id, user.id));
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/db/schema.test.ts`
Expected: FAIL — four tables don't exist.

- [ ] **Step 3: Add the tables to the schema**

Add to `lib/db/schema.ts`, after the existing `videoModuleVersions` export:

```ts
export const quizModuleVersions = pgTable("quiz_module_versions", {
  moduleVersionId: uuid("module_version_id")
    .primaryKey()
    .references(() => moduleVersions.id),
  passingScorePct: integer("passing_score_pct").notNull(),
  // Reserved for a future pass - no code reads or writes these in v1.
  timeLimitSeconds: integer("time_limit_seconds"),
  maxAttempts: integer("max_attempts"),
  shuffleQuestions: boolean("shuffle_questions").notNull().default(false),
  instructions: text("instructions"),
});

export const quizQuestions = pgTable("quiz_questions", {
  id: uuid("id").primaryKey().defaultRandom(),
  quizModuleVersionId: uuid("quiz_module_version_id")
    .notNull()
    .references(() => quizModuleVersions.moduleVersionId),
  sortOrder: integer("sort_order").notNull().default(0),
  // 'single_choice' | 'multi_choice' | 'true_false' | 'text' - plain text,
  // app-validated (Global Constraints: 'text' is schema-legal but every v1
  // code path rejects it).
  questionType: text("question_type").notNull(),
  prompt: text("prompt").notNull(),
  points: integer("points").notNull().default(1),
});

export const quizChoices = pgTable("quiz_choices", {
  id: uuid("id").primaryKey().defaultRandom(),
  questionId: uuid("question_id")
    .notNull()
    .references(() => quizQuestions.id),
  sortOrder: integer("sort_order").notNull().default(0),
  choiceText: text("choice_text").notNull(),
  isCorrect: boolean("is_correct").notNull().default(false),
});

export const quizAttemptAnswers = pgTable(
  "quiz_attempt_answers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    moduleAttemptId: uuid("module_attempt_id")
      .notNull()
      .references(() => moduleAttempts.id),
    questionId: uuid("question_id")
      .notNull()
      .references(() => quizQuestions.id),
    selectedChoiceIds: uuid("selected_choice_ids").array().notNull().default([]),
    isCorrect: boolean("is_correct").notNull(),
  },
  (table) => [unique().on(table.moduleAttemptId, table.questionId)]
);
```

- [ ] **Step 4: Generate the migration scaffold**

Run: `npx dotenv -e .env.local -- drizzle-kit generate --custom --name quiz_module`

Check filename against `drizzle/migrations/`. This project's `drizzle-kit generate --custom` has repeatedly produced a colliding number (clones last snapshot forward rather than diffing `schema.ts`). If it names anything other than `0013_quiz_module.sql`, rename it and fix its `_journal.json` entry's `tag` to match — same fix every prior task this session needed.

- [ ] **Step 5: Write the migration SQL**

`drizzle/migrations/0013_quiz_module.sql`:

```sql
CREATE TABLE "quiz_module_versions" (
	"module_version_id" uuid PRIMARY KEY NOT NULL,
	"passing_score_pct" integer NOT NULL,
	"time_limit_seconds" integer,
	"max_attempts" integer,
	"shuffle_questions" boolean DEFAULT false NOT NULL,
	"instructions" text
);
--> statement-breakpoint
CREATE TABLE "quiz_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quiz_module_version_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"question_type" text NOT NULL,
	"prompt" text NOT NULL,
	"points" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quiz_choices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"choice_text" text NOT NULL,
	"is_correct" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quiz_attempt_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"module_attempt_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"selected_choice_ids" uuid[] DEFAULT '{}' NOT NULL,
	"is_correct" boolean NOT NULL,
	CONSTRAINT "quiz_attempt_answers_module_attempt_id_question_id_unique" UNIQUE("module_attempt_id","question_id")
);
--> statement-breakpoint
ALTER TABLE "quiz_module_versions" ADD CONSTRAINT "quiz_module_versions_module_version_id_module_versions_id_fk" FOREIGN KEY ("module_version_id") REFERENCES "module_versions"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "quiz_questions" ADD CONSTRAINT "quiz_questions_quiz_module_version_id_quiz_module_versions_module_version_id_fk" FOREIGN KEY ("quiz_module_version_id") REFERENCES "quiz_module_versions"("module_version_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "quiz_choices" ADD CONSTRAINT "quiz_choices_question_id_quiz_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "quiz_questions"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "quiz_attempt_answers" ADD CONSTRAINT "quiz_attempt_answers_module_attempt_id_module_attempts_id_fk" FOREIGN KEY ("module_attempt_id") REFERENCES "module_attempts"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "quiz_attempt_answers" ADD CONSTRAINT "quiz_attempt_answers_question_id_quiz_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "quiz_questions"("id") ON DELETE no action ON UPDATE no action;
```

- [ ] **Step 6: Apply migration to production Cloud SQL**

Ask user to confirm before running. Same one-off `pg` script pattern used for every prior migration this session, run as `postgres`. After success:

```sql
GRANT ALL PRIVILEGES ON quiz_module_versions TO ssp_lms_app;
GRANT ALL PRIVILEGES ON quiz_questions TO ssp_lms_app;
GRANT ALL PRIVILEGES ON quiz_choices TO ssp_lms_app;
GRANT ALL PRIVILEGES ON quiz_attempt_answers TO ssp_lms_app;
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run lib/db/schema.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add lib/db/schema.ts drizzle/migrations/0013_quiz_module.sql drizzle/migrations/meta lib/db/schema.test.ts
git commit -m "feat: add quiz module schema (quiz_module_versions, quiz_questions, quiz_choices, quiz_attempt_answers)"
```

---

## Task 2: `lib/quiz/scoring.ts` — pure scoring logic

**Files:**
- Create: `lib/quiz/scoring.ts`
- Test: `lib/quiz/scoring.test.ts`

**Interfaces:**
- Consumes: nothing (pure functions, no DB access).
- Produces: `scoreAnswer(question, selectedChoiceIds): boolean`, `scoreAttempt(questionsWithAnswers, passingScorePct): ScoredAttempt` — Task 6 consumes both.

- [ ] **Step 1: Write the failing tests**

`lib/quiz/scoring.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/quiz/scoring.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement it**

`lib/quiz/scoring.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/quiz/scoring.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/quiz/scoring.ts lib/quiz/scoring.test.ts
git commit -m "feat: add pure quiz scoring functions"
```

---

## Task 3: `lib/db/quiz-authoring.ts` — admin CRUD for questions/choices

**Files:**
- Create: `lib/db/quiz-authoring.ts`
- Test: `lib/db/quiz-authoring.test.ts`

**Interfaces:**
- Consumes: `quizModuleVersions`, `quizQuestions`, `quizChoices`, `modules`, `moduleVersions` from `lib/db/schema.ts` (Task 1).
- Produces: `createQuizModule(courseId, title): Promise<{ moduleId: string; moduleVersionId: string }>`, `addQuestion(moduleVersionId, params): Promise<{ questionId: string }>`, `updateQuestion(questionId, params): Promise<void>`, `deleteQuestion(questionId): Promise<void>`, `setPassingScore(moduleVersionId, passingScorePct): Promise<void>` — Task 7 consumes these.

- [ ] **Step 1: Write the failing tests**

`lib/db/quiz-authoring.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  createQuizModule,
  addQuestion,
  updateQuestion,
  deleteQuestion,
  setPassingScore,
} from "./quiz-authoring";
import { db } from "./client";
import { courses, modules, moduleVersions, quizModuleVersions, quizQuestions, quizChoices } from "./schema";

async function cleanup(courseId: string) {
  const mods = await db.select().from(modules).where(eq(modules.courseId, courseId));
  for (const mod of mods) {
    const versions = await db.select().from(moduleVersions).where(eq(moduleVersions.moduleId, mod.id));
    for (const version of versions) {
      const questions = await db
        .select()
        .from(quizQuestions)
        .where(eq(quizQuestions.quizModuleVersionId, version.id));
      for (const q of questions) {
        await db.delete(quizChoices).where(eq(quizChoices.questionId, q.id));
      }
      await db.delete(quizQuestions).where(eq(quizQuestions.quizModuleVersionId, version.id));
      await db.delete(quizModuleVersions).where(eq(quizModuleVersions.moduleVersionId, version.id));
    }
    await db.update(modules).set({ currentVersionId: null }).where(eq(modules.id, mod.id));
    await db.delete(moduleVersions).where(eq(moduleVersions.moduleId, mod.id));
  }
  await db.delete(modules).where(eq(modules.courseId, courseId));
  await db.delete(courses).where(eq(courses.id, courseId));
}

describe("createQuizModule", () => {
  it("creates a draft module, version, and quiz_module_versions row with a default passing score", async () => {
    const [course] = await db
      .insert(courses)
      .values({ code: `QUIZ-AUTHOR-${randomUUID()}`, title: "Quiz Authoring Course" })
      .returning();
    try {
      const { moduleId, moduleVersionId } = await createQuizModule(course.id, "New Quiz");

      const [mod] = await db.select().from(modules).where(eq(modules.id, moduleId));
      expect(mod.moduleType).toBe("quiz");
      expect(mod.currentVersionId).toBe(moduleVersionId);

      const [version] = await db.select().from(moduleVersions).where(eq(moduleVersions.id, moduleVersionId));
      expect(version.status).toBe("draft");

      const [quizVersion] = await db
        .select()
        .from(quizModuleVersions)
        .where(eq(quizModuleVersions.moduleVersionId, moduleVersionId));
      expect(quizVersion.passingScorePct).toBe(70);
    } finally {
      await cleanup(course.id);
    }
  });
});

describe("addQuestion / updateQuestion / deleteQuestion", () => {
  it("adds a question with choices, updates it, and deletes it", async () => {
    const [course] = await db
      .insert(courses)
      .values({ code: `QUIZ-AUTHOR-Q-${randomUUID()}`, title: "Quiz Question Course" })
      .returning();
    try {
      const { moduleVersionId } = await createQuizModule(course.id, "Quiz");

      const { questionId } = await addQuestion(moduleVersionId, {
        questionType: "single_choice",
        prompt: "2 + 2?",
        points: 1,
        choices: [
          { choiceText: "3", isCorrect: false },
          { choiceText: "4", isCorrect: true },
        ],
      });

      const [question] = await db.select().from(quizQuestions).where(eq(quizQuestions.id, questionId));
      expect(question.prompt).toBe("2 + 2?");
      const choices = await db.select().from(quizChoices).where(eq(quizChoices.questionId, questionId));
      expect(choices).toHaveLength(2);

      await updateQuestion(questionId, { prompt: "What is 2 + 2?", points: 2 });
      const [updated] = await db.select().from(quizQuestions).where(eq(quizQuestions.id, questionId));
      expect(updated.prompt).toBe("What is 2 + 2?");
      expect(updated.points).toBe(2);

      await deleteQuestion(questionId);
      expect(await db.select().from(quizQuestions).where(eq(quizQuestions.id, questionId))).toHaveLength(0);
      expect(await db.select().from(quizChoices).where(eq(quizChoices.questionId, questionId))).toHaveLength(0);
    } finally {
      await cleanup(course.id);
    }
  });

  it("rejects a 'text' question type - not supported in v1", async () => {
    const [course] = await db
      .insert(courses)
      .values({ code: `QUIZ-AUTHOR-TEXT-${randomUUID()}`, title: "Quiz Text Rejection Course" })
      .returning();
    try {
      const { moduleVersionId } = await createQuizModule(course.id, "Quiz");
      await expect(
        addQuestion(moduleVersionId, {
          questionType: "text",
          prompt: "Explain yourself",
          points: 1,
          choices: [],
        })
      ).rejects.toThrow("question_type 'text' is not supported");
    } finally {
      await cleanup(course.id);
    }
  });
});

describe("setPassingScore", () => {
  it("updates the passing score", async () => {
    const [course] = await db
      .insert(courses)
      .values({ code: `QUIZ-AUTHOR-SCORE-${randomUUID()}`, title: "Quiz Score Course" })
      .returning();
    try {
      const { moduleVersionId } = await createQuizModule(course.id, "Quiz");
      await setPassingScore(moduleVersionId, 85);
      const [quizVersion] = await db
        .select()
        .from(quizModuleVersions)
        .where(eq(quizModuleVersions.moduleVersionId, moduleVersionId));
      expect(quizVersion.passingScorePct).toBe(85);
    } finally {
      await cleanup(course.id);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/db/quiz-authoring.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement it**

`lib/db/quiz-authoring.ts`:

```ts
import { eq } from "drizzle-orm";
import { db } from "./client";
import { modules, moduleVersions, quizModuleVersions, quizQuestions, quizChoices } from "./schema";

const SUPPORTED_QUESTION_TYPES = new Set(["single_choice", "multi_choice", "true_false"]);
const DEFAULT_PASSING_SCORE_PCT = 70;

export async function createQuizModule(
  courseId: string,
  title: string
): Promise<{ moduleId: string; moduleVersionId: string }> {
  return db.transaction(async (tx) => {
    const [mod] = await tx.insert(modules).values({ courseId, moduleType: "quiz", title }).returning();
    const [version] = await tx
      .insert(moduleVersions)
      .values({ moduleId: mod.id, versionNumber: 1, status: "draft" })
      .returning();
    await tx.insert(quizModuleVersions).values({
      moduleVersionId: version.id,
      passingScorePct: DEFAULT_PASSING_SCORE_PCT,
    });
    await tx.update(modules).set({ currentVersionId: version.id }).where(eq(modules.id, mod.id));
    return { moduleId: mod.id, moduleVersionId: version.id };
  });
}

export interface AddQuestionParams {
  questionType: string;
  prompt: string;
  points: number;
  choices: { choiceText: string; isCorrect: boolean }[];
}

export async function addQuestion(
  moduleVersionId: string,
  params: AddQuestionParams
): Promise<{ questionId: string }> {
  if (!SUPPORTED_QUESTION_TYPES.has(params.questionType)) {
    throw new Error(`question_type '${params.questionType}' is not supported`);
  }

  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ sortOrder: quizQuestions.sortOrder })
      .from(quizQuestions)
      .where(eq(quizQuestions.quizModuleVersionId, moduleVersionId));
    const nextSortOrder = existing.length;

    const [question] = await tx
      .insert(quizQuestions)
      .values({
        quizModuleVersionId: moduleVersionId,
        sortOrder: nextSortOrder,
        questionType: params.questionType,
        prompt: params.prompt,
        points: params.points,
      })
      .returning();

    if (params.choices.length > 0) {
      await tx.insert(quizChoices).values(
        params.choices.map((choice, index) => ({
          questionId: question.id,
          sortOrder: index,
          choiceText: choice.choiceText,
          isCorrect: choice.isCorrect,
        }))
      );
    }

    return { questionId: question.id };
  });
}

export async function updateQuestion(
  questionId: string,
  fields: { prompt?: string; points?: number }
): Promise<void> {
  const update: Record<string, unknown> = {};
  if (fields.prompt !== undefined) update.prompt = fields.prompt;
  if (fields.points !== undefined) update.points = fields.points;
  if (Object.keys(update).length === 0) return;
  await db.update(quizQuestions).set(update).where(eq(quizQuestions.id, questionId));
}

export async function deleteQuestion(questionId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(quizChoices).where(eq(quizChoices.questionId, questionId));
    await tx.delete(quizQuestions).where(eq(quizQuestions.id, questionId));
  });
}

export async function setPassingScore(moduleVersionId: string, passingScorePct: number): Promise<void> {
  await db
    .update(quizModuleVersions)
    .set({ passingScorePct })
    .where(eq(quizModuleVersions.moduleVersionId, moduleVersionId));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/db/quiz-authoring.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/db/quiz-authoring.ts lib/db/quiz-authoring.test.ts
git commit -m "feat: add quiz authoring CRUD (createQuizModule, addQuestion, updateQuestion, deleteQuestion, setPassingScore)"
```

---

## Task 4: `lib/quiz/completion-status.ts` + `isModuleFinished`/`TRACKED_MODULE_TYPES` wiring

**Files:**
- Create: `lib/quiz/completion-status.ts`
- Test: `lib/quiz/completion-status.test.ts`
- Modify: `lib/db/module-progress.ts`
- Modify: `lib/scorm/course-progress.ts`
- Test: `lib/db/module-progress.test.ts` (existing file — add a case)

**Interfaces:**
- Consumes: `moduleAttempts` from `lib/db/schema.ts`.
- Produces: `getLatestQuizStatus(moduleVersionId, userId): Promise<string | null>` — wired into `isModuleFinished`.

- [ ] **Step 1: Write the failing test**

`lib/quiz/completion-status.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { getLatestQuizStatus } from "./completion-status";
import { db } from "@/lib/db/client";
import { courses, modules, moduleVersions, moduleAttempts, users } from "@/lib/db/schema";

describe("getLatestQuizStatus", () => {
  it("returns the most recent attempt's status", async () => {
    const [user] = await db
      .insert(users)
      .values({ email: `quiz-completion-${randomUUID()}@example.com`, displayName: "Quiz Completion Test" })
      .returning();
    const [course] = await db
      .insert(courses)
      .values({ code: `QUIZ-COMPLETION-${randomUUID()}`, title: "x" })
      .returning();
    const [mod] = await db.insert(modules).values({ courseId: course.id, moduleType: "quiz", title: "x" }).returning();
    const [version] = await db
      .insert(moduleVersions)
      .values({ moduleId: mod.id, versionNumber: 1, status: "published" })
      .returning();
    const [attempt1] = await db
      .insert(moduleAttempts)
      .values({ moduleVersionId: version.id, userId: user.id, attemptNumber: 1, status: "failed" })
      .returning();

    try {
      expect(await getLatestQuizStatus(version.id, user.id)).toBe("failed");

      const [attempt2] = await db
        .insert(moduleAttempts)
        .values({ moduleVersionId: version.id, userId: user.id, attemptNumber: 2, status: "completed" })
        .returning();
      expect(await getLatestQuizStatus(version.id, user.id)).toBe("completed");

      await db.delete(moduleAttempts).where(eq(moduleAttempts.id, attempt2.id));
    } finally {
      await db.delete(moduleAttempts).where(eq(moduleAttempts.id, attempt1.id));
      await db.delete(moduleVersions).where(eq(moduleVersions.id, version.id));
      await db.delete(modules).where(eq(modules.id, mod.id));
      await db.delete(courses).where(eq(courses.id, course.id));
      await db.delete(users).where(eq(users.id, user.id));
    }
  });

  it("returns null when there is no attempt", async () => {
    expect(await getLatestQuizStatus("00000000-0000-0000-0000-000000000000", "00000000-0000-0000-0000-000000000000")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/quiz/completion-status.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement `getLatestQuizStatus`**

`lib/quiz/completion-status.ts`:

```ts
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { moduleAttempts } from "@/lib/db/schema";

/**
 * Quiz is the one module type where module_attempts.status itself IS the
 * finished-state signal - unlike SCORM/video, which derive finished-ness
 * from a sibling state table and leave module_attempts.status at its
 * default "in_progress" forever. The quiz submission route (Task 6) sets
 * this directly to "completed"/"failed" at scoring time.
 */
export async function getLatestQuizStatus(moduleVersionId: string, userId: string): Promise<string | null> {
  const [row] = await db
    .select({ status: moduleAttempts.status })
    .from(moduleAttempts)
    .where(and(eq(moduleAttempts.moduleVersionId, moduleVersionId), eq(moduleAttempts.userId, userId)))
    .orderBy(desc(moduleAttempts.startedAt))
    .limit(1);
  return row?.status ?? null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/quiz/completion-status.test.ts`
Expected: PASS

- [ ] **Step 5: Wire `quiz` into `isModuleFinished` and `TRACKED_MODULE_TYPES`**

In `lib/db/module-progress.ts`, add the import and a `quiz` branch:

```ts
import { getLatestQuizStatus } from "@/lib/quiz/completion-status";

const FINISHED_QUIZ_STATUSES = new Set(["completed"]);

async function isModuleFinished(moduleType: string, moduleVersionId: string, userId: string): Promise<boolean> {
  if (moduleType === "video") {
    const status = await getLatestVideoStatus(moduleVersionId, userId);
    return status !== null && FINISHED_VIDEO_STATUSES.has(status);
  }
  if (moduleType === "quiz") {
    const status = await getLatestQuizStatus(moduleVersionId, userId);
    return status !== null && FINISHED_QUIZ_STATUSES.has(status);
  }
  const lessonStatus = await getLatestLessonStatus(moduleVersionId, userId);
  return lessonStatus !== null && FINISHED_LESSON_STATUSES.has(lessonStatus);
}
```

In `lib/scorm/course-progress.ts`, add `"quiz"` to the existing `TRACKED_MODULE_TYPES` set:

```ts
const TRACKED_MODULE_TYPES = new Set(["scorm", "video", "quiz"]);
```

- [ ] **Step 6: Add a test case to `lib/db/module-progress.test.ts`**

Add to the existing `describe("recordModuleCompletion", ...)` block:

```ts
it("marks a quiz module completed and rolls the enrollment up when the attempt's status is 'completed'", async () => {
  const [user] = await db
    .insert(users)
    .values({ email: `quiz-progress-${randomUUID()}@example.com`, displayName: "Quiz Progress Test" })
    .returning();
  const [course] = await db.insert(courses).values({ code: `QUIZ-PROGRESS-${randomUUID()}`, title: "x" }).returning();
  const [mod] = await db.insert(modules).values({ courseId: course.id, moduleType: "quiz", title: "x" }).returning();
  const [version] = await db
    .insert(moduleVersions)
    .values({ moduleId: mod.id, versionNumber: 1, status: "published" })
    .returning();
  await db.update(modules).set({ currentVersionId: version.id }).where(eq(modules.id, mod.id));
  const [enrollment] = await db.insert(enrollments).values({ userId: user.id, courseId: course.id }).returning();
  const [attempt] = await db
    .insert(moduleAttempts)
    .values({ moduleVersionId: version.id, userId: user.id, attemptNumber: 1, status: "completed" })
    .returning();

  try {
    await recordModuleCompletion({ userId: user.id, moduleVersionId: version.id });

    const [progress] = await db
      .select()
      .from(moduleProgress)
      .where(and(eq(moduleProgress.enrollmentId, enrollment.id), eq(moduleProgress.moduleId, mod.id)));
    expect(progress.status).toBe("completed");

    const [updatedEnrollment] = await db.select().from(enrollments).where(eq(enrollments.id, enrollment.id));
    expect(updatedEnrollment.status).toBe("completed");
  } finally {
    await db.delete(moduleProgress).where(eq(moduleProgress.enrollmentId, enrollment.id));
    await db.delete(moduleAttempts).where(eq(moduleAttempts.id, attempt.id));
    await db.delete(enrollments).where(eq(enrollments.id, enrollment.id));
    await db.update(modules).set({ currentVersionId: null }).where(eq(modules.id, mod.id));
    await db.delete(moduleVersions).where(eq(moduleVersions.id, version.id));
    await db.delete(modules).where(eq(modules.id, mod.id));
    await db.delete(courses).where(eq(courses.id, course.id));
    await db.delete(users).where(eq(users.id, user.id));
  }
});
```

- [ ] **Step 7: Run the full test suite**

Run: `npx vitest run`
Expected: PASS, no regressions — adding `"quiz"` to `TRACKED_MODULE_TYPES` is additive; no existing SCORM/video test seeds a quiz module.

- [ ] **Step 8: Commit**

```bash
git add lib/quiz/completion-status.ts lib/quiz/completion-status.test.ts lib/db/module-progress.ts lib/db/module-progress.test.ts lib/scorm/course-progress.ts
git commit -m "feat: wire quiz into isModuleFinished and TRACKED_MODULE_TYPES"
```

---

## Task 5: `POST /api/quiz/attempts` — create an attempt

**Files:**
- Create: `app/api/quiz/attempts/route.ts`
- Test: `app/api/quiz/attempts/route.test.ts`

**Interfaces:**
- Consumes: `moduleAttempts` from `lib/db/schema.ts`; `getUserIdByEmail` from `lib/db/users.ts`; `badRequest`/`isUuid`/`serverError` from `lib/api/errors.ts`.
- Produces: `POST` returning `{ attemptId: string }` — the learner quiz page (Task 9) calls this on entry.

- [ ] **Step 1: Write the failing test**

Read `app/api/scorm/attempts/route.test.ts` first to match its exact session-mocking idiom, then write `app/api/quiz/attempts/route.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { POST } from "./route";
import { db } from "@/lib/db/client";
import { courses, modules, moduleVersions, moduleAttempts, users } from "@/lib/db/schema";

const { SESSION_USER } = vi.hoisted(() => ({
  SESSION_USER: `quiz-attempts-session-user-${require("node:crypto").randomUUID()}@example.com`,
}));
vi.mock("@/auth", () => ({
  auth: vi.fn().mockResolvedValue({ user: { email: SESSION_USER } }),
}));

describe("POST /api/quiz/attempts", () => {
  let moduleVersionId: string | undefined;

  afterEach(async () => {
    if (moduleVersionId) {
      await db.delete(moduleAttempts).where(eq(moduleAttempts.moduleVersionId, moduleVersionId));
    }
    moduleVersionId = undefined;
  });

  it("creates an attempt numbered per-user for the given module version", async () => {
    const [user] = await db.insert(users).values({ email: SESSION_USER, displayName: "Quiz Attempts Test" }).returning();
    const [course] = await db.insert(courses).values({ code: `QUIZ-ATTEMPTS-${randomUUID()}`, title: "x" }).returning();
    const [mod] = await db.insert(modules).values({ courseId: course.id, moduleType: "quiz", title: "x" }).returning();
    const [version] = await db.insert(moduleVersions).values({ moduleId: mod.id, versionNumber: 1, status: "published" }).returning();
    moduleVersionId = version.id;

    const request = new NextRequest("http://localhost/api/quiz/attempts", {
      method: "POST",
      body: JSON.stringify({ moduleVersionId: version.id }),
    });
    const response = await POST(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.attemptId).toBeDefined();

    const [attempt] = await db.select().from(moduleAttempts).where(eq(moduleAttempts.id, body.attemptId));
    expect(attempt.userId).toBe(user.id);
    expect(attempt.attemptNumber).toBe(1);

    await db.delete(users).where(eq(users.id, user.id));
    await db.delete(moduleVersions).where(eq(moduleVersions.id, version.id));
    await db.delete(modules).where(eq(modules.id, mod.id));
    await db.delete(courses).where(eq(courses.id, course.id));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/api/quiz/attempts/route.test.ts`
Expected: FAIL — route doesn't exist.

- [ ] **Step 3: Implement it**

`app/api/quiz/attempts/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { moduleAttempts } from "@/lib/db/schema";
import { getUserIdByEmail } from "@/lib/db/users";
import { badRequest, isUuid, serverError } from "@/lib/api/errors";
import { auth } from "@/auth";

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    const userEmail = session?.user?.email;
    if (!userEmail) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }
    const userId = await getUserIdByEmail(userEmail);
    if (!userId) {
      return NextResponse.json({ error: "User record not found" }, { status: 404 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return badRequest("Request body must be valid JSON");
    }
    const { moduleVersionId } = (body ?? {}) as { moduleVersionId?: string };
    if (!moduleVersionId) {
      return badRequest("moduleVersionId is required");
    }
    if (!isUuid(moduleVersionId)) {
      return badRequest("moduleVersionId must be a UUID");
    }

    const previousAttempts = await db
      .select()
      .from(moduleAttempts)
      .where(and(eq(moduleAttempts.moduleVersionId, moduleVersionId), eq(moduleAttempts.userId, userId)));

    const [attempt] = await db
      .insert(moduleAttempts)
      .values({ moduleVersionId, userId, attemptNumber: previousAttempts.length + 1 })
      .returning();

    return NextResponse.json({ attemptId: attempt.id });
  } catch (error) {
    return serverError(error);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/api/quiz/attempts/route.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/api/quiz/attempts/route.ts app/api/quiz/attempts/route.test.ts
git commit -m "feat: add POST /api/quiz/attempts"
```

---

## Task 6: `POST /api/quiz/submit` — score a submission

**Files:**
- Create: `app/api/quiz/submit/route.ts`
- Test: `app/api/quiz/submit/route.test.ts`

**Interfaces:**
- Consumes: `scoreAnswer`, `scoreAttempt` from `lib/quiz/scoring.ts` (Task 2); `recordModuleCompletion` from `lib/db/module-progress.ts` (existing signature: `{userId, moduleVersionId}`).
- Produces: `POST` returning `{ percentage: number; passed: boolean }` — the learner quiz player (Task 9) calls this once, on final submit.

- [ ] **Step 1: Write the failing test**

`app/api/quiz/submit/route.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { POST } from "./route";
import { db } from "@/lib/db/client";
import {
  courses,
  modules,
  moduleVersions,
  moduleAttempts,
  quizModuleVersions,
  quizQuestions,
  quizChoices,
  quizAttemptAnswers,
  users,
} from "@/lib/db/schema";

const { SESSION_USER } = vi.hoisted(() => ({
  SESSION_USER: `quiz-submit-session-user-${require("node:crypto").randomUUID()}@example.com`,
}));
vi.mock("@/auth", () => ({
  auth: vi.fn().mockResolvedValue({ user: { email: SESSION_USER } }),
}));

async function seedQuiz(passingScorePct: number) {
  const [user] = await db.insert(users).values({ email: SESSION_USER, displayName: "Quiz Submit Test" }).returning();
  const [course] = await db.insert(courses).values({ code: `QUIZ-SUBMIT-${randomUUID()}`, title: "x" }).returning();
  const [mod] = await db.insert(modules).values({ courseId: course.id, moduleType: "quiz", title: "x" }).returning();
  const [version] = await db.insert(moduleVersions).values({ moduleId: mod.id, versionNumber: 1, status: "published" }).returning();
  await db.insert(quizModuleVersions).values({ moduleVersionId: version.id, passingScorePct });
  const [question] = await db
    .insert(quizQuestions)
    .values({ quizModuleVersionId: version.id, sortOrder: 0, questionType: "single_choice", prompt: "2+2?", points: 1 })
    .returning();
  const [wrong] = await db.insert(quizChoices).values({ questionId: question.id, sortOrder: 0, choiceText: "3", isCorrect: false }).returning();
  const [right] = await db.insert(quizChoices).values({ questionId: question.id, sortOrder: 1, choiceText: "4", isCorrect: true }).returning();
  const [attempt] = await db.insert(moduleAttempts).values({ moduleVersionId: version.id, userId: user.id, attemptNumber: 1 }).returning();
  return { user, course, mod, version, question, wrong, right, attempt };
}

describe("POST /api/quiz/submit", () => {
  it("scores a fully-correct submission as passed and marks the attempt completed", async () => {
    const { user, course, mod, version, question, right, attempt } = await seedQuiz(70);
    try {
      const request = new NextRequest("http://localhost/api/quiz/submit", {
        method: "POST",
        body: JSON.stringify({
          attemptId: attempt.id,
          answers: [{ questionId: question.id, selectedChoiceIds: [right.id] }],
        }),
      });
      const response = await POST(request);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({ percentage: 100, passed: true });

      const [updatedAttempt] = await db.select().from(moduleAttempts).where(eq(moduleAttempts.id, attempt.id));
      expect(updatedAttempt.status).toBe("completed");

      const [answer] = await db.select().from(quizAttemptAnswers).where(eq(quizAttemptAnswers.moduleAttemptId, attempt.id));
      expect(answer.isCorrect).toBe(true);
    } finally {
      await db.delete(quizAttemptAnswers).where(eq(quizAttemptAnswers.moduleAttemptId, attempt.id));
      await db.delete(moduleAttempts).where(eq(moduleAttempts.id, attempt.id));
      await db.delete(quizChoices).where(eq(quizChoices.questionId, question.id));
      await db.delete(quizQuestions).where(eq(quizQuestions.id, question.id));
      await db.delete(quizModuleVersions).where(eq(quizModuleVersions.moduleVersionId, version.id));
      await db.update(modules).set({ currentVersionId: null }).where(eq(modules.id, mod.id));
      await db.delete(moduleVersions).where(eq(moduleVersions.id, version.id));
      await db.delete(modules).where(eq(modules.id, mod.id));
      await db.delete(courses).where(eq(courses.id, course.id));
      await db.delete(users).where(eq(users.id, user.id));
    }
  });

  it("scores a wrong answer as failed and marks the attempt failed", async () => {
    const { user, course, mod, version, question, wrong, attempt } = await seedQuiz(70);
    try {
      const request = new NextRequest("http://localhost/api/quiz/submit", {
        method: "POST",
        body: JSON.stringify({
          attemptId: attempt.id,
          answers: [{ questionId: question.id, selectedChoiceIds: [wrong.id] }],
        }),
      });
      const response = await POST(request);
      const body = await response.json();
      expect(body).toEqual({ percentage: 0, passed: false });

      const [updatedAttempt] = await db.select().from(moduleAttempts).where(eq(moduleAttempts.id, attempt.id));
      expect(updatedAttempt.status).toBe("failed");
    } finally {
      await db.delete(quizAttemptAnswers).where(eq(quizAttemptAnswers.moduleAttemptId, attempt.id));
      await db.delete(moduleAttempts).where(eq(moduleAttempts.id, attempt.id));
      await db.delete(quizChoices).where(eq(quizChoices.questionId, question.id));
      await db.delete(quizQuestions).where(eq(quizQuestions.id, question.id));
      await db.delete(quizModuleVersions).where(eq(quizModuleVersions.moduleVersionId, version.id));
      await db.update(modules).set({ currentVersionId: null }).where(eq(modules.id, mod.id));
      await db.delete(moduleVersions).where(eq(moduleVersions.id, version.id));
      await db.delete(modules).where(eq(modules.id, mod.id));
      await db.delete(courses).where(eq(courses.id, course.id));
      await db.delete(users).where(eq(users.id, user.id));
    }
  });

  it("rejects re-submitting an already-scored attempt", async () => {
    const { user, course, mod, version, question, right, attempt } = await seedQuiz(70);
    try {
      const body = JSON.stringify({ attemptId: attempt.id, answers: [{ questionId: question.id, selectedChoiceIds: [right.id] }] });
      await POST(new NextRequest("http://localhost/api/quiz/submit", { method: "POST", body }));
      const second = await POST(new NextRequest("http://localhost/api/quiz/submit", { method: "POST", body }));
      expect(second.status).toBe(400);
    } finally {
      await db.delete(quizAttemptAnswers).where(eq(quizAttemptAnswers.moduleAttemptId, attempt.id));
      await db.delete(moduleAttempts).where(eq(moduleAttempts.id, attempt.id));
      await db.delete(quizChoices).where(eq(quizChoices.questionId, question.id));
      await db.delete(quizQuestions).where(eq(quizQuestions.id, question.id));
      await db.delete(quizModuleVersions).where(eq(quizModuleVersions.moduleVersionId, version.id));
      await db.update(modules).set({ currentVersionId: null }).where(eq(modules.id, mod.id));
      await db.delete(moduleVersions).where(eq(moduleVersions.id, version.id));
      await db.delete(modules).where(eq(modules.id, mod.id));
      await db.delete(courses).where(eq(courses.id, course.id));
      await db.delete(users).where(eq(users.id, user.id));
    }
  });

  it("returns 404 for an attempt that doesn't belong to the signed-in user", async () => {
    const { user, course, mod, version, question, right, attempt } = await seedQuiz(70);
    const [otherUser] = await db.insert(users).values({ email: `other-${randomUUID()}@example.com`, displayName: "Other" }).returning();
    const [otherAttempt] = await db.insert(moduleAttempts).values({ moduleVersionId: version.id, userId: otherUser.id, attemptNumber: 1 }).returning();
    try {
      const response = await POST(
        new NextRequest("http://localhost/api/quiz/submit", {
          method: "POST",
          body: JSON.stringify({ attemptId: otherAttempt.id, answers: [{ questionId: question.id, selectedChoiceIds: [right.id] }] }),
        })
      );
      expect(response.status).toBe(404);
    } finally {
      await db.delete(moduleAttempts).where(eq(moduleAttempts.id, otherAttempt.id));
      await db.delete(users).where(eq(users.id, otherUser.id));
      await db.delete(moduleAttempts).where(eq(moduleAttempts.id, attempt.id));
      await db.delete(quizChoices).where(eq(quizChoices.questionId, question.id));
      await db.delete(quizQuestions).where(eq(quizQuestions.id, question.id));
      await db.delete(quizModuleVersions).where(eq(quizModuleVersions.moduleVersionId, version.id));
      await db.update(modules).set({ currentVersionId: null }).where(eq(modules.id, mod.id));
      await db.delete(moduleVersions).where(eq(moduleVersions.id, version.id));
      await db.delete(modules).where(eq(modules.id, mod.id));
      await db.delete(courses).where(eq(courses.id, course.id));
      await db.delete(users).where(eq(users.id, user.id));
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/api/quiz/submit/route.test.ts`
Expected: FAIL — route doesn't exist.

- [ ] **Step 3: Implement it**

`app/api/quiz/submit/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { moduleAttempts, quizAttemptAnswers, quizChoices, quizModuleVersions, quizQuestions } from "@/lib/db/schema";
import { getUserIdByEmail } from "@/lib/db/users";
import { scoreAnswer, scoreAttempt } from "@/lib/quiz/scoring";
import { recordModuleCompletion } from "@/lib/db/module-progress";
import { badRequest, isUuid, notFound, serverError } from "@/lib/api/errors";
import { auth } from "@/auth";

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    const userEmail = session?.user?.email;
    if (!userEmail) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }
    const userId = await getUserIdByEmail(userEmail);
    if (!userId) {
      return NextResponse.json({ error: "User record not found" }, { status: 404 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return badRequest("Request body must be valid JSON");
    }
    const { attemptId, answers } = (body ?? {}) as {
      attemptId?: string;
      answers?: { questionId: string; selectedChoiceIds: string[] }[];
    };
    if (!attemptId || !answers) {
      return badRequest("attemptId and answers are required");
    }
    if (!isUuid(attemptId)) {
      return badRequest("attemptId must be a UUID");
    }

    // Both a missing attempt and someone else's attempt collapse to the
    // same 404 - matches the SCORM/video commit routes' rationale.
    const [attempt] = await db.select().from(moduleAttempts).where(eq(moduleAttempts.id, attemptId));
    if (!attempt || attempt.userId !== userId) {
      return notFound("Attempt not found");
    }
    if (attempt.status === "completed" || attempt.status === "failed") {
      return badRequest("This attempt has already been scored");
    }

    const [quizVersion] = await db
      .select()
      .from(quizModuleVersions)
      .where(eq(quizModuleVersions.moduleVersionId, attempt.moduleVersionId));
    if (!quizVersion) {
      return notFound("Quiz not found");
    }

    const questions = await db
      .select()
      .from(quizQuestions)
      .where(eq(quizQuestions.quizModuleVersionId, attempt.moduleVersionId));

    const choicesByQuestion = new Map<string, { id: string; isCorrect: boolean }[]>();
    for (const question of questions) {
      const questionChoices = await db
        .select({ id: quizChoices.id, isCorrect: quizChoices.isCorrect })
        .from(quizChoices)
        .where(eq(quizChoices.questionId, question.id));
      choicesByQuestion.set(question.id, questionChoices);
    }

    const answersByQuestionId = new Map(answers.map((a) => [a.questionId, a.selectedChoiceIds]));

    const scoredQuestions = questions.map((question) => {
      if (question.questionType !== "single_choice" && question.questionType !== "multi_choice" && question.questionType !== "true_false") {
        throw new Error(`question_type '${question.questionType}' is not supported`);
      }
      const questionChoices = choicesByQuestion.get(question.id) ?? [];
      const selectedChoiceIds = answersByQuestionId.get(question.id) ?? [];
      const isCorrect = scoreAnswer({ questionType: question.questionType, choices: questionChoices }, selectedChoiceIds);
      return { questionId: question.id, points: question.points, isCorrect, selectedChoiceIds };
    });

    const result = scoreAttempt(scoredQuestions, quizVersion.passingScorePct);

    await db.transaction(async (tx) => {
      if (scoredQuestions.length > 0) {
        await tx.insert(quizAttemptAnswers).values(
          scoredQuestions.map((q) => ({
            moduleAttemptId: attempt.id,
            questionId: q.questionId,
            selectedChoiceIds: q.selectedChoiceIds,
            isCorrect: q.isCorrect,
          }))
        );
      }
      await tx
        .update(moduleAttempts)
        .set({ status: result.passed ? "completed" : "failed", endedAt: new Date() })
        .where(eq(moduleAttempts.id, attempt.id));
    });

    try {
      await recordModuleCompletion({ userId, moduleVersionId: attempt.moduleVersionId });
    } catch (error) {
      console.error("recordModuleCompletion failed after a successful quiz submission", error);
    }

    return NextResponse.json({ percentage: result.percentage, passed: result.passed });
  } catch (error) {
    return serverError(error);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/api/quiz/submit/route.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/api/quiz/submit/route.ts app/api/quiz/submit/route.test.ts
git commit -m "feat: add POST /api/quiz/submit (scoring, module_progress integration)"
```

---

## Task 7: Admin quiz-authoring API routes

**Files:**
- Create: `app/api/admin/courses/[courseId]/modules/quiz/route.ts`
- Create: `app/api/admin/quiz/[moduleVersionId]/questions/route.ts` (`GET` list, `POST` add)
- Create: `app/api/admin/quiz/[moduleVersionId]/questions/[questionId]/route.ts` (`PATCH`, `DELETE`)
- Create: `app/api/admin/quiz/[moduleVersionId]/route.ts` (`PATCH` passing score)
- Test: matching `.test.ts` for each

**Interfaces:**
- Consumes: `createQuizModule`, `addQuestion`, `updateQuestion`, `deleteQuestion`, `setPassingScore` from `lib/db/quiz-authoring.ts` (Task 3).
- Produces: the four routes below, consumed by the admin quiz editor UI (Task 8).

All four routes sit under `/api/admin/*`, already covered by the centralized `proxy.ts` + `lib/auth/admin-gate.ts` path-based admin gate — no per-route role check needed, matching every other `/api/admin/*` route in this codebase.

- [ ] **Step 1: Write the failing tests**

`app/api/admin/courses/[courseId]/modules/quiz/route.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { POST } from "./route";
import { db } from "@/lib/db/client";
import { courses, modules } from "@/lib/db/schema";

describe("POST /api/admin/courses/[courseId]/modules/quiz", () => {
  it("creates a quiz module for the course", async () => {
    const [course] = await db.insert(courses).values({ code: `ADMIN-QUIZ-${randomUUID()}`, title: "x" }).returning();
    try {
      const response = await POST(
        new NextRequest("http://localhost/x", { method: "POST", body: JSON.stringify({ title: "New Quiz" }) }),
        { params: Promise.resolve({ courseId: course.id }) }
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.moduleId).toBeDefined();
      expect(body.moduleVersionId).toBeDefined();

      const [mod] = await db.select().from(modules).where(eq(modules.id, body.moduleId));
      expect(mod.moduleType).toBe("quiz");
      expect(mod.title).toBe("New Quiz");
    } finally {
      await db.delete(modules).where(eq(modules.courseId, course.id));
      await db.delete(courses).where(eq(courses.id, course.id));
    }
  });
});
```

`app/api/admin/quiz/[moduleVersionId]/questions/route.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { GET, POST } from "./route";
import { createQuizModule } from "@/lib/db/quiz-authoring";
import { db } from "@/lib/db/client";
import { courses, modules, moduleVersions, quizModuleVersions, quizQuestions, quizChoices } from "@/lib/db/schema";

describe("POST /api/admin/quiz/[moduleVersionId]/questions", () => {
  it("adds a question with choices", async () => {
    const [course] = await db.insert(courses).values({ code: `ADMIN-QUIZ-Q-${randomUUID()}`, title: "x" }).returning();
    const { moduleId, moduleVersionId } = await createQuizModule(course.id, "Quiz");
    try {
      const response = await POST(
        new NextRequest("http://localhost/x", {
          method: "POST",
          body: JSON.stringify({
            questionType: "single_choice",
            prompt: "2+2?",
            points: 1,
            choices: [{ choiceText: "3", isCorrect: false }, { choiceText: "4", isCorrect: true }],
          }),
        }),
        { params: Promise.resolve({ moduleVersionId }) }
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.questionId).toBeDefined();
    } finally {
      const questions = await db.select().from(quizQuestions).where(eq(quizQuestions.quizModuleVersionId, moduleVersionId));
      for (const q of questions) await db.delete(quizChoices).where(eq(quizChoices.questionId, q.id));
      await db.delete(quizQuestions).where(eq(quizQuestions.quizModuleVersionId, moduleVersionId));
      await db.delete(quizModuleVersions).where(eq(quizModuleVersions.moduleVersionId, moduleVersionId));
      await db.update(modules).set({ currentVersionId: null }).where(eq(modules.id, moduleId));
      await db.delete(moduleVersions).where(eq(moduleVersions.id, moduleVersionId));
      await db.delete(modules).where(eq(modules.id, moduleId));
      await db.delete(courses).where(eq(courses.id, course.id));
    }
  });

  it("rejects a 'text' question type with 400", async () => {
    const [course] = await db.insert(courses).values({ code: `ADMIN-QUIZ-TXT-${randomUUID()}`, title: "x" }).returning();
    const { moduleId, moduleVersionId } = await createQuizModule(course.id, "Quiz");
    try {
      const response = await POST(
        new NextRequest("http://localhost/x", {
          method: "POST",
          body: JSON.stringify({ questionType: "text", prompt: "Explain", points: 1, choices: [] }),
        }),
        { params: Promise.resolve({ moduleVersionId }) }
      );
      expect(response.status).toBe(400);
    } finally {
      await db.delete(quizModuleVersions).where(eq(quizModuleVersions.moduleVersionId, moduleVersionId));
      await db.update(modules).set({ currentVersionId: null }).where(eq(modules.id, moduleId));
      await db.delete(moduleVersions).where(eq(moduleVersions.id, moduleVersionId));
      await db.delete(modules).where(eq(modules.id, moduleId));
      await db.delete(courses).where(eq(courses.id, course.id));
    }
  });
});

describe("GET /api/admin/quiz/[moduleVersionId]/questions", () => {
  it("lists questions with their choices in sort order", async () => {
    const [course] = await db.insert(courses).values({ code: `ADMIN-QUIZ-LIST-${randomUUID()}`, title: "x" }).returning();
    const { moduleId, moduleVersionId } = await createQuizModule(course.id, "Quiz");
    try {
      await POST(
        new NextRequest("http://localhost/x", {
          method: "POST",
          body: JSON.stringify({
            questionType: "true_false",
            prompt: "The sky is blue.",
            points: 1,
            choices: [{ choiceText: "True", isCorrect: true }, { choiceText: "False", isCorrect: false }],
          }),
        }),
        { params: Promise.resolve({ moduleVersionId }) }
      );

      const response = await GET(new NextRequest("http://localhost/x"), { params: Promise.resolve({ moduleVersionId }) });
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.questions).toHaveLength(1);
      expect(body.questions[0].choices).toHaveLength(2);
    } finally {
      const questions = await db.select().from(quizQuestions).where(eq(quizQuestions.quizModuleVersionId, moduleVersionId));
      for (const q of questions) await db.delete(quizChoices).where(eq(quizChoices.questionId, q.id));
      await db.delete(quizQuestions).where(eq(quizQuestions.quizModuleVersionId, moduleVersionId));
      await db.delete(quizModuleVersions).where(eq(quizModuleVersions.moduleVersionId, moduleVersionId));
      await db.update(modules).set({ currentVersionId: null }).where(eq(modules.id, moduleId));
      await db.delete(moduleVersions).where(eq(moduleVersions.id, moduleVersionId));
      await db.delete(modules).where(eq(modules.id, moduleId));
      await db.delete(courses).where(eq(courses.id, course.id));
    }
  });
});
```

`app/api/admin/quiz/[moduleVersionId]/questions/[questionId]/route.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { PATCH, DELETE } from "./route";
import { createQuizModule, addQuestion } from "@/lib/db/quiz-authoring";
import { db } from "@/lib/db/client";
import { courses, modules, moduleVersions, quizModuleVersions, quizQuestions, quizChoices } from "@/lib/db/schema";

describe("PATCH/DELETE /api/admin/quiz/[moduleVersionId]/questions/[questionId]", () => {
  it("updates and then deletes a question", async () => {
    const [course] = await db.insert(courses).values({ code: `ADMIN-QUIZ-QID-${randomUUID()}`, title: "x" }).returning();
    const { moduleId, moduleVersionId } = await createQuizModule(course.id, "Quiz");
    const { questionId } = await addQuestion(moduleVersionId, {
      questionType: "single_choice",
      prompt: "old prompt",
      points: 1,
      choices: [{ choiceText: "a", isCorrect: true }],
    });
    try {
      const patchResponse = await PATCH(
        new NextRequest("http://localhost/x", { method: "PATCH", body: JSON.stringify({ prompt: "new prompt" }) }),
        { params: Promise.resolve({ moduleVersionId, questionId }) }
      );
      expect(patchResponse.status).toBe(200);
      const [updated] = await db.select().from(quizQuestions).where(eq(quizQuestions.id, questionId));
      expect(updated.prompt).toBe("new prompt");

      const deleteResponse = await DELETE(new NextRequest("http://localhost/x", { method: "DELETE" }), {
        params: Promise.resolve({ moduleVersionId, questionId }),
      });
      expect(deleteResponse.status).toBe(200);
      expect(await db.select().from(quizQuestions).where(eq(quizQuestions.id, questionId))).toHaveLength(0);
    } finally {
      await db.delete(quizModuleVersions).where(eq(quizModuleVersions.moduleVersionId, moduleVersionId));
      await db.update(modules).set({ currentVersionId: null }).where(eq(modules.id, moduleId));
      await db.delete(moduleVersions).where(eq(moduleVersions.id, moduleVersionId));
      await db.delete(modules).where(eq(modules.id, moduleId));
      await db.delete(courses).where(eq(courses.id, course.id));
    }
  });
});
```

`app/api/admin/quiz/[moduleVersionId]/route.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { PATCH } from "./route";
import { createQuizModule } from "@/lib/db/quiz-authoring";
import { db } from "@/lib/db/client";
import { courses, modules, moduleVersions, quizModuleVersions } from "@/lib/db/schema";

describe("PATCH /api/admin/quiz/[moduleVersionId]", () => {
  it("updates the passing score", async () => {
    const [course] = await db.insert(courses).values({ code: `ADMIN-QUIZ-SCORE-${randomUUID()}`, title: "x" }).returning();
    const { moduleId, moduleVersionId } = await createQuizModule(course.id, "Quiz");
    try {
      const response = await PATCH(
        new NextRequest("http://localhost/x", { method: "PATCH", body: JSON.stringify({ passingScorePct: 90 }) }),
        { params: Promise.resolve({ moduleVersionId }) }
      );
      expect(response.status).toBe(200);
      const [quizVersion] = await db.select().from(quizModuleVersions).where(eq(quizModuleVersions.moduleVersionId, moduleVersionId));
      expect(quizVersion.passingScorePct).toBe(90);
    } finally {
      await db.delete(quizModuleVersions).where(eq(quizModuleVersions.moduleVersionId, moduleVersionId));
      await db.update(modules).set({ currentVersionId: null }).where(eq(modules.id, moduleId));
      await db.delete(moduleVersions).where(eq(moduleVersions.id, moduleVersionId));
      await db.delete(modules).where(eq(modules.id, moduleId));
      await db.delete(courses).where(eq(courses.id, course.id));
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run "app/api/admin/courses/[courseId]/modules/quiz/route.test.ts" "app/api/admin/quiz/[moduleVersionId]"`
Expected: FAIL — routes don't exist.

- [ ] **Step 3: Implement the routes**

`app/api/admin/courses/[courseId]/modules/quiz/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { createQuizModule } from "@/lib/db/quiz-authoring";
import { badRequest, serverError } from "@/lib/api/errors";

export async function POST(request: NextRequest, props: { params: Promise<{ courseId: string }> }) {
  try {
    const { courseId } = await props.params;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return badRequest("Request body must be valid JSON");
    }
    const { title } = (body ?? {}) as { title?: string };
    if (!title) {
      return badRequest("title is required");
    }
    const { moduleId, moduleVersionId } = await createQuizModule(courseId, title);
    return NextResponse.json({ moduleId, moduleVersionId });
  } catch (error) {
    return serverError(error);
  }
}
```

`app/api/admin/quiz/[moduleVersionId]/questions/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { quizQuestions, quizChoices } from "@/lib/db/schema";
import { addQuestion } from "@/lib/db/quiz-authoring";
import { badRequest, serverError } from "@/lib/api/errors";

export async function GET(_request: NextRequest, props: { params: Promise<{ moduleVersionId: string }> }) {
  try {
    const { moduleVersionId } = await props.params;
    const questions = await db
      .select()
      .from(quizQuestions)
      .where(eq(quizQuestions.quizModuleVersionId, moduleVersionId))
      .orderBy(quizQuestions.sortOrder);
    const withChoices = await Promise.all(
      questions.map(async (question) => {
        const choices = await db
          .select()
          .from(quizChoices)
          .where(eq(quizChoices.questionId, question.id))
          .orderBy(quizChoices.sortOrder);
        return { ...question, choices };
      })
    );
    return NextResponse.json({ questions: withChoices });
  } catch (error) {
    return serverError(error);
  }
}

export async function POST(request: NextRequest, props: { params: Promise<{ moduleVersionId: string }> }) {
  try {
    const { moduleVersionId } = await props.params;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return badRequest("Request body must be valid JSON");
    }
    const { questionType, prompt, points, choices } = (body ?? {}) as {
      questionType?: string;
      prompt?: string;
      points?: number;
      choices?: { choiceText: string; isCorrect: boolean }[];
    };
    if (!questionType || !prompt || points === undefined || !choices) {
      return badRequest("questionType, prompt, points, and choices are required");
    }
    const { questionId } = await addQuestion(moduleVersionId, { questionType, prompt, points, choices });
    return NextResponse.json({ questionId });
  } catch (error) {
    if (error instanceof Error && error.message.includes("is not supported")) {
      return badRequest(error.message);
    }
    return serverError(error);
  }
}
```

`app/api/admin/quiz/[moduleVersionId]/questions/[questionId]/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { updateQuestion, deleteQuestion } from "@/lib/db/quiz-authoring";
import { badRequest, serverError } from "@/lib/api/errors";

export async function PATCH(request: NextRequest, props: { params: Promise<{ questionId: string }> }) {
  try {
    const { questionId } = await props.params;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return badRequest("Request body must be valid JSON");
    }
    const { prompt, points } = (body ?? {}) as { prompt?: string; points?: number };
    await updateQuestion(questionId, { prompt, points });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return serverError(error);
  }
}

export async function DELETE(_request: NextRequest, props: { params: Promise<{ questionId: string }> }) {
  try {
    const { questionId } = await props.params;
    await deleteQuestion(questionId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return serverError(error);
  }
}
```

`app/api/admin/quiz/[moduleVersionId]/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { setPassingScore } from "@/lib/db/quiz-authoring";
import { badRequest, serverError } from "@/lib/api/errors";

export async function PATCH(request: NextRequest, props: { params: Promise<{ moduleVersionId: string }> }) {
  try {
    const { moduleVersionId } = await props.params;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return badRequest("Request body must be valid JSON");
    }
    const { passingScorePct } = (body ?? {}) as { passingScorePct?: number };
    if (passingScorePct === undefined) {
      return badRequest("passingScorePct is required");
    }
    await setPassingScore(moduleVersionId, passingScorePct);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return serverError(error);
  }
}
```

- [ ] **Step 4: Run test to verify everything passes**

Run: `npx vitest run "app/api/admin/courses/[courseId]/modules/quiz" "app/api/admin/quiz/[moduleVersionId]"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add "app/api/admin/courses/[courseId]/modules/quiz" "app/api/admin/quiz"
git commit -m "feat: add admin quiz-authoring API routes"
```

---

## Task 8: Admin quiz editor UI

**Files:**
- Modify: `app/(app)/admin/content/builder/[courseId]/builder-client.tsx`
- Create: `app/(app)/admin/content/builder/[courseId]/quiz/[moduleVersionId]/page.tsx`
- Create: `app/(app)/admin/content/builder/[courseId]/quiz/[moduleVersionId]/quiz-editor-client.tsx`
- Modify: `lib/db/queries.ts` (or wherever `getCourseForBuilder`'s `CourseForBuilder` module mapping lives) — expose `moduleVersionId` per module, if not already exposed.

**Interfaces:**
- Consumes: `POST /api/admin/courses/[courseId]/modules/quiz`, `GET`/`POST /api/admin/quiz/[moduleVersionId]/questions`, `PATCH`/`DELETE /api/admin/quiz/[moduleVersionId]/questions/[questionId]`, `PATCH /api/admin/quiz/[moduleVersionId]` (all Task 7).

This task is UI-only; verify manually in the browser, matching this codebase's existing pattern for admin authoring UI (no automated test suite for the builder's own React components — the SCORM/video "Add Module" tabs aren't unit-tested either).

- [ ] **Step 1: Confirm `moduleVersionId` is exposed on `BuilderModule`**

Read `getCourseForBuilder` (in `lib/db/course-authoring.ts` or `lib/db/queries.ts` — grep for `CourseForBuilder`) and confirm each module row already includes `moduleVersionId` alongside `moduleType`. If it doesn't, add it to the select/mapping the same way `moduleType` is already exposed, then update `BuilderModule`'s type.

- [ ] **Step 2: Add a "Quiz" tab to the Add Module dialog**

In `builder-client.tsx`, find `<Tabs defaultValue="scorm" ...>` (existing `TabsList`/`TabsTrigger` for `scorm`/`video`/`existing-video`). Add a fourth trigger and content pane, matching the exact `formData`/`fetch`/`setAddModuleOpen(false)`/`router.refresh()` idiom the existing tabs already use (read them first):

```tsx
<TabsTrigger value="quiz">Add Quiz</TabsTrigger>
```

```tsx
<TabsContent value="quiz">
  <form
    onSubmit={async (e) => {
      e.preventDefault();
      const formData = new FormData(e.currentTarget);
      const title = formData.get("title") as string;
      const response = await fetch(`/api/admin/courses/${course.id}/modules/quiz`, {
        method: "POST",
        body: JSON.stringify({ title }),
      });
      if (response.ok) {
        setAddModuleOpen(false);
        router.refresh();
      }
    }}
    className="flex flex-col gap-4"
  >
    <div className="flex flex-col gap-2">
      <Label htmlFor="quiz-title">Quiz title</Label>
      <Input id="quiz-title" name="title" required placeholder="Module Quiz" />
    </div>
    <Button type="submit">Create Quiz</Button>
  </form>
</TabsContent>
```

- [ ] **Step 3: Add an "Edit Questions" link on quiz `ModuleRow`s**

In `ModuleRow` (same file), add a conditional link before the Remove button:

```tsx
{module.moduleType === "quiz" && module.moduleVersionId && (
  <Link href={`/admin/content/builder/${courseId}/quiz/${module.moduleVersionId}`}>
    <Button type="button" variant="outline" size="sm">
      Edit Questions
    </Button>
  </Link>
)}
```

Thread `courseId` into `ModuleRow`'s props if it doesn't already receive it — check the existing render call site in `BuilderClient`.

- [ ] **Step 4: Build the quiz editor page**

`app/(app)/admin/content/builder/[courseId]/quiz/[moduleVersionId]/page.tsx`:

```tsx
import { QuizEditorClient } from "./quiz-editor-client";

export default async function QuizEditorPage(
  props: PageProps<"/admin/content/builder/[courseId]/quiz/[moduleVersionId]">
) {
  const { courseId, moduleVersionId } = await props.params;
  return <QuizEditorClient courseId={courseId} moduleVersionId={moduleVersionId} />;
}
```

- [ ] **Step 5: Build the quiz editor client component**

`quiz-editor-client.tsx` — `"use client"`; on mount, `GET /api/admin/quiz/[moduleVersionId]/questions` to populate the question list; renders each question with its choices and Edit/Delete controls; an "Add Question" form (prompt input, question-type select limited to `single_choice`/`multi_choice`/`true_false`, dynamic choice rows each with a text input and an `is_correct` checkbox/radio depending on type) that `POST`s to the same endpoint; a passing-score input that `PATCH`s `/api/admin/quiz/[moduleVersionId]`. Follow this codebase's existing client-component conventions — `useState`/`useEffect` for the fetched list, inline loading/error state, no toast library — matching `builder-client.tsx`'s and `users-section.tsx`'s existing `fetch()` error-handling shape.

- [ ] **Step 6: Manual verification**

Start the dev server, open `/admin/content/builder/[a real courseId]`, click "Add Module" → "Add Quiz", create one, click "Edit Questions", add 2-3 questions of different types, confirm they persist on reload, confirm the passing-score input saves.

- [ ] **Step 7: Commit**

```bash
git add "app/(app)/admin/content/builder" lib/db/queries.ts
git commit -m "feat: add quiz authoring UI (add-quiz tab, question/choice editor)"
```

---

## Task 9: Learner quiz-taking page

**Files:**
- Create: `app/(app)/courses/[id]/quiz/[moduleId]/page.tsx`
- Create: `components/quiz/quiz-player.tsx`
- Modify: `app/(app)/courses/[id]/page.tsx`

**Interfaces:**
- Consumes: `POST /api/quiz/attempts` (Task 5), `POST /api/quiz/submit` (Task 6), `getLatestQuizStatus` (Task 4), `getEnrollmentId` (existing, `lib/db/enrollments.ts`), `isAdminRole` (existing, `lib/roles.ts`).

- [ ] **Step 1: Build the quiz launch page**

Read `app/(app)/courses/[id]/scorm/[moduleId]/page.tsx` first to match its exact structure, then create `app/(app)/courses/[id]/quiz/[moduleId]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { CheckCircle2, XCircle } from "lucide-react";
import { auth } from "@/auth";
import { db } from "@/lib/db/client";
import { eq } from "drizzle-orm";
import { modules, moduleVersions, quizModuleVersions, quizQuestions, quizChoices } from "@/lib/db/schema";
import { getLatestQuizStatus } from "@/lib/quiz/completion-status";
import { getUserIdByEmail } from "@/lib/db/users";
import { getEnrollmentId } from "@/lib/db/enrollments";
import { isAdminRole } from "@/lib/roles";
import { QuizPlayer } from "@/components/quiz/quiz-player";
import { UnavailableState } from "@/components/ui/unavailable-state";
import { isNextNotFoundError } from "@/lib/utils";

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

    const quizStatus = await getLatestQuizStatus(moduleId, userId);
    if (quizStatus === "completed" || quizStatus === "failed") {
      return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-center">
          {quizStatus === "completed" ? (
            <CheckCircle2 className="h-10 w-10 text-emerald-600" />
          ) : (
            <XCircle className="h-10 w-10 text-destructive" />
          )}
          <p className="text-lg font-medium">{quizStatus === "completed" ? "Quiz passed" : "Quiz not passed"}</p>
          <p className="text-sm text-muted-foreground">You&apos;ve already completed this quiz.</p>
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

    return <QuizPlayer moduleVersionId={moduleId} questions={questionsWithChoices} />;
  } catch (err) {
    if (isNextNotFoundError(err)) {
      throw err;
    }
    return <UnavailableState message="Could not load this quiz right now. Please try again in a moment." />;
  }
}
```

- [ ] **Step 2: Build the quiz player client component**

`components/quiz/quiz-player.tsx` — `"use client"`; props `{ moduleVersionId: string; questions: { id: string; prompt: string; questionType: string; choices: { id: string; choiceText: string }[] }[] }`. On mount, `POST /api/quiz/attempts` with `{moduleVersionId}` to get an `attemptId` (store in state, show a loading spinner until it resolves). Render each question: radio group for `single_choice`/`true_false`, checkbox group for `multi_choice`, tracking selected choice ids per question id in local state (`Record<string, string[]>`). A Submit button (disabled until the attempt id is loaded) posts `{attemptId, answers: Object.entries(selections).map(([questionId, selectedChoiceIds]) => ({questionId, selectedChoiceIds}))}` to `/api/quiz/submit`, then renders the returned `{percentage, passed}` as a result screen (reuse the same pass/fail visual treatment as Step 1's already-completed state). Follow `components/scorm/scorm-player.tsx` or `components/video/mux-video-player.tsx`'s existing structural conventions (props shape, loading/error local state) rather than inventing a new pattern.

- [ ] **Step 3: Wire `quiz` into the course detail page's module rendering**

In `app/(app)/courses/[id]/page.tsx`, the real-course branch's `modulesWithStatus` mapping currently branches only on `module.moduleType === "video"` vs. else-SCORM for both the `done` computation and the launch link. Add a quiz branch to both:

```ts
          let done = false;
          if (userId && launchable) {
            if (module.moduleType === "video") {
              const videoStatus = await getLatestVideoStatus(module.moduleVersionId, userId);
              done = videoStatus === "completed";
            } else if (module.moduleType === "quiz") {
              const quizStatus = await getLatestQuizStatus(module.moduleVersionId, userId);
              done = quizStatus === "completed";
            } else {
              const lessonStatus = await getLatestLessonStatus(module.moduleVersionId, userId);
              done = lessonStatus === "completed" || lessonStatus === "passed";
            }
          }
```

and the launch link:

```tsx
                      href={
                        module.moduleType === "video"
                          ? `/courses/${realCourse.id}/video/${module.moduleVersionId}`
                          : module.moduleType === "quiz"
                            ? `/courses/${realCourse.id}/quiz/${module.moduleVersionId}`
                            : `/courses/${realCourse.id}/scorm/${module.moduleVersionId}`
                      }
```

Add the `getLatestQuizStatus` import from `@/lib/quiz/completion-status`.

`getTrackedModuleVersionIds` (called earlier in this page to compute `launchable`) already reads `TRACKED_MODULE_TYPES` from Task 4's change, so quiz modules become `launchable` automatically once they have a `currentVersionId` — no separate readiness gate needed the way video needs a Mux-ready check.

- [ ] **Step 4: Run the full test suite and build**

Run: `npx vitest run && npx next build`
Expected: All tests pass, clean build.

- [ ] **Step 5: Manual verification**

Start the dev server, sign in as a learner enrolled in a course with the quiz module created in Task 8, take the quiz, confirm the pass/fail page appears afterward and the course detail page shows it as done/not-done correctly.

- [ ] **Step 6: Commit**

```bash
git add "app/(app)/courses/[id]" components/quiz
git commit -m "feat: add learner quiz-taking page and wire quiz into course detail"
```

---

## Self-Review Notes

**Spec coverage:** §1 Schema → Task 1. §2 Data flow (authoring) → Tasks 3, 7, 8. §2 Data flow (learner takes quiz, submission/scoring) → Tasks 5, 6, 9. §2 Progress integration → Task 4. §3 Error handling (ownership/enrollment 404s, `text` rejection, re-submission rejection) → Task 6. §4 Testing → each task's own steps.

**Known deviations, called out explicitly:**
- Task 8 (admin UI) and part of Task 9 (quiz player component) rely on manual browser verification rather than automated tests, matching this codebase's existing pattern for the SCORM/video "Add Module" tabs and their player components — not a new gap introduced by this plan.
- The spec's "confirm whole-version copy-on-write on edit of a published quiz" testing item is not a separate task here: publishing/versioning is handled by the existing generic `module_versions` draft→published flow (unchanged by this plan), and no quiz-specific edit-a-published-version UI exists in v1 — editing only happens pre-publish, so there is no new copy-on-write code path to test.
