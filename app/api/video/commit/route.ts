import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { moduleAttempts, videoAttemptState } from "@/lib/db/schema";
import { badRequest, isUuid, notFound, serverError } from "@/lib/api/errors";
import { auth } from "@/auth";

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    const sessionUserId = session?.user?.email;
    if (!sessionUserId) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }

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

    // The attempt must exist AND belong to the caller. Both misses collapse to
    // the same 404: a 403 would tell an attacker holding a guessed UUID that
    // the attempt is real and someone else's. This also turns a
    // bogus-but-UUID-shaped attemptId into a clean 404 instead of the 500 the
    // video_attempt_state -> module_attempts FK used to raise on insert.
    const [attempt] = await db
      .select({ userId: moduleAttempts.userId })
      .from(moduleAttempts)
      .where(eq(moduleAttempts.id, attemptId));
    if (!attempt || attempt.userId !== sessionUserId) {
      return notFound("Attempt not found");
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
