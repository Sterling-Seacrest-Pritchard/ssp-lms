import { NextResponse } from "next/server";

/**
 * Shared JSON error responses for Route Handlers.
 *
 * Use `badRequest`/`notFound` for expected validation failures and
 * `serverError` as the catch-all, so malformed input surfaces as a 400/404
 * instead of an unhandled 500.
 */
export function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export function notFound(message: string) {
  return NextResponse.json({ error: message }, { status: 404 });
}

export function serverError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected error";
  return NextResponse.json({ error: message }, { status: 500 });
}

/** Shape of a canonical UUID, used to reject garbage ids before they reach Postgres. */
export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}
