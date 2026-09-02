# Course Authoring Subsystem — Design

**Status:** Approved 2026-09-02, not yet implemented.

## Goal

Let admins compose multiple modules (SCORM today, Video as a placeholder) into a single Course, reorder them, save progress as a Draft, and Publish — at which point the course appears on `/courses` as a full course card, indistinguishable from the existing mock courses, replacing today's separate "Live Courses" section.

## Context

The SCORM Import Test Slice and the learner-facing delivery work (both implemented and live as of 2026-09-02) proved the upload → parse → launch → commit mechanism end to end, but only for a one-shot flow: `/admin/content/upload` always creates a brand-new course, with exactly one module, in a single request. There is no way to add a second module to an existing course, no way to reorder modules, and no draft state an admin can safely leave and come back to.

The schema already has unused scaffolding for exactly this: `courses.status` and `module_versions.status` both default to `"draft"` and accept `"published"`, but no code anywhere reads or writes them meaningfully today — every uploaded course/module is immediately fully usable regardless of these fields' values.

Real courses today show up on `/courses` in a separate "Live Courses" section, tagged "Live", with none of the metadata (department, compliance, due date, thumbnail) that mock course cards show — this was an explicit, documented non-goal of the earlier learner-delivery work, deferred to here.

`/admin/videos` is presently 100% mocked — no real video upload, transcoding, or hosting integration exists (its own page copy says so). Building that is a separate, substantial integration project (a third-party service, transcoding, processing webhooks, playback URLs) unrelated in kind to the course-composition UI this spec covers.

## Non-Goals (explicitly deferred)

- **Real video upload/hosting.** Video modules in this pass are placeholders — title and an admin-entered duration estimate, no file, not playable by learners yet. Real ingest (Mux/Cloudflare Stream or similar) is its own follow-up project; this spec's schema and UI are built so that project slots in later without restructuring the course builder.
- **Course-level versioning.** Editing a published course's details or module list takes effect immediately — there is no "draft version of a published course" concept, matching how the rest of this app has no content-versioning beyond the existing per-module-version SCORM upload history.
- **RBAC beyond existing sign-in.** Same posture as the rest of the learner-facing app: any authenticated user can view any published course they can navigate to. Draft courses are gated from learners (see Access Gate below), not from admins-vs-other-admins.
- **Course-level reporting/analytics.** This spec adds course-level progress *computation* for the learner's own "Active"/"Finished" sorting on `/courses`, not an admin-facing reporting feature.
- **Enrollments.** Unchanged from the earlier learner-delivery spec — no `enrollments` table, a learner can launch and complete any published course's modules without enrolling in anything first.

## Design

### 1. Data model

Four new nullable columns on `courses`:

```ts
export const courses = pgTable("courses", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("draft"), // already existed
  department: text("department"),
  thumbnail: text("thumbnail"),
  compliance: boolean("compliance").notNull().default(false),
  dueDate: timestamp("due_date", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```

- `department`: free-text input in the builder (matches the existing free-text `courseCode`/`courseTitle`/`moduleTitle` inputs already in this app's upload form — no fixed department list exists anywhere else in the codebase to constrain it against). Rendered as `"General"` when blank.
- `thumbnail`: stores a Tailwind gradient class string, exactly like `lib/mock-data/courses.ts`'s `thumbnail` field (e.g. `"bg-gradient-to-br from-blue-500 to-indigo-600"`) — there is no image upload pipeline, so this reuses the same cheap, already-proven visual scheme instead of inventing one. Auto-picked from a small fixed rotation (5-6 entries, matching the mock data's own palette) keyed by a hash of the course id, with a manual override in the builder's Course Details card.
- `compliance`: defaults `false` (filler = "not compliance-required"), a checkbox in the builder.
- `dueDate`: stays genuinely `null` when unset — rendered as no due-date badge, matching the mock data's own optional `dueDate?: string` field. Never filled with a generated value.

New table, mirroring the existing `scormModuleVersions` pattern exactly:

```ts
export const videoModuleVersions = pgTable("video_module_versions", {
  moduleVersionId: uuid("module_version_id")
    .primaryKey()
    .references(() => moduleVersions.id),
  durationMinutes: integer("duration_minutes"),
});
```

No changes to `modules` or `moduleVersions` — `modules.moduleType` is already an unconstrained `text` column, so `"video"` is a valid value today with zero schema change. `courses.status` and `moduleVersions.status` (both already `draft`/`published`) become meaningfully read/written for the first time by this work, rather than new status concepts being invented.

### 2. Course builder UI

**New route:** `app/(app)/admin/content/builder/[courseId]/page.tsx`

"New Course" (replacing `/admin/content/upload` as the Content Authoring page's primary action) is a `POST` that creates an empty `courses` row (`status: "draft"`, a generated placeholder title like `"Untitled Course"`) and redirects straight into the builder — no separate creation form before the builder loads.

Single page, Card-based (matching this app's existing admin page style, no wizard):

- **Course Details card**: title, code, department, compliance checkbox, optional due date picker, thumbnail (small swatch picker over the fixed gradient rotation, defaulting to "Auto"). Each field autosaves on blur/change via a `PATCH /api/admin/courses/[courseId]` route — no explicit "Save Draft" button, since the course is already a persisted draft row from the moment it's created.
- **Modules card**: a drag-and-drop reorderable list (new dependency: `@dnd-kit/core` + `@dnd-kit/sortable` — nothing like this is installed today), each row showing title, a type badge (`SCORM` / `Video`), and a remove button. An "Add Module" button opens a dialog with two paths:
  - **Upload SCORM Package** — the existing upload form (course code/module title fields dropped, since the course already exists; keeps the file dropzone), now targeting this course (see Section 3).
  - **Add Video Placeholder** — a minimal form: module title + an estimated duration in minutes. No file. Creates a `modules` row (`moduleType: "video"`) + a `moduleVersions` row (`status: "published"`, published immediately since there's no parsing/validation step to gate on) + a `videoModuleVersions` row, then sets `modules.currentVersionId`.
- **Publish button** (top of page, alongside the Draft/Published status badge): disabled while the course has zero modules. Calls `POST /api/admin/courses/[courseId]/publish`, which sets `courses.status = "published"`. Publishing does not lock the course — admins can keep editing (add/reorder/remove modules, edit details) after publish, and changes are visible to learners immediately, matching this app's existing no-versioning posture.

Removing a module (in-builder, draft or published) deletes its `videoModuleVersions`/`scormModuleVersions` row, then its `moduleVersions` row(s), then the `modules` row itself — same FK-respecting order already established in this session's own test cleanup code and in `getRealCourseDetail`'s consumption pattern.

The Content Authoring page's course table (`app/(app)/admin/content/page.tsx`) currently renders a permanently-`disabled` "Edit" button for real courses — with the builder existing, this becomes a real link to `/admin/content/builder/[courseId]` (both draft and published rows), which is how an admin gets back into an existing course to keep building it or make changes after publish. The table also gains a Draft/Published badge per row (reusing the existing `Badge` component, alongside the current "Live" badge — "Live" still distinguishes a real course from a mock one; the new badge distinguishes draft from published within real courses).

### 3. SCORM upload route changes

`app/api/admin/scorm-upload/route.ts` currently always creates a new `courses` row. It gains an optional `courseId` field in its request body:

- **`courseId` provided** (attach mode, used by the builder): skip course creation, use the given course's id directly. All existing parsing, validation, GCS upload, and `modules`/`moduleVersions`/`scormModuleVersions` creation logic is unchanged — only the "create or reuse a course row" branch changes.
- **`courseId` omitted** (legacy create mode): behaves exactly as it does today. Not removed from the route itself — only the *page* that called it in create-mode (`/admin/content/upload`) is retired, so no other consumer breaks if one exists.

### 4. Reordering

`PATCH /api/admin/courses/[courseId]/modules/reorder`, body: an ordered array of module ids. Updates each `modules.sortOrder` to its index in the array, in one transaction. The builder's drag-and-drop list calls this after every drop (optimistic UI update, matching the autosave pattern used for course details).

### 5. Learner-facing rendering changes

**`/courses` (list):** `listRealCourses()` filters to `status = "published"` only — drafts never appear here, and there is no more separate "Live Courses" section. Each published course gets a learner-facing progress rollup (new helper, e.g. `getCourseProgressForLearner(courseId, userId)`): call `getLatestLessonStatus` for every module in the course; if every module's latest status is `"completed"`/`"passed"`, the course sorts into "Finished", otherwise "Active" — mirroring the mock data's own `status` semantics (`"completed"` vs `"in-progress"`/`"not-started"`, collapsed here to the two buckets the list page already renders). Published real courses render through the *same* card component the mock courses use, populated from `department`/`thumbnail`/`compliance`/`dueDate` (with the fallbacks from Section 1) — not a visually distinct section.

**`/courses/[id]` (detail):** the existing real-course branch (from the earlier learner-delivery work) is upgraded to the same template mock courses use: module list with per-module completion status (reusing `getLatestLessonStatus` per module — the same checkmark/in-progress iconography already in the mock rendering path), department/compliance/due-date shown identically to a mock course's detail view.

**Access gate:** the learner-facing course-detail and course-list queries only ever select `status = "published"` courses. A learner navigating directly to a draft course's URL gets `notFound()` — the same behavior as any nonexistent course id, not a distinct "this course is a draft" message (avoids leaking the existence of unpublished content). Admins reach draft courses exclusively through the builder route, which has no such filter.

## Testing approach

- New DB query/mutation helpers (`getCourseProgressForLearner`, the reorder logic, course-detail's `status = "published"` filter) get real DB round-trip tests, matching this codebase's established convention for every `lib/db`/`lib/scorm` helper.
- The builder page, its Card sections, and the drag-and-drop list get no automated test, matching this codebase's established precedent that no `.tsx` page or component has automated tests — verified live instead (create a course, add a SCORM module, add a video placeholder, reorder them, publish, confirm it appears correctly on `/courses` and `/courses/[id]`, confirm a draft course 404s for a learner).
- The SCORM upload route's new `courseId`-provided branch gets covered by its existing test file's pattern (`app/api/admin/scorm-upload` — check for an existing test file and extend it, or add one if none exists, following the same real-request-shape testing already used for `app/api/scorm/attempts/route.test.ts` and `app/api/scorm/commit/route.test.ts`).

## Open question surfaced during design, not blocking

None outstanding — all ambiguities raised during brainstorming (video scope, reorder mechanism, builder layout, retiring the old upload page, due-date fallback behavior) were resolved with the user before this document was written.
