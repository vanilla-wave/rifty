/**
 * Preview-protocol addressing primitives — single source of truth for the
 * `/preview/<port>/...` URL convention, plus the legacy explicit-HMR
 * `preview.local` host constant, shared between `@riftydev/service-worker`
 * and `@riftydev/net`.
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
 * Synthetic host kept for the EXPLICIT `setupHmrBridge`/devMode legacy path
 * (never a real DNS name — `.local` is mDNS-reserved). The SW preview path no
 * longer uses it: {@link synthesizePreviewUrl} emits `localhost` so guest
 * servers see the Host a real local dev run would.
 */
export const PREVIEW_LOCAL_HOST = 'preview.local';

/**
 * Build the upstream URL the SW forwards to the owning client. `path` is the
 * post-prefix portion of the request (e.g. `/foo` for `/preview/3000/foo`).
 * The host is `localhost:<port>` — exactly what a real local dev run puts in
 * `Host` — so host-derived consumers (`@hono/node-server`) keep the original
 * preview port and generic host allow-lists can be retired at the protocol
 * layer. Vite's `allowedHosts` force still has a separate recorded hang before
 * it can retire. Scheme is hard-coded `http://`: the request never leaves the
 * page realm, so there is nothing to negotiate over TLS. Addressing change =
 * SW_ROUTING_VERSION bump.
 */
export function synthesizePreviewUrl(path: string, port?: number): string {
  const host = port === undefined ? 'localhost' : `localhost:${port}`;
  return `http://${host}${path}`;
}

/**
 * Parse a pathname against a host-selected prefix (default `/preview`).
 * Returns `null` for a non-preview path; otherwise `port` and `rest` after
 * `<prefix>/<port>`. `rest` is `/` for the bare `<prefix>/<port>` form.
 * Omitted/`/preview` keeps {@link PREVIEW_PREFIX_RE} as the default regex.
 */
export function parsePreviewPath(
  path: string,
  prefix = '/preview',
): { port: number; rest: string } | null {
  if (path !== prefix && !path.startsWith(`${prefix}/`)) return null;
  const matched = /^\/(\d+)(\/.*)?$/.exec(path.slice(prefix.length));
  if (!matched) return null;
  return { port: Number.parseInt(matched[1]!, 10), rest: matched[2] ?? '/' };
}

/** Document URL for a preview port under a validated prefix. */
export function previewDocumentPath(prefix: string, port: number): string {
  return `${prefix}/${String(port)}/`;
}
