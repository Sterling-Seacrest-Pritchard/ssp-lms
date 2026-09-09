import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { setUserDepartment } from "@/lib/db/departments";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { badRequest, isUuid, serverError } from "@/lib/api/errors";

async function parseParams(
  params: Promise<{ id: string }>,
  request: NextRequest
): Promise<{ departmentId: string; userId: string } | NextResponse> {
  const { id } = await params;
  if (!isUuid(id)) return badRequest("id must be a UUID");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("Request body must be valid JSON");
  }
  const userId = (body as { userId?: unknown })?.userId;
  if (typeof userId !== "string" || !isUuid(userId)) {
    return badRequest("userId must be a UUID");
  }
  return { departmentId: id, userId };
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const parsed = await parseParams(params, request);
    if (parsed instanceof NextResponse) return parsed;

    await setUserDepartment(parsed.userId, parsed.departmentId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return serverError(error);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const parsed = await parseParams(params, request);
    if (parsed instanceof NextResponse) return parsed;

    // Only clear the user's department if they currently belong to *this*
    // department, so a stale/racing UI can't clear a user out of a
    // different department they were moved into in the meantime.
    await db
      .update(users)
      .set({ departmentId: null, updatedAt: new Date() })
      .where(and(eq(users.id, parsed.userId), eq(users.departmentId, parsed.departmentId)));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return serverError(error);
  }
}
