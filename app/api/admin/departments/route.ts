import { NextRequest, NextResponse } from "next/server";
import { createDepartment } from "@/lib/db/departments";
import { badRequest, serverError } from "@/lib/api/errors";

/** Postgres unique_violation error code. */
const UNIQUE_VIOLATION = "23505";

export async function POST(request: NextRequest) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return badRequest("Request body must be valid JSON");
    }

    const name = (body as { name?: unknown })?.name;
    if (typeof name !== "string" || name.trim().length === 0) {
      return badRequest("name is required");
    }

    try {
      const dept = await createDepartment(name.trim());
      return NextResponse.json(dept, { status: 201 });
    } catch (error) {
      // Check if this is a Postgres unique violation error (either direct or wrapped by Drizzle)
      const dbError = error && typeof error === "object" ? error : null;
      const code = dbError && "code" in dbError ? dbError.code : null;
      const causeCode = dbError && "cause" in dbError && dbError.cause && typeof dbError.cause === "object" && "code" in dbError.cause ? dbError.cause.code : null;

      if (code === UNIQUE_VIOLATION || causeCode === UNIQUE_VIOLATION) {
        return badRequest("A department with that name already exists");
      }
      throw error;
    }
  } catch (error) {
    return serverError(error);
  }
}
