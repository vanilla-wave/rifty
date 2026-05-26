/**
 * Preview-protocol addressing primitives — the single source of truth for the
 * `/preview/<port>/...` URL convention and the synthetic `preview.local` host
 * shared between `@rifty/service-worker` (which intercepts the request path)
 * and `@rifty/net` (whose registry the SW dispatches into).
 *
 * Per ADR-0036 the regex and host literal live here so a future routing-scheme
 * change is a one-edit change in `@rifty/io` rather than a multi-package hunt
 * for inlined copies. Both SW and net depend on `@rifty/io`, so the import
 * direction stays top-down (ADR-0012, ADR-0035 use the same pattern for other
 * cross-package primitives).
 *
 * Orthogonal to ADR-0031 (`SW_PROTOCOL_VERSION` on every wire frame). This
 * module fixes the *addressing* drift hazard; ADR-0031 fixes the *frame
 * format* drift hazard. They share no symbols.
 */

/**
 * Regex matching the `/preview/<port>/...` request path the Service Worker
 * intercepts. Capture groups:
 *   1. `<port>` — one or more digits.
 *   2. The suffix path (`/foo/bar`), optional. Empty when the request is the
 *      bare `/preview/<port>` form.
 *
 * Exported as a constant so adapters can run their own matches without
 * re-deriving the pattern; the canonical helper is
 * {@link parsePreviewPath}, which parses the port and normalises the suffix.
 */
export const PREVIEW_PREFIX_RE = /^\/preview\/(\d+)(\/.*)?$/;

/**
 * The synthetic host the Service Worker synthesises for upstream request
 * URLs after stripping the `/preview/<port>` prefix. Lives in the
 * `.local` mDNS-reserved suffix so it never collides with a real DNS name
 * even if the URL leaks into a log or a `fetch` error.
 *
 * Anything that hard-codes `'preview.local'` in this repo should be
 * replaced with this constant.
 */
export const PREVIEW_LOCAL_HOST = 'preview.local';

/**
 * Build the upstream URL the SW forwards to the owning client. The `path`
 * argument is the post-prefix portion of the original request (e.g. `/foo`
 * for an incoming `/preview/3000/foo`).
 *
 * Returned URL shape: `http://preview.local${path}`. The scheme is hard-coded
 * `http://` because the synthesised hostname is fictitious — the request
 * never leaves the page realm, so there is nothing to negotiate over TLS
 * against.
 */
export function synthesizePreviewUrl(path: string): string {
  return `http://${PREVIEW_LOCAL_HOST}${path}`;
}

/**
 * Parse a request pathname against {@link PREVIEW_PREFIX_RE}. Returns
 * `null` when the path is not a preview request; otherwise the parsed
 * `port` (decimal integer) and the path `rest` after the
 * `/preview/<port>` prefix. The `rest` is `/` when the request was the
 * bare `/preview/<port>` form (no trailing slash), matching what the SW
 * needs to synthesise an upstream URL.
 */
export function parsePreviewPath(path: string): { port: number; rest: string } | null {
  const m = PREVIEW_PREFIX_RE.exec(path);
  if (!m) return null;
  const port = Number.parseInt(m[1]!, 10);
  const rest = m[2] ?? '/';
  return { port, rest };
}
