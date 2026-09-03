# Video Hosting & Playback (Mux) — Design

**Status:** Approved 2026-09-03, not yet implemented.

## Goal

Replace the video module's current placeholder (admin-entered title + duration estimate, no file, not playable) with a real pipeline: admins upload a video file, Mux hosts and transcodes it, and learners watch it through a signed, anti-skip player with genuine completion tracking — bringing video to the same level of "real" as SCORM modules already are.

## Context

`courses.status`/`module_versions.status` draft/publish, the course builder, and the admin/learner access gate were all built in the course-authoring subsystem (2026-09-02/03, merged and live). That work explicitly deferred real video ("Non-Goals: Real video upload/hosting... Real ingest (Mux/Cloudflare Stream or similar) is its own follow-up project; this spec's schema and UI are built so that project slots in later without restructuring the course builder") and shipped `videoModuleVersions` as a 1:1 extension of `moduleVersions` holding only `durationMinutes` — a placeholder, never validated against real content.

The original architecture research (`docs/superpowers/specs/2026-08-24-ssp-lms-architecture-design.md`) named Mux as the leading candidate ("slightly ahead on analytics" vs. Cloudflare Stream's flat pricing), with the real bake-off deferred until real video volume existed to estimate cost against. Ian has since created a Mux organization on its free tier, with no payment method on file — confirmed directly against Mux's own pricing page during this design's brainstorming: the free tier is **permanent, not a trial**, but capped at **10 stored videos** and 100K free delivery minutes/month, with "Basic" encoding as the free default (Plus/Premium tiers bill per input minute). That cap is a hard design constraint here, not just a cost-awareness note.

SCORM modules already establish two conventions this design mirrors directly rather than reinventing: (1) the draft-course access gate, most recently hardened in the course-authoring final review to cover the *launch* path, not just the course detail page (`lib/scorm/launch-info.ts`'s `getScormLaunchInfo` vs. `getScormLaunchInfoForAdmin` split); (2) the "DB is truth, Storage cleanup is best-effort" pattern in `removeModule` (`lib/db/course-authoring.ts`), which deletes the SCORM package from Supabase Storage *after* the DB transaction commits, logging rather than failing on a cleanup error.

## Non-Goals (explicitly deferred)

- **Webhook-based ready detection.** Decided during brainstorming (logged in Obsidian with reasoning): start with polling — the builder asks Mux "is this asset ready yet?" every few seconds after upload. Zero Mux dashboard setup, no webhook signing secret to manage, matching the "keep it super simple, stay in the free tier" constraint. Revisit a webhook once volume makes polling genuinely annoying, or once this moves off the no-payment-method constraint.
- **Hardened anti-cheat.** The no-skip-ahead restriction is a client-side UX control, not a security boundary — same honesty this codebase already applies to SCORM's self-reported `raw_cmi` state ("not trustworthy the way `quiz_attempt_answers` is — keep as a log, not a source of computed truth," per `Database Design.md`). A learner determined to bypass it via devtools/direct API calls still can; this is not being built to survive that threat model.
- **Paid encoding tiers.** Every asset is created on Mux's free "Basic" encoding tier. No admin-facing control to request Plus/Premium ever exists in this pass.
- **Video-level versioning / re-encoding a replacement file in place.** Uploading a new video for an existing module slot creates a new `module_versions` row (mirroring exactly how re-uploading a SCORM package already works) rather than mutating one in place.
- **Live streaming.** Mux's free tier is on-demand only; this design is on-demand only regardless.
- **Cross-org / multi-tenant Mux usage.** One Mux org, one set of API credentials, matching this app's existing single-Supabase-project posture.

## Design

### 1. Data model

`videoModuleVersions` gains the real Mux fields (all nullable until the asset is ready):

```ts
export const videoModuleVersions = pgTable("video_module_versions", {
  moduleVersionId: uuid("module_version_id")
    .primaryKey()
    .references(() => moduleVersions.id),
  muxUploadId: text("mux_upload_id"),       // Mux Direct Upload id, needed to poll status before the asset exists
  muxAssetId: text("mux_asset_id"),          // set once Mux links the upload to an asset
  muxPlaybackId: text("mux_playback_id"),    // set once the asset is ready; used to mint signed playback JWTs
  status: text("status").notNull().default("waiting"), // 'waiting' | 'preparing' | 'ready' | 'errored'
  durationSeconds: integer("duration_seconds"), // real, from Mux — replaces the old admin-entered `durationMinutes`
});
```

`durationMinutes` is dropped entirely — every existing video-module row from the placeholder era becomes `status: "errored"` in a one-off backfill migration (there is no real file behind any of them to recover; re-upload is the only path forward, which is correct given none of them were ever playable).

New table, sibling to `scormAttemptState`, same shape philosophy (mutable, upserted on every commit, one row per attempt):

```ts
export const videoAttemptState = pgTable("video_attempt_state", {
  moduleAttemptId: uuid("module_attempt_id")
    .primaryKey()
    .references(() => moduleAttempts.id),
  furthestWatchedSeconds: integer("furthest_watched_seconds").notNull().default(0),
  lastPositionSeconds: integer("last_position_seconds").notNull().default(0),
  status: text("status").notNull().default("in_progress"), // 'in_progress' | 'completed'
  lastCommitAt: timestamp("last_commit_at", { withTimezone: true }),
});
```

`moduleAttempts` (already polymorphic across module types — nothing about it is SCORM-specific) is reused as-is; a video attempt is created the same way a SCORM attempt is, on first launch.

### 2. Upload mechanics

New admin route, replacing the current "Add Video Placeholder" handler:

```
POST /api/admin/courses/[courseId]/modules/video
```

1. Validates `courseId` (`isUuid`), checks the free-tier cap (`GET /video/assets` count via Mux's API, or a cached count — reject with a clear error at 10, before creating anything).
2. Creates the `modules`/`moduleVersions`/`videoModuleVersions` rows in one `db.transaction` (matching `addVideoPlaceholderModule`'s existing pattern exactly), `videoModuleVersions.status = "waiting"`.
3. Calls Mux's Direct Upload API (`encoding_tier: "baseline"`, hard-coded — never a parameter from the client) to get a short-lived upload URL, stores `muxUploadId` on the row, returns the upload URL to the browser.
4. Browser `PUT`s the file **directly to Mux** — never proxied through this app's own Cloud Run instance, avoiding request-size/timeout limits entirely.

Status polling, from the builder, every few seconds after the PUT completes:

```
GET /api/admin/courses/[courseId]/modules/[moduleId]/video-status
```

Looks up the upload by `muxUploadId` via Mux's API; once Mux reports an `asset_id`, fetches the asset; once the asset's status is `ready`, writes `muxAssetId`, `muxPlaybackId`, `durationSeconds`, and flips `status` to `"ready"` in one update. An `errored` asset status writes through the same way. The builder shows a spinner/"Processing…" state while `waiting`/`preparing`, and the real duration once `ready`.

### 3. Playback & the access gate

New `lib/video/launch-info.ts`, structurally identical to `lib/scorm/launch-info.ts`:

```ts
export interface VideoLaunchInfo {
  muxPlaybackId: string;
  durationSeconds: number;
}

export async function getVideoLaunchInfoForAdmin(moduleVersionId: string): Promise<VideoLaunchInfo | null>
export async function getVideoLaunchInfo(moduleVersionId: string): Promise<VideoLaunchInfo | null> // published-course-only, learner-safe default
```

Same join shape as `loadLaunchInfoRow` (`videoModuleVersions` → `moduleVersions` → `modules` → `courses`), same `courseStatus !== "published"` → `null` gate. `getVideoLaunchInfo` additionally returns `null` when `status !== "ready"` — an unfinished upload is not launchable by a learner even on a published course.

Playback is signed, never public. When a learner opens the video player page, the server:

1. Resolves `getVideoLaunchInfo(moduleVersionId)` — 404 if null (draft course, not-ready asset, or bad id), identical framing to the SCORM player's existing `notFound()`.
2. Mints a short-lived signed-playback JWT server-side using the Mux signing key (`MUX_SIGNING_KEY_ID`/`MUX_SIGNING_KEY_PRIVATE_KEY`), scoped to that one `muxPlaybackId`.
3. Renders `@mux/mux-player-react`, passing the signed token — the raw playback ID is never exposed to a path a learner could reuse outside the signed context.

Admin-only surfaces (a future "preview before publish," if one gets built later) would use `getVideoLaunchInfoForAdmin` the same way `/admin/scorm-test` uses its SCORM equivalent — not built in this pass since no such preview UI exists yet, but the function exists so it slots in without restructuring, matching this spec's own stated goal.

### 4. No-skip-ahead player & completion

Client component wrapping `<MuxPlayer>`:

- Tracks `furthestWatchedSeconds` in local state, initialized from the server-provided `videoAttemptState.furthestWatchedSeconds` (resume support, for free from the same state).
- On the player's `seeking` event: if `currentTime > furthestWatchedSeconds + TOLERANCE_SECONDS` (a few seconds, to not fight normal buffering jitter), immediately set `currentTime` back to `furthestWatchedSeconds`. Seeking to anything ≤ that value (rewinding) is never interfered with.
- On `timeupdate`, if `currentTime > furthestWatchedSeconds`, update the local tracked value.
- Every ~10-15 seconds, and on `pause`/`beforeunload`, POST the current `furthestWatchedSeconds`/`lastPositionSeconds` to a commit endpoint (`POST /api/video/commit`, mirroring the shape of the existing SCORM commit route), upserting `videoAttemptState`.
- On the player's native `ended` event (fires only when playback genuinely reaches the end — never from a programmatic skip, since skipping is blocked before it could happen): POST a final commit with `status: "completed"`. The server double-checks `furthestWatchedSeconds >= durationSeconds - TOLERANCE_SECONDS` before honoring the completed flag — defense in depth, not the primary mechanism.

### 5. Course-progress and learner-page integration

`lib/scorm/course-progress.ts`'s `TRACKED_MODULE_TYPES` (currently `["scorm"]`, video excluded because it had no real completion) gains `"video"` back — a course containing only video modules can now genuinely reach `"completed"`. (This file may be worth renaming off the `scorm/` directory once it tracks both types for real, but that's a mechanical rename, not part of this design's scope.)

`app/(app)/courses/[id]/page.tsx`'s video row — currently a disabled "Coming soon" button, added in the course-authoring final-review fix wave specifically because video had no real player yet — becomes a real link:

```tsx
<Link href={`/courses/${realCourse.id}/video/${module.moduleVersionId}`}>
  <Button variant={module.done ? "outline" : "default"} size="sm">
    {module.done ? "Review" : "Start"}
  </Button>
</Link>
```

New route `app/(app)/courses/[id]/video/[moduleVersionId]/page.tsx`, structurally parallel to the existing `app/(app)/courses/[id]/scorm/[moduleId]/page.tsx` (same `FINISHED_STATUSES`-style already-completed check before rendering the player, same access-gate call pattern).

### 6. Cleanup & the free-tier cap

`removeModule` (`lib/db/course-authoring.ts`) gains a third branch alongside its existing SCORM-Storage-cleanup one: collect `muxAssetId` values for any deleted video module versions inside the transaction, then call Mux's Delete Asset API for each **after** the transaction commits — same try/catch-and-log-don't-fail pattern already used for `deleteScormPackage`. Without this, a removed video module keeps permanently consuming one of the 10 free-tier slots.

The upload route's free-tier guard (Section 2, step 1) is the only place a *new* asset can be blocked; nothing about playback or completion tracking is affected by being at/near the cap.

## Open items for the implementation plan to resolve

- Exact Mux Node SDK usage (`@mux/mux-node` — confirm current major version and its Direct Upload / signed-playback-token API shape at implementation time, not guessed here).
- Whether the free-tier asset count check calls Mux's List Assets API live on every upload attempt, or maintains a cached/DB-tracked counter (simpler, avoids an extra external call on the hot path, but can drift if an asset is deleted directly in the Mux dashboard rather than through this app — acceptable risk at this scale).
- `TOLERANCE_SECONDS`'s exact value (proposed: 3 seconds, tunable during implementation against real player buffering behavior).
- Whether the video commit route needs the same `isUuid` guard convention applied to `moduleAttemptId`/`moduleVersionId` inputs — yes, per this codebase's established convention; called out here so the plan doesn't drop it.
