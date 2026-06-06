/**
 * Preview-protocol addressing primitives — single source of truth for the
 * `/preview/<port>/...` URL convention and the synthetic `preview.local` host,
 * shared between `@riftydev/service-worker` and `@riftydev/net`.
 *
 * Per ADR-0036 the regex and host literal live here so a routing-scheme change
 * is a one-edit change rather than a multi-package hunt for inlined copies. Both
 * SW and net depend on `@riftydev/io`, keeping imports top-down (ADR-0012, ADR-0035).
 *
 * Module shape is pinned by `SW_ROUTING_VERSION` (ADR-0040); wire-frame shapes by
 * `SW_FRAME_VERSION` (ADR-0031, refined by ADR-0040). Both constants are stamped
 * on every SW↔main frame so addressing-shape and frame-shape drift are distinct failures.
 */

/**
 * Regex matching the `/preview/<port>/...` request path the SW intercepts.
 * Groups: 1 = `<port>` digits; 2 = optional suffix (`/foo/bar`), empty for the
 * bare `/preview/<port>` form. Exported so adapters can match without re-deriving
 * the pattern; canonical helper is {@link parsePreviewPath}.
 */
export const PREVIEW_PREFIX_RE = /^\/preview\/(\d+)(\/.*)?$/;

/**
 * Synthetic host for upstream URLs after stripping the `/preview/<port>` prefix.
 * Uses the `.local` mDNS-reserved suffix so it never collides with a real DNS
 * name even if the URL leaks into a log or `fetch` error.
 */
export const PREVIEW_LOCAL_HOST = 'preview.local';

/**
 * Build the upstream URL the SW forwards to the owning client. `path` is the
 * post-prefix portion of the request (e.g. `/foo` for `/preview/3000/foo`).
 * Scheme is hard-coded `http://`: the hostname is fictitious and the request
 * never leaves the page realm, so there is nothing to negotiate over TLS.
 */
export function synthesizePreviewUrl(path: string): string {
  return `http://${PREVIEW_LOCAL_HOST}${path}`;
}

/**
 * Parse a pathname against {@link PREVIEW_PREFIX_RE}. Returns `null` for a
 * non-preview path; otherwise `port` (decimal int) and `rest` after the prefix.
 * `rest` is `/` for the bare `/preview/<port>` form, matching what the SW needs
 * to synthesise an upstream URL.
 */
export function parsePreviewPath(path: string): { port: number; rest: string } | null {
  const m = PREVIEW_PREFIX_RE.exec(path);
  if (!m) return null;
  const port = Number.parseInt(m[1]!, 10);
  const rest = m[2] ?? '/';
  return { port, rest };
}
