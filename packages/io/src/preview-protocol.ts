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

export const DEFAULT_PREVIEW_PREFIX = '/preview/';

/**
 * Regex matching the `/preview/<port>/...` request path the SW intercepts.
 * Groups: 1 = `<port>` digits; 2 = optional suffix (`/foo/bar`), empty for the
 * bare `/preview/<port>` form. Exported so adapters can match without re-deriving
 * the pattern; canonical helper is {@link parsePreviewPath}.
 */
export const PREVIEW_PREFIX_RE = /^\/preview\/(\d+)(\/.*)?$/;

/** Canonical absolute pathname prefix (ADR-0409); never decode escaped bytes twice. */
export function normalizePreviewPrefix(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    // biome-ignore lint/suspicious/noControlCharactersInRegex: reject raw controls before URL parsing strips them.
    /[\\?#\u0000-\u001f\u007f]|%2f|%5c/i.test(value)
  ) {
    throw new TypeError('previewPrefix must be an absolute pathname without encoded separators');
  }
  // Append before URL parsing so a literal trailing space becomes %20, not trimmed.
  const path = new URL(value.endsWith('/') ? value : `${value}/`, 'http://localhost').pathname;
  if (path.startsWith('//')) throw new TypeError('previewPrefix must have one leading slash');
  return path;
}

/** Same captures as PREVIEW_PREFIX_RE; safe to transport into generated WebSocket code. */
export function previewPrefixPattern(prefix: string = DEFAULT_PREVIEW_PREFIX): RegExp {
  const normalized = normalizePreviewPrefix(prefix);
  if (normalized === DEFAULT_PREVIEW_PREFIX) return PREVIEW_PREFIX_RE;
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped}(\\d+)(/.*)?$`);
}

/** Preserve existing decimal-port semantics; admission belongs to the port owner. */
export function buildPreviewPath(port: number, prefix: string = DEFAULT_PREVIEW_PREFIX): string {
  return `${normalizePreviewPrefix(prefix)}${port}/`;
}

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
 * Parse a pathname against {@link previewPrefixPattern}. Returns `null` for a
 * non-preview path; otherwise `port` (decimal int) and `rest` after the prefix.
 * `rest` is `/` for the bare `/preview/<port>` form, matching what the SW needs
 * to synthesise an upstream URL.
 */
export function parsePreviewPath(
  path: string,
  prefix: string = DEFAULT_PREVIEW_PREFIX,
): { port: number; rest: string } | null {
  const m = previewPrefixPattern(prefix).exec(path);
  if (!m) return null;
  const port = Number.parseInt(m[1]!, 10);
  const rest = m[2] ?? '/';
  return { port, rest };
}
