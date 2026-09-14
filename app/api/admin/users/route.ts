import { NextResponse } from "next/server";
import { listUsersWithStatus } from "@/lib/db/course-assignments";
import { serverError } from "@/lib/api/errors";

export async function GET() {
  try {
    const users = await listUsersWithStatus();
    return NextResponse.json({ users });
  } catch (error) {
    return serverError(error);
  }
}
