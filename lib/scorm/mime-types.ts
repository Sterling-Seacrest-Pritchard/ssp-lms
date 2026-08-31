/**
 * File-extension -> MIME-type mapping shared by the SCORM package extractor
 * (which stores each unzipped entry in Supabase Storage) and the same-origin
 * content proxy (which serves those bytes back to the launch iframe).
 *
 * Both sides MUST use the same table: Supabase Storage defaults uploads with no
 * explicit `contentType` to `text/plain;charset=UTF-8`, which makes a browser
 * refuse to render `.html` or execute `.js`. Keeping one table here means the
 * `Content-Type` the proxy returns always matches what was stored.
 */
const MIME_TYPES_BY_EXTENSION: Record<string, string> = {
  ".html": "text/html",
  ".htm": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".xml": "application/xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".eot": "application/vnd.ms-fontobject",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain",
  ".vtt": "text/vtt",
};

export const DEFAULT_MIME_TYPE = "application/octet-stream";

/**
 * Resolve the MIME type for a file path or name by its extension.
 * Unknown extensions (and paths with no extension) fall back to
 * `application/octet-stream`.
 */
export function mimeTypeForPath(filePath: string): string {
  const lastDot = filePath.lastIndexOf(".");
  const lastSlash = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  if (lastDot === -1 || lastDot < lastSlash) {
    return DEFAULT_MIME_TYPE;
  }

  const extension = filePath.slice(lastDot).toLowerCase();
  return MIME_TYPES_BY_EXTENSION[extension] ?? DEFAULT_MIME_TYPE;
}
