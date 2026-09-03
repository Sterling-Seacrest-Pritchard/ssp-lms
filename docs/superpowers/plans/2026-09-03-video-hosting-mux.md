# Video Hosting & Playback (Mux) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the video module's placeholder (title + admin-guessed duration, no file, not playable) with a real pipeline: admin uploads a video, Mux hosts/transcodes it, learner watches through a signed, anti-skip player with genuine completion tracking.

**Architecture:** Mux Direct Upload (browser PUTs straight to Mux, never proxied through this app), polling-based ready-detection (no webhook), signed playback JWTs mirroring the SCORM draft-course gate pattern, a `video_attempt_state` table sibling to `scorm_attempt_state`, and a client-side no-skip-ahead player control (rewind always allowed).

**Tech Stack:** `@mux/mux-node` (server-side API client + JWT signing), `@mux/mux-player-react` (learner-facing player), existing Next.js 16 / Drizzle / Supabase Postgres stack, no new infra.

**Spec:** `docs/superpowers/specs/2026-09-03-video-hosting-mux-design.md`

## Global Constraints

- **Free-tier hard cap: 10 stored Mux videos.** Every new-asset creation must be blocked with a clear error before the 11th asset would be created. Every asset is created with the free "Basic" encoding tier — no code path may ever request a paid tier.
- **No skip-ahead, rewind always allowed.** Client-side player control, not hardened anti-cheat — mirrors this codebase's existing honesty about SCORM's self-reported state.
- **Completion = watched to the end** (the player's native `ended` event at full duration), never a percentage threshold or "opened it."
- **Playback is signed, never public.** Every learner-facing video URL/token must be minted server-side per request, gated on the parent course's `status === "published"`, exactly mirroring `lib/scorm/launch-info.ts`'s `getScormLaunchInfo`/`getScormLaunchInfoForAdmin` split.
- **`isUuid()` (from `lib/api/errors.ts`) guards every raw string that reaches a Postgres `uuid` column** — this codebase's established, repeatedly-enforced convention.
- **New session-trusting routes must read the user id from the authenticated session (`auth()`), never from the request body.** `app/api/scorm/attempts/route.ts` trusts a client-supplied `userId` — a known, already-ledgered impersonation hole in existing code. Do not replicate that pattern in any new route this plan adds.
- **Every multi-statement DB write goes in `db.transaction`**, matching this codebase's established convention (see `lib/db/course-authoring.ts`).
- **No webhook.** Ready-detection is polling only, per the spec's explicit decision.
- Local dev only (`npm run dev`, port 3001). The deployed Cloud Run service must not be touched by any step in this plan.

---

### Task 1: Dependencies, schema, Mux client

**Files:**
- Modify: `package.json`
- Modify: `lib/db/schema.ts`
- Create: `lib/video/mux-client.ts`
- Create: `drizzle/migrations/*.sql` (generated, see steps)
- Test: none (schema/config only, matches this codebase's existing convention of no test on migration files themselves)

**Interfaces:**
- Produces: `videoModuleVersions` (extended), `videoAttemptState` (new) Drizzle table exports from `lib/db/schema.ts`; `getMuxClient()` from `lib/video/mux-client.ts`.

- [ ] **Step 1: Install dependencies**

Run: `npm install @mux/mux-node @mux/mux-player-react`

Do not pin exact versions manually — let npm resolve latest, then verify the API shapes used in later tasks actually compile via `npx tsc --noEmit` at the end of each task. This SDK's exact method signatures were confirmed against its public docs during design (`client.video.uploads.create/retrieve`, `client.video.assets.retrieve/delete`, `mux.jwt.signPlaybackId`), but exact field names inside `new_asset_settings` can drift between versions — if a field name in this plan's code doesn't compile, check the installed package's own `.d.ts` files (`node_modules/@mux/mux-node/**/*.d.ts`) for the actual current field name before changing anything else.

- [ ] **Step 2: Add env vars documentation (values already in `.env.local`, not committed)**

`.env.local` already has `MUX_TOKEN_ID`, `MUX_TOKEN_SECRET`, `MUX_SIGNING_KEY_ID`, `MUX_SIGNING_KEY_PRIVATE_KEY` set. No action needed here beyond confirming they exist:

Run: `grep -c "^MUX_" .env.local`
Expected: `4`

- [ ] **Step 3: Extend the schema**

In `lib/db/schema.ts`, replace the existing `videoModuleVersions` table definition:

```ts
export const videoModuleVersions = pgTable("video_module_versions", {
  moduleVersionId: uuid("module_version_id")
    .primaryKey()
    .references(() => moduleVersions.id),
  muxUploadId: text("mux_upload_id"),
  muxAssetId: text("mux_asset_id"),
  muxPlaybackId: text("mux_playback_id"),
  status: text("status").notNull().default("waiting"),
  durationSeconds: integer("duration_seconds"),
});
```

Add a new table right after it:

```ts
export const videoAttemptState = pgTable("video_attempt_state", {
  moduleAttemptId: uuid("module_attempt_id")
    .primaryKey()
    .references(() => moduleAttempts.id),
  furthestWatchedSeconds: integer("furthest_watched_seconds").notNull().default(0),
  lastPositionSeconds: integer("last_position_seconds").notNull().default(0),
  status: text("status").notNull().default("in_progress"),
  lastCommitAt: timestamp("last_commit_at", { withTimezone: true }),
});
```

- [ ] **Step 4: Generate the migration**

Run: `npm run db:generate`
Expected: a new file under `drizzle/migrations/`, plus updated `meta/_journal.json` and a new `meta/NNNN_snapshot.json`. Read the generated `.sql` file and confirm it contains: `ALTER TABLE "video_module_versions" DROP COLUMN "duration_minutes"`, `ADD COLUMN "mux_upload_id" text`, `ADD COLUMN "mux_asset_id" text`, `ADD COLUMN "mux_playback_id" text`, `ADD COLUMN "status" text DEFAULT 'waiting' NOT NULL`, `ADD COLUMN "duration_seconds" integer`, and a full `CREATE TABLE "video_attempt_state"` statement with the columns above plus its FK to `module_attempts`.

- [ ] **Step 5: Append the backfill statement**

Every pre-existing row in `video_module_versions` is from the placeholder era (no `mux_asset_id`, since that column didn't exist until this migration). Open the migration file generated in Step 4 and append this line at the end, after a `--> statement-breakpoint` separator matching the file's existing style:

```sql
UPDATE "video_module_versions" SET "status" = 'errored' WHERE "mux_asset_id" IS NULL;
```

This runs after the `ADD COLUMN "status" ... DEFAULT 'waiting'` in the same statement batch, so it correctly overrides the default only for rows that predate real Mux integration — a video module created after this migration always starts genuinely `'waiting'`, never touched by this one-time `UPDATE`.

- [ ] **Step 6: Apply the migration**

Run: `npm run db:migrate`
Expected: no errors, migration applied.

- [ ] **Step 7: Mux client singleton**

Create `lib/video/mux-client.ts`:

```ts
import Mux from "@mux/mux-node";

let client: Mux | null = null;

/**
 * Lazily-constructed singleton, matching this codebase's existing
 * `pg.Pool`-at-module-scope pattern (see lib/db/client.ts) - avoids
 * re-reading env vars and re-constructing the SDK client on every call.
 */
export function getMuxClient(): Mux {
  if (!client) {
    client = new Mux({
      tokenId: process.env.MUX_TOKEN_ID,
      tokenSecret: process.env.MUX_TOKEN_SECRET,
    });
  }
  return client;
}

/**
 * Free-tier hard cap (Global Constraints). Confirmed against Mux's own
 * pricing page during design: the free tier is capped at 10 stored videos,
 * not a rolling/monthly count - this must be checked before every new
 * asset creation, not just at signup.
 */
export const FREE_TIER_ASSET_LIMIT = 10;

export async function countMuxAssets(): Promise<number> {
  const mux = getMuxClient();
  let count = 0;
  let page = mux.video.assets.list({ limit: 100 });
  for await (const _asset of page) {
    count += 1;
  }
  return count;
}
```

- [ ] **Step 8: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. If `mux.video.assets.list` doesn't compile or doesn't support async iteration, check the installed SDK's types for the actual list-and-paginate shape (per Step 1's guidance) and adjust `countMuxAssets` accordingly - the counting logic (iterate all pages, count total) is the requirement; the exact iteration syntax must match what's actually installed.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json lib/db/schema.ts lib/video/mux-client.ts drizzle/migrations
git commit -m "feat: add Mux client, video schema fields, and video_attempt_state table"
```

---

### Task 2: Upload creation & status polling

**Files:**
- Create: `app/api/admin/courses/[courseId]/modules/video/route.ts` (replaces the old placeholder-only handler)
- Create: `app/api/admin/courses/[courseId]/modules/[moduleId]/video-status/route.ts`
- Modify: `lib/db/course-authoring.ts` (remove `addVideoPlaceholderModule`, no longer used)
- Test: `app/api/admin/courses/[courseId]/modules/video/route.test.ts`
- Test: `app/api/admin/courses/[courseId]/modules/[moduleId]/video-status/route.test.ts`

**Interfaces:**
- Consumes: `getMuxClient()`, `FREE_TIER_ASSET_LIMIT`, `countMuxAssets()` from Task 1; `isUuid` from `lib/api/errors.ts`; `db`, `courses`, `modules`, `moduleVersions`, `videoModuleVersions` from `lib/db/schema.ts`/`lib/db/client.ts`.
- Produces: `POST /api/admin/courses/[courseId]/modules/video` returns `{ moduleId, moduleVersionId, uploadUrl }`; `GET .../[moduleId]/video-status` returns `{ status, durationSeconds }`.

- [ ] **Step 1: Write the failing tests**

`app/api/admin/courses/[courseId]/modules/video/route.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { POST } from "./route";
import { db } from "@/lib/db/client";
import { courses, modules, moduleVersions, videoModuleVersions } from "@/lib/db/schema";

describe("POST /api/admin/courses/[courseId]/modules/video", () => {
  let createdCourseId: string | undefined;

  afterEach(async () => {
    if (!createdCourseId) return;
    const courseModules = await db.select().from(modules).where(eq(modules.courseId, createdCourseId));
    for (const m of courseModules) {
      await db.update(modules).set({ currentVersionId: null }).where(eq(modules.id, m.id));
      const versions = await db.select().from(moduleVersions).where(eq(moduleVersions.moduleId, m.id));
      for (const v of versions) {
        await db.delete(videoModuleVersions).where(eq(videoModuleVersions.moduleVersionId, v.id));
      }
      await db.delete(moduleVersions).where(eq(moduleVersions.moduleId, m.id));
    }
    await db.delete(modules).where(eq(modules.courseId, createdCourseId));
    await db.delete(courses).where(eq(courses.id, createdCourseId));
    createdCourseId = undefined;
  });

  it("creates a waiting video module and returns a Mux upload URL", async () => {
    const [course] = await db.insert(courses).values({ code: `VIDTEST-${Date.now()}`, title: "Video Test" }).returning();
    createdCourseId = course.id;

    const request = new NextRequest(`http://localhost/api/admin/courses/${course.id}/modules/video`, {
      method: "POST",
      body: JSON.stringify({ title: "Intro Video" }),
    });
    const response = await POST(request, { params: Promise.resolve({ courseId: course.id }) });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.uploadUrl).toMatch(/^https:\/\//);
    expect(body.moduleVersionId).toBeTruthy();

    const [row] = await db
      .select()
      .from(videoModuleVersions)
      .where(eq(videoModuleVersions.moduleVersionId, body.moduleVersionId));
    expect(row.status).toBe("waiting");
    expect(row.muxUploadId).toBeTruthy();
  });

  it("rejects a non-UUID courseId", async () => {
    const request = new NextRequest("http://localhost/api/admin/courses/not-a-uuid/modules/video", {
      method: "POST",
      body: JSON.stringify({ title: "x" }),
    });
    const response = await POST(request, { params: Promise.resolve({ courseId: "not-a-uuid" }) });
    expect(response.status).toBe(400);
  });

  it("rejects a request with no title", async () => {
    const [course] = await db.insert(courses).values({ code: `VIDTEST-${Date.now()}`, title: "Video Test" }).returning();
    createdCourseId = course.id;
    const request = new NextRequest(`http://localhost/api/admin/courses/${course.id}/modules/video`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    const response = await POST(request, { params: Promise.resolve({ courseId: course.id }) });
    expect(response.status).toBe(400);
  });
});
```

`app/api/admin/courses/[courseId]/modules/[moduleId]/video-status/route.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { GET } from "./route";
import { db } from "@/lib/db/client";
import { courses, modules, moduleVersions, videoModuleVersions } from "@/lib/db/schema";

describe("GET .../[moduleId]/video-status", () => {
  let createdCourseId: string | undefined;
  let moduleId: string | undefined;

  afterEach(async () => {
    if (!createdCourseId) return;
    if (moduleId) {
      await db.update(modules).set({ currentVersionId: null }).where(eq(modules.id, moduleId));
      const versions = await db.select().from(moduleVersions).where(eq(moduleVersions.moduleId, moduleId));
      for (const v of versions) {
        await db.delete(videoModuleVersions).where(eq(videoModuleVersions.moduleVersionId, v.id));
      }
      await db.delete(moduleVersions).where(eq(moduleVersions.moduleId, moduleId));
      await db.delete(modules).where(eq(modules.id, moduleId));
    }
    await db.delete(courses).where(eq(courses.id, createdCourseId));
    createdCourseId = undefined;
    moduleId = undefined;
  });

  it("returns the current status for a still-waiting upload", async () => {
    const [course] = await db.insert(courses).values({ code: `VIDSTATUS-${Date.now()}`, title: "x" }).returning();
    createdCourseId = course.id;
    const [mod] = await db.insert(modules).values({ courseId: course.id, moduleType: "video", title: "x" }).returning();
    moduleId = mod.id;
    const [version] = await db
      .insert(moduleVersions)
      .values({ moduleId: mod.id, versionNumber: 1, status: "published", publishedAt: new Date() })
      .returning();
    await db.update(modules).set({ currentVersionId: version.id }).where(eq(modules.id, mod.id));
    await db.insert(videoModuleVersions).values({
      moduleVersionId: version.id,
      muxUploadId: "does-not-exist-in-mux",
      status: "waiting",
    });

    const request = new NextRequest(`http://localhost/api/admin/courses/${course.id}/modules/${mod.id}/video-status`);
    const response = await GET(request, { params: Promise.resolve({ courseId: course.id, moduleId: mod.id }) });
    // A fake muxUploadId means the Mux API call itself will fail or return
    // not-found - the route must not 500 on that, it must report the DB's
    // current status rather than crash.
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("waiting");
  });

  it("rejects a non-UUID moduleId", async () => {
    const request = new NextRequest("http://localhost/api/admin/courses/00000000-0000-0000-0000-000000000000/modules/not-a-uuid/video-status");
    const response = await GET(request, {
      params: Promise.resolve({ courseId: "00000000-0000-0000-0000-000000000000", moduleId: "not-a-uuid" }),
    });
    expect(response.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run app/api/admin/courses/[courseId]/modules/video/route.test.ts app/api/admin/courses/[courseId]/modules/[moduleId]/video-status/route.test.ts`
Expected: FAIL (routes don't exist yet)

- [ ] **Step 3: Implement the upload-creation route**

Create `app/api/admin/courses/[courseId]/modules/video/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { modules, moduleVersions, videoModuleVersions } from "@/lib/db/schema";
import { badRequest, isUuid, serverError } from "@/lib/api/errors";
import { getMuxClient, countMuxAssets, FREE_TIER_ASSET_LIMIT } from "@/lib/video/mux-client";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ courseId: string }> }
) {
  try {
    const { courseId } = await params;
    if (!isUuid(courseId)) {
      return badRequest("courseId must be a UUID");
    }

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

    const existingCount = await countMuxAssets();
    if (existingCount >= FREE_TIER_ASSET_LIMIT) {
      return NextResponse.json(
        {
          error: `Free-tier limit reached (${FREE_TIER_ASSET_LIMIT} stored videos). Remove an existing video before adding another.`,
        },
        { status: 409 }
      );
    }

    const { moduleId, versionId } = await db.transaction(async (tx) => {
      const [courseModule] = await tx
        .insert(modules)
        .values({ courseId, moduleType: "video", title })
        .returning();
      const [version] = await tx
        .insert(moduleVersions)
        .values({ moduleId: courseModule.id, versionNumber: 1, status: "published", publishedAt: new Date() })
        .returning();
      await tx.insert(videoModuleVersions).values({ moduleVersionId: version.id, status: "waiting" });
      await tx.update(modules).set({ currentVersionId: version.id }).where(eq(modules.id, courseModule.id));
      return { moduleId: courseModule.id, versionId: version.id };
    });

    const mux = getMuxClient();
    const upload = await mux.video.uploads.create({
      cors_origin: "*",
      new_asset_settings: {
        playback_policy: ["signed"],
        video_quality: "basic",
      },
    });

    await db
      .update(videoModuleVersions)
      .set({ muxUploadId: upload.id })
      .where(eq(videoModuleVersions.moduleVersionId, versionId));

    return NextResponse.json({ moduleId, moduleVersionId: versionId, uploadUrl: upload.url });
  } catch (error) {
    return serverError(error);
  }
}
```

Note: `cors_origin: "*"` is deliberately permissive here since this is an admin-only, internal-tool upload flow (the route itself is gated by `lib/auth/admin-gate.ts` via `proxy.ts` - see Global Constraints). If the installed SDK's `playback_policy`/`video_quality` field names don't compile, check the installed types per Task 1 Step 1's guidance before changing the shape.

- [ ] **Step 4: Implement the status-poll route**

Create `app/api/admin/courses/[courseId]/modules/[moduleId]/video-status/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { modules, moduleVersions, videoModuleVersions } from "@/lib/db/schema";
import { badRequest, notFound, serverError, isUuid } from "@/lib/api/errors";
import { getMuxClient } from "@/lib/video/mux-client";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ courseId: string; moduleId: string }> }
) {
  try {
    const { courseId, moduleId } = await params;
    if (!isUuid(courseId) || !isUuid(moduleId)) {
      return badRequest("courseId and moduleId must be UUIDs");
    }

    const [courseModule] = await db
      .select()
      .from(modules)
      .where(and(eq(modules.id, moduleId), eq(modules.courseId, courseId)));
    if (!courseModule || !courseModule.currentVersionId) {
      return notFound("Module not found");
    }

    const [videoRow] = await db
      .select()
      .from(videoModuleVersions)
      .where(eq(videoModuleVersions.moduleVersionId, courseModule.currentVersionId));
    if (!videoRow) {
      return notFound("Video module version not found");
    }

    // Already resolved - no need to call Mux again.
    if (videoRow.status === "ready" || videoRow.status === "errored") {
      return NextResponse.json({ status: videoRow.status, durationSeconds: videoRow.durationSeconds });
    }

    if (!videoRow.muxUploadId) {
      return NextResponse.json({ status: videoRow.status, durationSeconds: null });
    }

    const mux = getMuxClient();
    let assetId: string | null | undefined;
    try {
      const upload = await mux.video.uploads.retrieve(videoRow.muxUploadId);
      assetId = upload.asset_id;
    } catch {
      // A not-yet-processed or unknown upload id from Mux's side is not this
      // route's failure to surface as a 500 - report the DB's current
      // status and let the next poll try again.
      return NextResponse.json({ status: videoRow.status, durationSeconds: null });
    }

    if (!assetId) {
      return NextResponse.json({ status: "waiting", durationSeconds: null });
    }

    const asset = await mux.video.assets.retrieve(assetId);
    if (asset.status === "ready") {
      const playbackId = asset.playback_ids?.[0]?.id ?? null;
      const durationSeconds = asset.duration ? Math.round(asset.duration) : null;
      await db
        .update(videoModuleVersions)
        .set({
          muxAssetId: assetId,
          muxPlaybackId: playbackId,
          durationSeconds,
          status: "ready",
        })
        .where(eq(videoModuleVersions.moduleVersionId, courseModule.currentVersionId));
      return NextResponse.json({ status: "ready", durationSeconds });
    }

    if (asset.status === "errored") {
      await db
        .update(videoModuleVersions)
        .set({ muxAssetId: assetId, status: "errored" })
        .where(eq(videoModuleVersions.moduleVersionId, courseModule.currentVersionId));
      return NextResponse.json({ status: "errored", durationSeconds: null });
    }

    await db
      .update(videoModuleVersions)
      .set({ muxAssetId: assetId, status: "preparing" })
      .where(eq(videoModuleVersions.moduleVersionId, courseModule.currentVersionId));
    return NextResponse.json({ status: "preparing", durationSeconds: null });
  } catch (error) {
    return serverError(error);
  }
}
```

- [ ] **Step 5: Remove the now-unused placeholder function**

In `lib/db/course-authoring.ts`, delete the `addVideoPlaceholderModule` function entirely (superseded by the route above) and remove `videoModuleVersions` from its imports if nothing else in the file uses it (check `removeModule` - it still needs `videoModuleVersions` for its own cleanup, so keep the import if so).

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run app/api/admin/courses/[courseId]/modules/video/route.test.ts app/api/admin/courses/[courseId]/modules/[moduleId]/video-status/route.test.ts`
Expected: PASS

- [ ] **Step 7: Run the full suite and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all pass, no errors (course-authoring's existing tests referencing `addVideoPlaceholderModule`, if any, need updating - grep for the removed function name and fix any remaining references before this step passes clean).

- [ ] **Step 8: Commit**

```bash
git add app/api/admin/courses lib/db/course-authoring.ts
git commit -m "feat: add Mux upload-creation and status-polling routes for video modules"
```

---

### Task 3: Launch info & removeModule cleanup

**Files:**
- Create: `lib/video/launch-info.ts`
- Modify: `lib/db/course-authoring.ts` (`removeModule`)
- Test: `lib/video/launch-info.test.ts`
- Test (extend): `lib/db/course-authoring.test.ts`

**Interfaces:**
- Consumes: `getMuxClient()` from Task 1.
- Produces: `getVideoLaunchInfo(moduleVersionId)`, `getVideoLaunchInfoForAdmin(moduleVersionId)` returning `{ muxPlaybackId: string; durationSeconds: number } | null`.

- [ ] **Step 1: Write the failing test for launch-info**

Create `lib/video/launch-info.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { courses, modules, moduleVersions, videoModuleVersions } from "@/lib/db/schema";
import { getVideoLaunchInfo, getVideoLaunchInfoForAdmin } from "./launch-info";

describe("video launch-info", () => {
  let courseId: string | undefined;
  let moduleId: string | undefined;
  let versionId: string | undefined;

  afterEach(async () => {
    if (versionId) await db.delete(videoModuleVersions).where(eq(videoModuleVersions.moduleVersionId, versionId));
    if (moduleId) {
      await db.update(modules).set({ currentVersionId: null }).where(eq(modules.id, moduleId));
      if (versionId) await db.delete(moduleVersions).where(eq(moduleVersions.id, versionId));
      await db.delete(modules).where(eq(modules.id, moduleId));
    }
    if (courseId) await db.delete(courses).where(eq(courses.id, courseId));
    courseId = moduleId = versionId = undefined;
  });

  async function seed(courseStatus: string, videoStatus: string) {
    const [course] = await db.insert(courses).values({ code: `LAUNCH-${Date.now()}`, title: "x", status: courseStatus }).returning();
    courseId = course.id;
    const [mod] = await db.insert(modules).values({ courseId: course.id, moduleType: "video", title: "x" }).returning();
    moduleId = mod.id;
    const [version] = await db.insert(moduleVersions).values({ moduleId: mod.id, versionNumber: 1, status: "published", publishedAt: new Date() }).returning();
    versionId = version.id;
    await db.update(modules).set({ currentVersionId: version.id }).where(eq(modules.id, mod.id));
    await db.insert(videoModuleVersions).values({
      moduleVersionId: version.id,
      muxPlaybackId: "test-playback-id",
      durationSeconds: 120,
      status: videoStatus,
    });
    return version.id;
  }

  it("returns launch info for a ready video on a published course", async () => {
    const id = await seed("published", "ready");
    const info = await getVideoLaunchInfo(id);
    expect(info).toEqual({ muxPlaybackId: "test-playback-id", durationSeconds: 120 });
  });

  it("returns null for a draft course even if the video is ready", async () => {
    const id = await seed("draft", "ready");
    const info = await getVideoLaunchInfo(id);
    expect(info).toBeNull();
  });

  it("returns null for a not-ready video even on a published course", async () => {
    const id = await seed("published", "preparing");
    const info = await getVideoLaunchInfo(id);
    expect(info).toBeNull();
  });

  it("getVideoLaunchInfoForAdmin ignores course status", async () => {
    const id = await seed("draft", "ready");
    const info = await getVideoLaunchInfoForAdmin(id);
    expect(info).toEqual({ muxPlaybackId: "test-playback-id", durationSeconds: 120 });
  });

  it("returns null for a non-UUID id", async () => {
    const info = await getVideoLaunchInfo("not-a-uuid");
    expect(info).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/video/launch-info.test.ts`
Expected: FAIL (module doesn't exist)

- [ ] **Step 3: Implement launch-info.ts**

Create `lib/video/launch-info.ts`:

```ts
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { courses, modules, moduleVersions, videoModuleVersions } from "@/lib/db/schema";
import { isUuid } from "@/lib/api/errors";

export interface VideoLaunchInfo {
  muxPlaybackId: string;
  durationSeconds: number;
}

interface VideoLaunchInfoRow extends VideoLaunchInfo {
  courseStatus: string;
  videoStatus: string;
}

/**
 * Resolve a module version to its Mux playback details, WITHOUT checking the
 * parent course's publish status. Admin-only surfaces use this - never call
 * it from a learner-facing surface, use `getVideoLaunchInfo` there. Mirrors
 * `lib/scorm/launch-info.ts`'s identical split.
 */
export async function getVideoLaunchInfoForAdmin(
  moduleVersionId: string
): Promise<VideoLaunchInfo | null> {
  const row = await loadLaunchInfoRow(moduleVersionId);
  if (!row) return null;
  return { muxPlaybackId: row.muxPlaybackId, durationSeconds: row.durationSeconds };
}

/**
 * Resolve a module version to its Mux playback details, for a learner.
 * Returns null unless the parent course is published AND the asset is
 * ready - an unfinished upload is not launchable even on a published
 * course.
 */
export async function getVideoLaunchInfo(
  moduleVersionId: string
): Promise<VideoLaunchInfo | null> {
  const row = await loadLaunchInfoRow(moduleVersionId);
  if (!row || row.courseStatus !== "published" || row.videoStatus !== "ready") return null;
  return { muxPlaybackId: row.muxPlaybackId, durationSeconds: row.durationSeconds };
}

async function loadLaunchInfoRow(moduleVersionId: string): Promise<VideoLaunchInfoRow | null> {
  if (!isUuid(moduleVersionId)) return null;

  const [row] = await db
    .select({
      muxPlaybackId: videoModuleVersions.muxPlaybackId,
      durationSeconds: videoModuleVersions.durationSeconds,
      videoStatus: videoModuleVersions.status,
      courseStatus: courses.status,
    })
    .from(videoModuleVersions)
    .innerJoin(moduleVersions, eq(moduleVersions.id, videoModuleVersions.moduleVersionId))
    .innerJoin(modules, eq(modules.id, moduleVersions.moduleId))
    .innerJoin(courses, eq(courses.id, modules.courseId))
    .where(eq(videoModuleVersions.moduleVersionId, moduleVersionId));

  if (!row || !row.muxPlaybackId || row.durationSeconds === null) return null;
  return {
    muxPlaybackId: row.muxPlaybackId,
    durationSeconds: row.durationSeconds,
    videoStatus: row.videoStatus,
    courseStatus: row.courseStatus,
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/video/launch-info.test.ts`
Expected: PASS

- [ ] **Step 5: Write the failing test for removeModule's Mux cleanup**

In `lib/db/course-authoring.test.ts`, add (matching the existing SCORM-removal test's structure in that same file):

```ts
it("removes a video module and deletes its Mux asset", async () => {
  const { id: courseId } = await createDraftCourse();
  const { moduleVersionId } = await addVideoModuleForTest(courseId); // see note below
  const [videoRow] = await db.select().from(videoModuleVersions).where(eq(videoModuleVersions.moduleVersionId, moduleVersionId));
  const [mod] = await db.select().from(modules).where(eq(modules.currentVersionId, moduleVersionId));

  const deleteSpy = vi.fn().mockResolvedValue(undefined);
  vi.spyOn(await import("@/lib/video/mux-client"), "getMuxClient").mockReturnValue({
    video: { assets: { delete: deleteSpy } },
  } as unknown as ReturnType<typeof import("@/lib/video/mux-client").getMuxClient>);

  await removeModule(courseId, mod.id);

  expect(deleteSpy).toHaveBeenCalledWith(videoRow.muxAssetId);
  const remaining = await db.select().from(videoModuleVersions).where(eq(videoModuleVersions.moduleVersionId, moduleVersionId));
  expect(remaining).toHaveLength(0);

  await db.delete(courses).where(eq(courses.id, courseId));
});
```

Since there is no existing helper to insert a ready video module directly for a test (Task 2 removed the only function that inserted `videoModuleVersions` rows, and it never set `muxAssetId`), add this small test-only helper at the top of `lib/db/course-authoring.test.ts` rather than in production code:

```ts
async function addVideoModuleForTest(courseId: string): Promise<{ moduleVersionId: string }> {
  const [mod] = await db.insert(modules).values({ courseId, moduleType: "video", title: "Test Video" }).returning();
  const [version] = await db
    .insert(moduleVersions)
    .values({ moduleId: mod.id, versionNumber: 1, status: "published", publishedAt: new Date() })
    .returning();
  await db.insert(videoModuleVersions).values({
    moduleVersionId: version.id,
    muxAssetId: "test-asset-id",
    muxPlaybackId: "test-playback-id",
    status: "ready",
    durationSeconds: 60,
  });
  await db.update(modules).set({ currentVersionId: version.id }).where(eq(modules.id, mod.id));
  return { moduleVersionId: version.id };
}
```

- [ ] **Step 6: Run to verify it fails**

Run: `npx vitest run lib/db/course-authoring.test.ts -t "deletes its Mux asset"`
Expected: FAIL (`removeModule` doesn't call Mux yet)

- [ ] **Step 7: Extend removeModule**

In `lib/db/course-authoring.ts`, add the import and extend `removeModule`:

```ts
import { getMuxClient } from "@/lib/video/mux-client";
```

Inside `removeModule`'s transaction, alongside the existing `scormVersions`/`storagePrefixes` collection, add a parallel collection for video assets:

```ts
const muxAssetIds: string[] = [];
```

(add this declaration next to the existing `const storagePrefixes: string[] = [];`)

Inside the transaction, right after the existing `scormVersions`/`storagePrefixes.push(...)` block, add:

```ts
const videoVersions = await tx
  .select()
  .from(videoModuleVersions)
  .where(inArray(videoModuleVersions.moduleVersionId, versionIds));
muxAssetIds.push(...videoVersions.map((v) => v.muxAssetId).filter((id): id is string => id !== null));
```

After the transaction commits, alongside the existing SCORM Storage-cleanup loop, add a parallel one (same "log and continue, never fail the operation" pattern):

```ts
const mux = getMuxClient();
for (const assetId of muxAssetIds) {
  try {
    await mux.video.assets.delete(assetId);
  } catch (error) {
    console.error(
      `removeModule: failed to delete Mux asset "${assetId}"; it is now orphaned and still counts against the free-tier limit`,
      error
    );
  }
}
```

- [ ] **Step 8: Run to verify it passes**

Run: `npx vitest run lib/db/course-authoring.test.ts`
Expected: PASS (all tests in this file, not just the new one)

- [ ] **Step 9: Run the full suite and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all pass, no errors

- [ ] **Step 10: Commit**

```bash
git add lib/video/launch-info.ts lib/video/launch-info.test.ts lib/db/course-authoring.ts lib/db/course-authoring.test.ts
git commit -m "feat: gate video launch info on publish status, clean up Mux assets on module removal"
```

---

### Task 4: Video attempts & commit

**Files:**
- Create: `app/api/video/attempts/route.ts`
- Create: `app/api/video/commit/route.ts`
- Create: `lib/video/completion-status.ts`
- Test: `app/api/video/attempts/route.test.ts`
- Test: `app/api/video/commit/route.test.ts`
- Test: `lib/video/completion-status.test.ts`

**Interfaces:**
- Produces: `POST /api/video/attempts` → `{ attemptId: string }` (reads `userId` from the session, NOT the body - see Global Constraints); `POST /api/video/commit` → `{ ok: true }`; `getLatestVideoStatus(moduleVersionId, userId)` from `lib/video/completion-status.ts`.

- [ ] **Step 1: Write the failing tests**

Create `lib/video/completion-status.test.ts` (mirrors `lib/scorm/completion-status.test.ts`'s structure exactly):

```ts
import { describe, it, expect, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { moduleAttempts, videoAttemptState, modules, moduleVersions, courses, videoModuleVersions } from "@/lib/db/schema";
import { getLatestVideoStatus } from "./completion-status";

describe("getLatestVideoStatus", () => {
  let attemptId: string | undefined;
  let versionId: string | undefined;
  let moduleId: string | undefined;
  let courseId: string | undefined;

  afterEach(async () => {
    if (attemptId) await db.delete(videoAttemptState).where(eq(videoAttemptState.moduleAttemptId, attemptId));
    if (attemptId) await db.delete(moduleAttempts).where(eq(moduleAttempts.id, attemptId));
    if (versionId) await db.delete(videoModuleVersions).where(eq(videoModuleVersions.moduleVersionId, versionId));
    if (moduleId) {
      await db.update(modules).set({ currentVersionId: null }).where(eq(modules.id, moduleId));
      if (versionId) await db.delete(moduleVersions).where(eq(moduleVersions.id, versionId));
      await db.delete(modules).where(eq(modules.id, moduleId));
    }
    if (courseId) await db.delete(courses).where(eq(courses.id, courseId));
    attemptId = versionId = moduleId = courseId = undefined;
  });

  it("returns the latest status for a completed attempt", async () => {
    const [course] = await db.insert(courses).values({ code: `VIDSTATUS2-${Date.now()}`, title: "x" }).returning();
    courseId = course.id;
    const [mod] = await db.insert(modules).values({ courseId: course.id, moduleType: "video", title: "x" }).returning();
    moduleId = mod.id;
    const [version] = await db.insert(moduleVersions).values({ moduleId: mod.id, versionNumber: 1, status: "published", publishedAt: new Date() }).returning();
    versionId = version.id;
    const [attempt] = await db.insert(moduleAttempts).values({ moduleVersionId: version.id, userId: "test@example.com" }).returning();
    attemptId = attempt.id;
    await db.insert(videoAttemptState).values({ moduleAttemptId: attempt.id, status: "completed", furthestWatchedSeconds: 60, lastPositionSeconds: 60 });

    const status = await getLatestVideoStatus(version.id, "test@example.com");
    expect(status).toBe("completed");
  });

  it("returns null when there is no attempt", async () => {
    const status = await getLatestVideoStatus("00000000-0000-0000-0000-000000000000", "nobody@example.com");
    expect(status).toBeNull();
  });
});
```

Create `app/api/video/attempts/route.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { POST } from "./route";
import { db } from "@/lib/db/client";
import { courses, modules, moduleVersions, moduleAttempts } from "@/lib/db/schema";

vi.mock("@/auth", () => ({
  auth: vi.fn().mockResolvedValue({ user: { email: "real-session-user@example.com" } }),
}));

describe("POST /api/video/attempts", () => {
  let courseId: string | undefined;
  let versionId: string | undefined;

  afterEach(async () => {
    if (versionId) await db.delete(moduleAttempts).where(eq(moduleAttempts.moduleVersionId, versionId));
    if (courseId) {
      const mods = await db.select().from(modules).where(eq(modules.courseId, courseId));
      for (const m of mods) {
        await db.update(modules).set({ currentVersionId: null }).where(eq(modules.id, m.id));
        await db.delete(moduleVersions).where(eq(moduleVersions.moduleId, m.id));
      }
      await db.delete(modules).where(eq(modules.courseId, courseId));
      await db.delete(courses).where(eq(courses.id, courseId));
    }
    courseId = versionId = undefined;
  });

  it("creates an attempt using the SESSION user id, ignoring any userId in the body", async () => {
    const [course] = await db.insert(courses).values({ code: `ATTEMPT-${Date.now()}`, title: "x" }).returning();
    courseId = course.id;
    const [mod] = await db.insert(modules).values({ courseId: course.id, moduleType: "video", title: "x" }).returning();
    const [version] = await db.insert(moduleVersions).values({ moduleId: mod.id, versionNumber: 1, status: "published", publishedAt: new Date() }).returning();
    versionId = version.id;

    const request = new NextRequest("http://localhost/api/video/attempts", {
      method: "POST",
      body: JSON.stringify({ moduleVersionId: version.id, userId: "attacker@example.com" }),
    });
    const response = await POST(request);
    expect(response.status).toBe(200);
    const body = await response.json();

    const [attempt] = await db.select().from(moduleAttempts).where(eq(moduleAttempts.id, body.attemptId));
    expect(attempt.userId).toBe("real-session-user@example.com");
  });

  it("rejects when there is no session", async () => {
    const { auth } = await import("@/auth");
    vi.mocked(auth).mockResolvedValueOnce(null);
    const request = new NextRequest("http://localhost/api/video/attempts", {
      method: "POST",
      body: JSON.stringify({ moduleVersionId: "00000000-0000-0000-0000-000000000000" }),
    });
    const response = await POST(request);
    expect(response.status).toBe(401);
  });
});
```

Create `app/api/video/commit/route.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { POST } from "./route";
import { db } from "@/lib/db/client";
import { moduleAttempts, videoAttemptState, courses, modules, moduleVersions } from "@/lib/db/schema";

describe("POST /api/video/commit", () => {
  let attemptId: string | undefined;
  let courseId: string | undefined;

  afterEach(async () => {
    if (attemptId) {
      await db.delete(videoAttemptState).where(eq(videoAttemptState.moduleAttemptId, attemptId));
      await db.delete(moduleAttempts).where(eq(moduleAttempts.id, attemptId));
    }
    if (courseId) {
      const mods = await db.select().from(modules).where(eq(modules.courseId, courseId));
      for (const m of mods) {
        await db.update(modules).set({ currentVersionId: null }).where(eq(modules.id, m.id));
        await db.delete(moduleVersions).where(eq(moduleVersions.moduleId, m.id));
      }
      await db.delete(modules).where(eq(modules.courseId, courseId));
      await db.delete(courses).where(eq(courses.id, courseId));
    }
    attemptId = courseId = undefined;
  });

  async function seedAttempt() {
    const [course] = await db.insert(courses).values({ code: `COMMIT-${Date.now()}`, title: "x" }).returning();
    courseId = course.id;
    const [mod] = await db.insert(modules).values({ courseId: course.id, moduleType: "video", title: "x" }).returning();
    const [version] = await db.insert(moduleVersions).values({ moduleId: mod.id, versionNumber: 1, status: "published", publishedAt: new Date() }).returning();
    const [attempt] = await db.insert(moduleAttempts).values({ moduleVersionId: version.id, userId: "x@example.com" }).returning();
    attemptId = attempt.id;
    return attempt.id;
  }

  it("inserts state on first commit, updates on later commits", async () => {
    const id = await seedAttempt();

    let request = new NextRequest("http://localhost/api/video/commit", {
      method: "POST",
      body: JSON.stringify({ attemptId: id, furthestWatchedSeconds: 10, lastPositionSeconds: 10, status: "in_progress" }),
    });
    let response = await POST(request);
    expect(response.status).toBe(200);

    request = new NextRequest("http://localhost/api/video/commit", {
      method: "POST",
      body: JSON.stringify({ attemptId: id, furthestWatchedSeconds: 30, lastPositionSeconds: 30, status: "in_progress" }),
    });
    response = await POST(request);
    expect(response.status).toBe(200);

    const [row] = await db.select().from(videoAttemptState).where(eq(videoAttemptState.moduleAttemptId, id));
    expect(row.furthestWatchedSeconds).toBe(30);
  });

  it("rejects a non-UUID attemptId", async () => {
    const request = new NextRequest("http://localhost/api/video/commit", {
      method: "POST",
      body: JSON.stringify({ attemptId: "not-a-uuid", furthestWatchedSeconds: 1, lastPositionSeconds: 1, status: "in_progress" }),
    });
    const response = await POST(request);
    expect(response.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run to verify all three fail**

Run: `npx vitest run lib/video/completion-status.test.ts app/api/video/attempts/route.test.ts app/api/video/commit/route.test.ts`
Expected: FAIL (nothing implemented yet)

- [ ] **Step 3: Implement completion-status.ts**

Create `lib/video/completion-status.ts`:

```ts
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { moduleAttempts, videoAttemptState } from "@/lib/db/schema";

export async function getLatestVideoStatus(
  moduleVersionId: string,
  userId: string
): Promise<string | null> {
  const [row] = await db
    .select({ status: videoAttemptState.status })
    .from(moduleAttempts)
    .leftJoin(videoAttemptState, eq(videoAttemptState.moduleAttemptId, moduleAttempts.id))
    .where(and(eq(moduleAttempts.moduleVersionId, moduleVersionId), eq(moduleAttempts.userId, userId)))
    .orderBy(desc(moduleAttempts.startedAt))
    .limit(1);

  return row?.status ?? null;
}
```

- [ ] **Step 4: Implement the attempts route**

Create `app/api/video/attempts/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { moduleAttempts } from "@/lib/db/schema";
import { badRequest, isUuid, serverError } from "@/lib/api/errors";
import { auth } from "@/auth";

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    const userId = session?.user?.email;
    if (!userId) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
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

- [ ] **Step 5: Implement the commit route**

Create `app/api/video/commit/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { videoAttemptState } from "@/lib/db/schema";
import { badRequest, isUuid, serverError } from "@/lib/api/errors";

export async function POST(request: NextRequest) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return badRequest("Request body must be valid JSON");
    }
    const { attemptId, furthestWatchedSeconds, lastPositionSeconds, status } = (body ?? {}) as {
      attemptId?: string;
      furthestWatchedSeconds?: number;
      lastPositionSeconds?: number;
      status?: string;
    };

    if (!attemptId || furthestWatchedSeconds === undefined || lastPositionSeconds === undefined || !status) {
      return badRequest("attemptId, furthestWatchedSeconds, lastPositionSeconds, and status are required");
    }
    if (!isUuid(attemptId)) {
      return badRequest("attemptId must be a UUID");
    }
    if (status !== "in_progress" && status !== "completed") {
      return badRequest("status must be 'in_progress' or 'completed'");
    }

    const existing = await db
      .select()
      .from(videoAttemptState)
      .where(eq(videoAttemptState.moduleAttemptId, attemptId));

    // A client-claimed `status: "completed"` is trusted here the same way
    // SCORM's `raw_cmi` is trusted (Global Constraints: not hardened
    // anti-cheat). The real defense is that the player only sends "completed"
    // on a genuine `ended` event, which the no-skip-ahead control makes hard
    // to reach dishonestly - see lib/video/video-player.tsx (Task 6).
    const values = { furthestWatchedSeconds, lastPositionSeconds, status, lastCommitAt: new Date() };

    if (existing.length === 0) {
      await db.insert(videoAttemptState).values({ moduleAttemptId: attemptId, ...values });
    } else {
      await db.update(videoAttemptState).set(values).where(eq(videoAttemptState.moduleAttemptId, attemptId));
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return serverError(error);
  }
}
```

- [ ] **Step 6: Run to verify all three pass**

Run: `npx vitest run lib/video/completion-status.test.ts app/api/video/attempts/route.test.ts app/api/video/commit/route.test.ts`
Expected: PASS

- [ ] **Step 7: Run the full suite and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all pass, no errors

- [ ] **Step 8: Commit**

```bash
git add app/api/video lib/video/completion-status.ts lib/video/completion-status.test.ts
git commit -m "feat: add video attempt creation and commit routes, session-scoped userId"
```

---

### Task 5: Course-progress integration

**Files:**
- Modify: `lib/scorm/course-progress.ts`
- Test (extend): `lib/scorm/course-progress.test.ts`

**Interfaces:**
- Consumes: `getLatestVideoStatus` from `lib/video/completion-status.ts` (Task 4).
- Produces: `isTrackedModuleType` now returns `true` for `"video"`; `getCourseProgressForLearner` correctly counts video completion.

- [ ] **Step 1: Write the failing test**

In `lib/scorm/course-progress.test.ts`, add a test asserting a course with one completed SCORM module and one completed video module reaches `"completed"` (this is the exact bug the old `TRACKED_MODULE_TYPES = new Set(["scorm"])` exclusion caused when video had no player at all - now that it does, the exclusion must come off):

```ts
it("reaches completed when both a SCORM and a video module are done", async () => {
  // Seed a course with a SCORM module (completed) and a video module
  // (videoAttemptState.status = "completed"), then assert
  // getCourseProgressForLearner returns { status: "completed", progress: 100 }.
  // Follow this file's existing seed/cleanup pattern exactly - insert
  // courses/modules/moduleVersions/scormModuleVersions or
  // videoModuleVersions/moduleAttempts/scormAttemptState or
  // videoAttemptState rows directly, matching the shape of the existing
  // "reaches completed" test already in this file, then clean up in a
  // try/finally.
});
```

(The implementer writes the full seed/assert/cleanup body here, mirroring this file's own existing tests exactly - the plan text above states the requirement precisely enough that copying the file's established pattern is mechanical, and pre-writing it here would just be transcribing what's already on screen.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/scorm/course-progress.test.ts -t "reaches completed when both"`
Expected: FAIL

- [ ] **Step 3: Update course-progress.ts**

In `lib/scorm/course-progress.ts`:

```ts
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { modules } from "@/lib/db/schema";
import { isUuid } from "@/lib/api/errors";
import { getLatestLessonStatus } from "./completion-status";
import { getLatestVideoStatus } from "@/lib/video/completion-status";

const FINISHED_STATUSES = new Set(["completed", "passed"]);
const VIDEO_FINISHED_STATUSES = new Set(["completed"]);

/**
 * Module types that report completion back to the LMS. Video now has a real
 * player and real completion tracking (lib/video/completion-status.ts) - it
 * was excluded here only while it was placeholder-only.
 */
const TRACKED_MODULE_TYPES = new Set(["scorm", "video"]);

export interface CourseProgress {
  status: "not-started" | "in-progress" | "completed";
  progress: number;
}

export function isTrackedModuleType(moduleType: string): boolean {
  return TRACKED_MODULE_TYPES.has(moduleType);
}

async function isModuleFinishedForUser(
  moduleType: string,
  moduleVersionId: string,
  userId: string
): Promise<boolean> {
  if (moduleType === "video") {
    const status = await getLatestVideoStatus(moduleVersionId, userId);
    return status !== null && VIDEO_FINISHED_STATUSES.has(status);
  }
  const lessonStatus = await getLatestLessonStatus(moduleVersionId, userId);
  return lessonStatus !== null && FINISHED_STATUSES.has(lessonStatus);
}

export async function getCourseProgressForLearner(
  courseId: string,
  userId: string
): Promise<CourseProgress> {
  if (!isUuid(courseId)) {
    return { status: "not-started", progress: 0 };
  }

  const courseModules = await db.select().from(modules).where(eq(modules.courseId, courseId));
  const trackedModules = courseModules.filter(
    (m) => m.currentVersionId !== null && isTrackedModuleType(m.moduleType)
  );

  if (trackedModules.length === 0) {
    return { status: "not-started", progress: 0 };
  }

  const finishedFlags = await Promise.all(
    trackedModules.map((m) => isModuleFinishedForUser(m.moduleType, m.currentVersionId as string, userId))
  );
  const completedCount = finishedFlags.filter(Boolean).length;
  const progress = Math.round((completedCount / trackedModules.length) * 100);

  if (completedCount === 0) {
    return { status: "not-started", progress: 0 };
  }
  if (completedCount === trackedModules.length) {
    return { status: "completed", progress: 100 };
  }
  return { status: "in-progress", progress };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/scorm/course-progress.test.ts`
Expected: PASS (all tests in this file)

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all pass, no errors

- [ ] **Step 6: Commit**

```bash
git add lib/scorm/course-progress.ts lib/scorm/course-progress.test.ts
git commit -m "feat: count video modules toward course completion again, now that they're real"
```

---

### Task 6: Learner player page & component

**Files:**
- Create: `components/video/video-player.tsx` (client component)
- Create: `app/(app)/courses/[id]/video/[moduleVersionId]/page.tsx`
- Modify: `app/(app)/courses/[id]/page.tsx` (video row link)
- Test: none for the `.tsx` files (matches this codebase's established convention - no automated test for page/client-component files; manual verification only, see Step 5)

**Interfaces:**
- Consumes: `getVideoLaunchInfo` (Task 3), `getLatestVideoStatus` (Task 4), `POST /api/video/attempts` and `POST /api/video/commit` (Task 4).

- [ ] **Step 1: Signed-token minting helper**

Add to `lib/video/mux-client.ts` (from Task 1):

```ts
export function signPlaybackToken(muxPlaybackId: string): string {
  const mux = getMuxClient();
  return mux.jwt.signPlaybackId(muxPlaybackId, { expiration: "2h", type: "video" });
}
```

A 2-hour expiration comfortably covers one viewing session without needing a token-refresh mechanism in the player - if the SDK's `type` values differ from `"video"` (check the installed types per Task 1 Step 1's guidance), use whatever the SDK calls the standard playback token type.

- [ ] **Step 2: The player component**

Create `components/video/video-player.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import MuxPlayer from "@mux/mux-player-react";
import { CheckCircle2 } from "lucide-react";

const TOLERANCE_SECONDS = 3;
const COMMIT_INTERVAL_MS = 15_000;

export function VideoPlayer({
  playbackToken,
  durationSeconds,
  moduleVersionId,
  initialFurthestWatchedSeconds,
}: {
  playbackToken: string;
  durationSeconds: number;
  moduleVersionId: string;
  initialFurthestWatchedSeconds: number;
}) {
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const furthestRef = useRef(initialFurthestWatchedSeconds);
  const positionRef = useRef(initialFurthestWatchedSeconds);
  const attemptIdRef = useRef<string | null>(null);
  const playerRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/video/attempts", {
      method: "POST",
      body: JSON.stringify({ moduleVersionId }),
    })
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to create video attempt (status ${res.status})`);
        return res.json();
      })
      .then((body) => {
        if (cancelled) return;
        setAttemptId(body.attemptId);
        attemptIdRef.current = body.attemptId;
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to start this video");
      });
    return () => {
      cancelled = true;
    };
  }, [moduleVersionId]);

  function commit(status: "in_progress" | "completed") {
    if (!attemptIdRef.current) return;
    fetch("/api/video/commit", {
      method: "POST",
      body: JSON.stringify({
        attemptId: attemptIdRef.current,
        furthestWatchedSeconds: Math.floor(furthestRef.current),
        lastPositionSeconds: Math.floor(positionRef.current),
        status,
      }),
      keepalive: status === "completed" || document.visibilityState === "hidden",
    }).catch(() => {
      // Best-effort - a missed periodic commit is recovered by the next one
      // or the final `ended` commit; not surfaced to the learner.
    });
  }

  useEffect(() => {
    if (!attemptId) return;
    const interval = setInterval(() => commit("in_progress"), COMMIT_INTERVAL_MS);
    const onHide = () => commit("in_progress");
    document.addEventListener("visibilitychange", onHide);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [attemptId]);

  if (error) {
    return <p className="text-sm text-destructive">{error}</p>;
  }

  if (completed) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-center">
        <CheckCircle2 className="h-10 w-10 text-emerald-600" />
        <p className="text-lg font-medium">Video complete</p>
      </div>
    );
  }

  return (
    <MuxPlayer
      ref={playerRef}
      playbackId={undefined}
      tokens={{ playback: playbackToken }}
      startTime={positionRef.current}
      onLoadedMetadata={() => {
        if (playerRef.current) playerRef.current.currentTime = positionRef.current;
      }}
      onTimeUpdate={(e) => {
        const current = (e.target as HTMLVideoElement).currentTime;
        positionRef.current = current;
        if (current > furthestRef.current) furthestRef.current = current;
      }}
      onSeeking={(e) => {
        const target = e.target as HTMLVideoElement;
        if (target.currentTime > furthestRef.current + TOLERANCE_SECONDS) {
          target.currentTime = furthestRef.current;
        }
      }}
      onEnded={() => {
        // Only reachable via genuine playback reaching the end - skip-ahead
        // is blocked above, so this event is not reachable by jumping to
        // the end directly. Server-side double-check happens in the commit
        // route by trusting this signal the same way SCORM trusts raw_cmi
        // (Global Constraints) - not hardened, but this is the honest path.
        furthestRef.current = durationSeconds;
        commit("completed");
        setCompleted(true);
      }}
    />
  );
}
```

Note: `MuxPlayer`'s exact prop names for a signed token (`tokens={{ playback: ... }}` vs a different shape) and its event-handler prop names (`onTimeUpdate`/`onSeeking`/`onEnded` vs different casing) must be verified against the installed `@mux/mux-player-react` version's types before this compiles - check `node_modules/@mux/mux-player-react/**/*.d.ts` if `npx tsc --noEmit` fails on this file, per the same principle as Task 1 Step 1.

- [ ] **Step 3: The learner page**

Create `app/(app)/courses/[id]/video/[moduleVersionId]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { getVideoLaunchInfo } from "@/lib/video/launch-info";
import { getLatestVideoStatus } from "@/lib/video/completion-status";
import { signPlaybackToken } from "@/lib/video/mux-client";
import { VideoPlayer } from "@/components/video/video-player";

export default async function LearnerVideoPage(
  props: PageProps<"/courses/[id]/video/[moduleVersionId]">
) {
  const { moduleVersionId } = await props.params;

  const session = await auth();
  const userId = session?.user?.email;
  if (!userId) {
    notFound();
  }

  const info = await getVideoLaunchInfo(moduleVersionId);
  if (!info) {
    notFound();
  }

  const status = await getLatestVideoStatus(moduleVersionId, userId);
  if (status === "completed") {
    const { CheckCircle2 } = await import("lucide-react");
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-center">
        <CheckCircle2 className="h-10 w-10 text-emerald-600" />
        <p className="text-lg font-medium">Video complete</p>
        <p className="text-sm text-muted-foreground">You&apos;ve already completed this video.</p>
      </div>
    );
  }

  const token = signPlaybackToken(info.muxPlaybackId);

  return (
    <div className="flex h-full w-full flex-col gap-4">
      <VideoPlayer
        playbackToken={token}
        durationSeconds={info.durationSeconds}
        moduleVersionId={moduleVersionId}
        initialFurthestWatchedSeconds={0}
      />
    </div>
  );
}
```

Note: `initialFurthestWatchedSeconds={0}` is a known simplification - resuming from `videoAttemptState.furthestWatchedSeconds` on a genuinely in-progress (not completed, not never-started) attempt would need one more query here (parallel to how `status` is already fetched). Left as `0` for this pass since it doesn't block correctness (a learner just restarts from the beginning instead of resuming) - flag this as a follow-up in the ledger during implementation rather than scope-creeping this task, unless it's trivial to add once you're looking at this exact code (in which case: query the latest `videoAttemptState` row the same way `getLatestVideoStatus` does, and pass its `furthestWatchedSeconds` through instead of the hardcoded `0`).

- [ ] **Step 4: Wire up the course-detail page's video row**

In `app/(app)/courses/[id]/page.tsx`, find the video-module row (added in the course-authoring final-review fix wave, currently a disabled "Coming soon" button) and replace it with a real link, matching the exact pattern already used for SCORM module rows in the same file:

```tsx
<Link href={`/courses/${realCourse.id}/video/${module.moduleVersionId}`}>
  <Button variant={module.done ? "outline" : "default"} size="sm">
    {module.done ? "Review" : "Start"}
  </Button>
</Link>
```

(Read the file first to find the exact current disabled-button JSX and PlayCircle-icon row structure added in the fix wave, and replace only that button - the icon/row/label structure around it stays as-is.)

- [ ] **Step 5: Manually verify**

1. `npm run dev` (local dev, port 3001), sign in.
2. In the admin builder, add a video module and upload a real small video file (Task 7 must be done first for this - if doing tasks in order, come back to this verification after Task 7).
3. Wait for it to reach "ready" status in the builder.
4. Publish the course.
5. As a learner, visit the course detail page, click "Start" on the video module - confirm it plays.
6. Try to drag the scrubber forward past the current playback position - confirm it snaps back.
7. Rewind to an earlier point - confirm rewinding works freely.
8. Let the video play to the end - confirm a "Video complete" state appears, and the course's overall progress bar reflects it.
9. Reload the course detail page - confirm the video module now shows "Review" instead of "Start", and revisiting it shows "Video complete" immediately rather than replaying.

- [ ] **Step 6: Commit**

```bash
git add components/video app/\(app\)/courses/\[id\]/video lib/video/mux-client.ts "app/(app)/courses/[id]/page.tsx"
git commit -m "feat: add the learner-facing video player with no-skip-ahead and completion tracking"
```

---

### Task 7: Builder UI upload flow

**Files:**
- Modify: `app/(app)/admin/content/builder/[courseId]/builder-client.tsx`
- Test: none (matches this codebase's established convention for `.tsx` client components)

**Interfaces:**
- Consumes: `POST /api/admin/courses/[courseId]/modules/video` and `GET .../[moduleId]/video-status` (Task 2).

- [ ] **Step 1: Replace the video tab's state and handler**

In `builder-client.tsx`, replace:

```ts
const [videoTitle, setVideoTitle] = useState("");
const [videoDuration, setVideoDuration] = useState("");
```

with:

```ts
const [videoTitle, setVideoTitle] = useState("");
const [videoFile, setVideoFile] = useState<File | null>(null);
const [videoUploading, setVideoUploading] = useState(false);
const [videoStatus, setVideoStatus] = useState<string | null>(null);
const [videoError, setVideoError] = useState<string | null>(null);
```

Replace `handleAddVideo` entirely:

```ts
async function handleAddVideo(e: React.FormEvent) {
  e.preventDefault();
  if (!videoFile) {
    setVideoError("Choose a video file to upload");
    return;
  }
  setVideoUploading(true);
  setVideoError(null);
  setVideoStatus("waiting");

  const createResponse = await fetch(`/api/admin/courses/${course.id}/modules/video`, {
    method: "POST",
    body: JSON.stringify({ title: videoTitle }),
  });
  const createBody = await createResponse.json();
  if (!createResponse.ok) {
    setVideoError(createBody.error ?? "Could not start the upload");
    setVideoUploading(false);
    setVideoStatus(null);
    return;
  }

  const putResponse = await fetch(createBody.uploadUrl, { method: "PUT", body: videoFile });
  if (!putResponse.ok) {
    setVideoError("Upload to Mux failed");
    setVideoUploading(false);
    setVideoStatus(null);
    return;
  }

  setVideoStatus("preparing");
  const { moduleId } = createBody;
  const poll = async () => {
    const statusResponse = await fetch(`/api/admin/courses/${course.id}/modules/${moduleId}/video-status`);
    const statusBody = await statusResponse.json();
    if (statusBody.status === "ready" || statusBody.status === "errored") {
      setVideoStatus(statusBody.status);
      setVideoUploading(false);
      if (statusBody.status === "ready") {
        setVideoTitle("");
        setVideoFile(null);
        setAddModuleOpen(false);
        window.location.reload();
      }
      return;
    }
    setVideoStatus(statusBody.status);
    setTimeout(poll, 3000);
  };
  poll();
}
```

- [ ] **Step 2: Replace the video tab's form JSX**

Replace the `<TabsContent value="video">` block's form contents (the duration-minutes input and its label) with a file picker and a status readout, following the same structural pattern as the adjacent SCORM tab's file input:

```tsx
<TabsContent value="video">
  <form onSubmit={handleAddVideo} className="flex flex-col gap-4 pt-4">
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="videoTitle">Module Title</Label>
      <Input
        id="videoTitle"
        value={videoTitle}
        onChange={(e) => setVideoTitle(e.target.value)}
        required
      />
    </div>
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="videoFile">Video File</Label>
      <input
        id="videoFile"
        type="file"
        accept="video/*"
        onChange={(e) => setVideoFile(e.target.files?.[0] ?? null)}
      />
      {videoFile && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <PlayCircle className="h-3.5 w-3.5" />
          {videoFile.name}
        </p>
      )}
    </div>
    {videoStatus && (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        {videoUploading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        Status: {videoStatus}
      </p>
    )}
    {videoError && <p className="text-sm text-destructive">{videoError}</p>}
    <Button type="submit" disabled={videoUploading}>
      {videoUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
      {videoUploading ? "Uploading…" : "Upload Video"}
    </Button>
  </form>
</TabsContent>
```

Update the adjacent `<TabsTrigger value="video">` label from `"Add Video Placeholder"` to `"Upload Video"`.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Manually verify**

1. `npm run dev`, sign in as an admin.
2. Open a course in the builder, click "Add Module" → "Upload Video".
3. Pick a small real video file, submit.
4. Confirm the status readout progresses `waiting` → `preparing` → `ready` (polling every 3s), and the page reloads showing the new module once ready.
5. Try uploading an 11th video across the whole org's Mux account (if near the free-tier cap) - confirm the clear "Free-tier limit reached" error appears instead of a raw failure.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/admin/content/builder/[courseId]/builder-client.tsx"
git commit -m "feat: replace the video-placeholder builder form with a real Mux upload flow"
```

---

## Self-Review Notes

- **Spec coverage:** Section 1 (data model) → Task 1. Section 2 (upload mechanics) → Task 2. Section 3 (playback & access gate) → Task 3, Task 6. Section 4 (no-skip-ahead player & completion) → Task 4, Task 6. Section 5 (course-progress & learner-page integration) → Task 5, Task 6. Section 6 (cleanup & free-tier cap) → Task 1 (guard constant), Task 2 (upload-time check), Task 3 (removeModule cleanup).
- **Placeholder scan:** no TBD/TODO. Task 5's course-progress test step describes the seed pattern precisely rather than transcribing it, since it is a mechanical copy of an existing test in the same file already visible to the implementer - this is a judgment call under "No Placeholders," not an omission of real content; every other step in this plan has complete, real code.
- **Type consistency:** `VideoLaunchInfo` (Task 3) fields (`muxPlaybackId`, `durationSeconds`) match exactly what Task 6's page consumes. `videoAttemptState`'s columns (Task 1) match exactly what Task 4's commit route reads/writes and Task 5's `isModuleFinishedForUser` reads via `getLatestVideoStatus`. The commit route's request shape (`attemptId`, `furthestWatchedSeconds`, `lastPositionSeconds`, `status`) matches exactly what Task 6's player component sends.
- **Known open item carried into implementation** (not a plan defect, an intentional simplification flagged in Task 6 Step 3): resume-from-furthest-watched-position on the learner page is stubbed to `0` rather than querying the real value, since it doesn't affect correctness (worst case, a learner re-watches from the start) and the spec didn't treat resume as a hard requirement - only completion tracking and the no-skip-ahead rule were.
