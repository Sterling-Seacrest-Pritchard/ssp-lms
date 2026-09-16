# Quiz Module Design (2026-09-16)

**Status:** Approved 2026-09-16, not yet implemented.

## Goal

Add a real quiz module type — the only content type SSP LMS supports today (SCORM, video) that can't assess a learner's knowledge. Closes the gap flagged in the [[Beta Readiness Punch List]] as a Tier 1 blocker: any course that isn't a SCORM package with its own embedded assessment has no way to test a learner.

## Context

The target schema for this already exists in `Database Design.md`, decided well before this pass: `module_versions` forks by type into `scorm_module_versions`, `video_module_versions`, or (until now, design-only) `quiz_module_versions`, exactly one per version. Quiz attempts were always meant to reuse the existing `module_attempts` table (already generic across module types, not a separate `quiz_attempts` table) plus a `quiz_attempt_answers` child table for per-question detail. Quiz versioning was already decided as whole-module copy-on-write, matching every other module type — any edit duplicates the full `module_versions` row and its questions/choices, never per-question diffing.

The Enrollments & Module Progress feature (shipped 2026-09-16, same day) built the persisted-progress machinery this module type needs to plug into: `assignCourse` creates an `enrollments` row, every module-type commit upserts `module_progress` and rolls the parent enrollment's status up, and `getCourseProgressForLearner` reads that persisted state. A quiz module's "finished" state needs the same treatment SCORM/video modules already get.

Unlike SCORM (uploaded as a package) or video (uploaded to Mux), a quiz has no external authoring tool — it must be built directly in this app. There is no existing quiz-authoring UI at all today.

## Decisions

- **v1 supports three auto-gradable question types only: `single_choice`, `multi_choice`, `true_false`.** The `text` (free-response) type from the original target design is explicitly excluded from v1 — manual grading for free-text answers is already listed as a deferred v2 item in `Database Design.md`. The schema's `question_type` check still allows the value (so a future pass doesn't need another migration), but the authoring UI and the submission API both reject it for now.
- **Ship v1 with fixed defaults, no per-quiz configurability.** `quiz_module_versions` carries `time_limit_seconds`, `max_attempts`, `shuffle_questions`, and `instructions` columns (matching the already-designed schema), but v1 doesn't expose admin controls for any of them: no time limit, unlimited attempts, no shuffling. The only per-quiz setting an admin actually sets in v1 is `passing_score_pct`. This avoids building four settings' worth of UI before anyone has asked for them.
- **Authoring is an in-app form builder**, not a JSON import. Adding a quiz module follows the same pattern already established for adding a SCORM or video module in the course builder; a quiz editor lets an admin add/reorder questions and their choices, marking which are correct.
- **One-shot submission, no autosave.** A learner answers all questions and submits once; there's no partial-save/resume-later state for v1, matching the "fixed defaults" simplicity decision above. An unanswered question at submit time counts as incorrect rather than blocking the submission — no client-side "answer everything" enforcement.
- **Scoring is immediate and automatic** — no manual grading step exists in v1 (consistent with excluding `text` questions). A submission is graded synchronously against `quiz_choices.is_correct` the moment it's received.
- **Quiz attempts reuse `module_attempts`, not a new table.** Matches the already-decided target schema and the existing pattern (SCORM/video attempts already live there). `quiz_attempt_answers` holds the per-question detail, one row per question per attempt.

## Non-Goals (this pass)

- Free-text (`text`) question type and any manual-grading workflow.
- Per-quiz time limits, attempt limits, question shuffling, or custom instructions text — schema columns exist, no UI to set them.
- Partial-save/resume-in-progress quiz state.
- Cross-course prerequisites gating quiz access.
- Question banks / randomized question pools (a fixed, ordered question list per quiz version).
- Editing a published quiz's questions in place — matches the existing whole-version copy-on-write rule; an edit always creates a new version.

## Design

### 1. Schema

```
quiz_module_versions (1:1 with module_versions, type=quiz)
  module_version_id  uuid pk, fk -> module_versions.id
  passing_score_pct  int, not null                 -- the only admin-configurable setting in v1
  time_limit_seconds int nullable                   -- reserved, unused v1
  max_attempts       int nullable                   -- reserved, unused v1
  shuffle_questions  boolean default false           -- reserved, unused v1
  instructions       text nullable                   -- reserved, unused v1

quiz_questions (immutable once the parent module_version is published)
  id                     uuid pk, default random
  quiz_module_version_id uuid fk -> quiz_module_versions.module_version_id
  sort_order             int
  question_type          text   -- 'single_choice' | 'multi_choice' | 'true_false' | 'text' (schema allows 'text'; v1 code path rejects it)
  prompt                 text
  points                 int default 1

quiz_choices (immutable once published)
  id           uuid pk, default random
  question_id  uuid fk -> quiz_questions.id
  sort_order   int
  choice_text  text
  is_correct   boolean default false

quiz_attempt_answers
  id                uuid pk, default random
  module_attempt_id uuid fk -> module_attempts.id
  question_id       uuid fk -> quiz_questions.id
  selected_choice_ids uuid[]  -- the choice id(s) the learner picked; single-element for single_choice/true_false
  is_correct        boolean   -- computed at submit time, stored for fast scoring/reporting
  unique (module_attempt_id, question_id)
```

No FK indexes beyond what the PK/unique constraints create, matching the existing schema-wide pattern (not a gap introduced here).

### 2. Data flow

- **Authoring:** admin adds a "Quiz" module in the course builder (same "add module" entry point as SCORM/video). A quiz editor page lets them add questions one at a time (prompt, type, points), and for each question add choices and mark which are correct (`single_choice`/`true_false` enforce exactly one correct choice client-side; `multi_choice` allows more than one). Sets `passing_score_pct`. Publishing the module version follows the existing draft→published flow and immutability trigger already enforced on `module_versions`.
- **Learner takes the quiz:** the quiz launch page (parallel to the SCORM/video launch pages, same enrollment gate — including the courseId-vs-moduleId cross-check fixed earlier today) creates a `module_attempts` row on entry (same `attemptNumber` pattern SCORM/video already use), renders all questions in `sort_order`, collects answers client-side, and submits once.
- **Submission/scoring:** the submit endpoint receives all answers in one request, looks up the quiz's questions/choices (from the immutable published version — never trust client-supplied "correct" info), computes `is_correct` per question and an overall percentage score, writes one `quiz_attempt_answers` row per question, and marks the `module_attempts` row `completed` (score ≥ `passing_score_pct`) or `failed`.
- **Progress integration:** the same `recordModuleCompletion` used by SCORM/video commits gets a `quiz` branch in its per-type dispatch — finished when the module_attempts row's status is `completed`. This feeds the existing `module_progress` upsert and `enrollments` status rollup unchanged.

### 3. Error handling

- Submitting a quiz attempt that doesn't belong to the signed-in learner, or for a module the learner isn't enrolled in, follows the exact same ownership/enrollment pattern already established for SCORM/video commit routes (both misses collapse to the same 404, per the existing rationale that a 403 would leak information to an attacker holding a guessed id).
- A `text`-type question reaching the submission or authoring API is rejected with a 400 — not silently ignored — since accepting it and never scoring it would be a confusing half-feature.
- Re-submitting an already-`completed`/`failed` attempt is rejected (`module_attempts` status is a one-way transition here, matching SCORM's own "already finished" dead-end behavior); the learner-facing page shows a finished state instead of re-rendering the quiz, mirroring the existing SCORM/video "already completed" pages.

### 4. Testing

- Schema tests: `quiz_module_versions`/`quiz_questions`/`quiz_choices`/`quiz_attempt_answers` constraints (uniqueness, FK relationships).
- Scoring-logic unit tests: single_choice, multi_choice (all-or-nothing per question — a `multi_choice` question is correct only if the learner's selected set exactly matches the choice set marked `is_correct`, no partial credit), true_false, and the overall percentage/pass-threshold calculation.
- Authoring API tests: create/edit quiz questions and choices, reject a `text` question type, confirm whole-version copy-on-write on edit of a published quiz.
- Submission route tests: correct/incorrect scoring, ownership/enrollment checks, re-submission rejection, `text`-question rejection.
- Integration test: a passing quiz submission correctly upserts `module_progress` and rolls the parent `enrollments.status` up, mirroring the existing SCORM/video commit-to-progress tests.

## Open Follow-Ups (deferred, not blockers for this spec)

- [ ] Free-text (`text`) questions + manual grading workflow.
- [ ] Per-quiz time limits, attempt limits, question shuffling, custom instructions UI.
- [ ] Partial-save/resume-in-progress quiz state.
- [ ] Question banks / randomized pools.
