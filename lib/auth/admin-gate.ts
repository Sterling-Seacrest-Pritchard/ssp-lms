import { NextResponse } from "next/server";

/**
 * Path-based admin gating, shared by the proxy (this Next.js version's renamed
 * middleware).
 *
 * Kept in its own module - and free of any next-auth import - so the gating
 * rules can be unit tested without standing up an auth provider.
 */

function isAtOrUnder(pathname: string, prefix: string): boolean {
  // Exact match or a real path segment boundary, so "/administrators" doesn't
  // get treated as living under "/admin".
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/**
 * Does this path require an Admin role?
 *
 * Covers BOTH the admin UI (`/admin/...`) and the admin API
 * (`/api/admin/...`). The `/api/admin` mutation routes - course create,
 * details update, publish, add module, remove module, reorder, SCORM upload -
 * do no role checking of their own, so leaving that prefix out of this gate
 * let any signed-in learner create, rename, publish, reorder or delete course
 * content by calling those endpoints directly over HTTP.
 */
export function requiresAdminRole(pathname: string): boolean {
  return isAtOrUnder(pathname, "/admin") || isAtOrUnder(pathname, "/api/admin");
}

/**
 * The response a non-admin gets for an admin-only path.
 *
 * API callers get a 403 JSON body rather than a redirect: `fetch`/XHR follows
 * a redirect transparently, so redirecting to an HTML page hands the caller a
 * 200 HTML response that its `response.ok` check passes and its `.json()`
 * parse then chokes on. Page requests keep the pre-existing redirect to the
 * app root.
 */
export function adminForbiddenResponse(pathname: string, requestUrl: string): NextResponse {
  if (isAtOrUnder(pathname, "/api")) {
    return NextResponse.json({ error: "Admin role required" }, { status: 403 });
  }
  return NextResponse.redirect(new URL("/", requestUrl));
}
