import { NextResponse } from "next/server";
import { serverError } from "@/lib/api/errors";
import { syncAssignedUsers } from "@/lib/entra/sync";

export async function POST() {
  try {
    const result = await syncAssignedUsers();
    return NextResponse.json(result);
  } catch (error) {
    return serverError(error);
  }
}
