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
