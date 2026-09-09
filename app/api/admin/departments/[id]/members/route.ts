import { NextRequest, NextResponse } from "next/server";
import { clearUserDepartment, setUserDepartment } from "@/lib/db/departments";
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

    await clearUserDepartment(parsed.userId, parsed.departmentId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return serverError(error);
  }
}
