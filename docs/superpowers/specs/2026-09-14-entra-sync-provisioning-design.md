# User Pre-Provisioning & Entra Sync Design (2026-09-14)

**Status:** Approved 2026-09-14, implemented same day.

## Goal

Let an Org Admin search for and assign courses to any employee who already has access to the LMS in Entra, even before that person has ever signed in. When they do sign in for the first time, the LMS recognizes them as the same person — picking up their pre-assigned courses and department, not creating a second, disconnected record — and tracking (attempts, completion) starts from there exactly like it does today.

## Context

Sign-in previously created the only record of a user's existence: `auth.ts`'s `jwt` callback calls `upsertUser()` (`lib/db/users.ts`), which inserted-or-updated a `users` row keyed on the Entra `oid` claim. Nothing existed in the local DB for anyone who hadn't logged in yet.

The Department Management spec (2026-09-08) explicitly deferred this exact problem as a Non-Goal ("Manual user pre-provisioning... No 'invite by email before they've logged in' flow"). This spec is that follow-up — via a real Entra sync rather than manual entry, since the Enterprise App's assignment list already has everyone who should have access.

There was no "assign a course to a user" concept anywhere in the schema before this. `module_attempts` rows are created lazily, only when a learner actually launches a module — never proactively.

## Decisions

- **Sync approach:** real Entra sync via Microsoft Graph, pulling everyone assigned to the Enterprise App's service principal — not manual-only admin entry.
- **Claim on first sign-in:** match an existing, unclaimed `users` row by email and fill in its `entraObjectId`, rather than always inserting a fresh row. `users.entraObjectId` became nullable (was `NOT NULL UNIQUE`).

## Non-Goals (this pass)

- Automatic/scheduled sync — admin-triggered "Sync from Entra" button only, not a cron job.
- Real-time push sync (no Graph change-notification webhook).
- Deactivation reconciliation — losing Entra access doesn't auto-remove/deactivate a `users` row.
- Due dates / reminder notifications on assignments.
- Per-department admin scoping (reuses the existing Admin gate, same deferral as Department Management).
- Learner-facing "My Assigned Courses" view.

## Design

### 1. Entra-side setup (outside this repo)

- New application permission on the "SSP LMS" app registration: `Application.Read.All`, admin-consented.
- New client secret on the same registration (server-to-server, separate from the delegated sign-in flow).
- The Enterprise App's service principal Object ID.
- New env vars: `ENTRA_GRAPH_CLIENT_SECRET`, `ENTRA_SERVICE_PRINCIPAL_ID`. Reuses `AUTH_MICROSOFT_ENTRA_ID_ID` (tenant ID also extracted from the existing `AUTH_MICROSOFT_ENTRA_ID_ISSUER`, no duplicate tenant env var).

### 2. Data model

`users.entraObjectId` dropped `NOT NULL` (migration `0008_entra_sync_provisioning.sql`). New `course_assignments` table: `id`, `courseId` (FK), `userId` (FK), `assignedAt`, `assignedBy` (plain string, not a FK — an assignment record outlives the assigner's own row being renamed/removed), unique on `(courseId, userId)`.

### 3. Graph sync client (`lib/entra/graph-client.ts`)

Client-credentials OAuth (token cached in memory, 60s expiry headroom) against `/oauth2/v2.0/token`, then paginated `GET /servicePrincipals/{id}/appRoleAssignedTo` filtered to `principalType === "User"`.

**Real gotcha:** `appRoleAssignedTo` doesn't include email. A second Graph call per person (`GET /users/{id}?$select=mail,userPrincipalName,displayName`) resolves it, falling back to `userPrincipalName` when `mail` is null. A principal that fails to resolve (deleted account, etc.) is logged and skipped rather than failing the whole sync. At current org size this per-user loop is fine; Graph's `$batch` endpoint is a follow-up only if assignment counts make it slow.

### 4. Sign-in claim logic (`lib/db/users.ts` `upsertUser`)

Three lookup paths, in order:
1. Existing row matched by `entraObjectId` — today's repeat sign-in, update email/displayName.
2. No `entraObjectId` match, but a row matched by `email` **where `entraObjectId IS NULL`** — claim it: set `entraObjectId`, refresh `displayName`, leave `id`/`departmentId`/`course_assignments` untouched. A plain `onConflictDoUpdate` on `entraObjectId` can't do this — Postgres never treats two NULLs as conflicting, so a fresh insert would collide on the `email` unique constraint instead of updating the intended row.
3. No match at all — insert fresh, as before.

The Entra sync path also calls `upsertUser` directly (it always supplies a real `entraObjectId` from Graph, so the same three-path logic does the right thing without a separate sync-specific upsert).

`departmentId` is never touched by any path — admin-owned state, not something a login/sync should reset.

### 5. Admin UI

`/admin/org` gained a Users section (`app/(app)/admin/org/users-section.tsx`): a "Sync from Entra" button (`POST /api/admin/entra-sync`), a searchable roster of every user including never-signed-in ones (status badge: Active / Not yet signed in), and per-user course assignment via a dialog (`GET`/`POST /api/admin/users/[userId]/assignments`, `DELETE /api/admin/users/[userId]/assignments/[courseId]`). All routes covered by the existing path-based `/api/admin/*` gate — no new gate logic needed.

## Testing

- `lib/db/users.test.ts` — added the claim-by-email path (existing tests already covered repeat-sign-in and fresh-insert)
- `lib/db/course-assignments.test.ts` — status reporting, assign/list/unassign, duplicate-assignment rejection (a real bug found and fixed here: Drizzle wraps the underlying pg error in `DrizzleQueryError`, so the `23505` unique-violation code lives on `error.cause.code`, not directly on the caught error)
- `lib/entra/graph-client.test.ts` — missing-env-var error, User-vs-non-User principal filtering, email-resolution fallback (mocked `fetch`, no real network calls)

137/137 tests passing, clean build.

## Open Follow-Ups

- [ ] Scheduled/automatic sync (Cloud Scheduler or Vercel Cron)
- [ ] Deactivation reconciliation when someone loses their Entra assignment
- [ ] Learner-facing "My Assigned Courses" section
- [ ] Due dates + reminder notifications on assignments
- [ ] Assign-from-the-course-side UI (bulk-assign a course to many users/a whole department)
- [ ] Graph `$batch` if the per-user email-resolution loop becomes slow at higher assignment counts
- [ ] End-to-end verification against real Entra data — blocked on the Azure Portal setup (§1) being completed
