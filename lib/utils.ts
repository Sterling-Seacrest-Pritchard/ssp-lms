import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function getInitials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()
}

/**
 * Notification `linkHref` values are stored as plain, unvalidated `text` -
 * every current write path hardcodes an internal `/courses/{uuid}` path, but
 * nothing at the schema or write layer stops a future caller from putting
 * something else there. Both the dashboard's `<Link href>` and the
 * notification bell's `router.push` navigate directly on this value, so a
 * `javascript:`-scheme (or similar) string would execute on click/navigate -
 * restrict to same-origin absolute paths only, never an external/script URL.
 */
export function isSafeInternalHref(href: string): boolean {
  // This runs in both the browser (notification-bell.tsx, a client
  // component) and on the server (page.tsx) - two different URL-parser
  // implementations that could in principle disagree on some malformed
  // edge case. The structural checks below (plain string operations,
  // identical in every JS engine) are the real gate; URL-based origin
  // resolution is reinforcement, not the sole check.
  //
  // Must be an absolute path, not scheme-relative ("//evil.com") or a bare
  // relative reference (which the URL resolver would otherwise happily
  // resolve onto our own origin, accepting a shape no real notification
  // linkHref - always "/courses/{uuid}" - ever takes).
  if (!href.startsWith("/") || href.startsWith("//")) return false
  // Browsers normalize backslashes to forward slashes before parsing a URL,
  // so "/\evil.com" (or a percent-encoded slash/backslash) can resolve as
  // protocol-relative to a foreign host despite starting with a single "/".
  if (/\\|%2f|%5c/i.test(href)) return false
  try {
    const resolved = new URL(href, "https://same-origin.invalid")
    return resolved.origin === "https://same-origin.invalid"
  } catch {
    return false
  }
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  const units = ["KB", "MB", "GB"]
  let value = bytes / 1024
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex++
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`
}

/**
 * `notFound()` (from `next/navigation`) throws to unwind the render, tagged
 * with a `digest` starting "NEXT_HTTP_ERROR_FALLBACK" (see
 * next/dist/client/components/http-access-fallback - not exported from the
 * public API, so this checks the same `digest` shape directly). That's
 * Next's own render-unwinding signal, not a real failure - a `try/catch`
 * wrapping a DB call that also calls `notFound()` must re-throw it rather
 * than swallow it into a generic "unavailable" state.
 */
export function isNextNotFoundError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "digest" in err &&
    typeof err.digest === "string" &&
    err.digest.startsWith("NEXT_HTTP_ERROR_FALLBACK")
  )
}
