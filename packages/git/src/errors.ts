/**
 * Transport + CORS boundary guards for the git network verbs, plus error
 * mapping. These make the browser ceiling LOUD: smart-HTTP (`http:`/`https:`) is
 * the only transport we can drive (no raw TCP → no ssh/git protocol), and a
 * cross-origin smart-HTTP target with no CORS proxy is unreachable from a
 * browser page. Gaps throw a real {@link NotImplementedError} — never a stub.
 */
import { NotImplementedError } from '@riftydev/io';

/**
 * Reject any non-smart-HTTP transport. `http:`/`https:` pass; `ssh:`/`git:`/etc.
 * throw `git.transport.<scheme>` since they need raw TCP/SSH we don't have in a
 * browser. scp-like syntax (`git@host:path` or `host:path` with no scheme) is
 * git shorthand for ssh → treated as `git.transport.ssh`.
 */
export function assertSupportedTransport(url: string): void {
  const scheme = transportScheme(url);
  if (scheme === 'http' || scheme === 'https') return;
  if (scheme === 'ssh') {
    throw new NotImplementedError('git.transport.ssh', 'browser ceiling: no raw TCP/SSH');
  }
  if (scheme === 'git') {
    throw new NotImplementedError('git.transport.git', 'native git:// protocol needs raw TCP');
  }
  throw new NotImplementedError(
    `git.transport.${scheme}`,
    'only smart-HTTP (http:/https:) is supported in the browser',
  );
}

/**
 * Classify a clone/fetch URL's transport. Real URL schemes resolve via
 * `new URL`; git's scp-like shorthand (`[user@]host:path`, NO `scheme://`, e.g.
 * `git@github.com:x/y.git`) maps to ssh — that's git's own convention.
 */
function transportScheme(url: string): string {
  if (!hasUrlScheme(url) && isScpLike(url)) return 'ssh';
  try {
    // `new URL` lowercases + keeps the trailing `:` on protocol → strip it.
    return new URL(url).protocol.replace(/:$/, '').toLowerCase();
  } catch {
    // Unparseable + no `scheme://` + not scp-like → no known transport.
    return 'unknown';
  }
}

/** True when `url` carries a real `scheme://` (vs scp-like shorthand). */
function hasUrlScheme(url: string): boolean {
  return /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(url);
}

/**
 * git scp-like shorthand: `[user@]host:path`, a `:` separating an authority from
 * a (non-`/`-leading) path, appearing before any `/`. Excludes a bare `:port`
 * (`host:1234`) — the char after `:` must be a non-digit path char.
 */
function isScpLike(url: string): boolean {
  return /^([^@/]+@)?[A-Za-z0-9._-]+:(?![/0-9])/.test(url);
}

/**
 * Browser-only proactive CORS guard. In a browser (`globalThis.location.origin`
 * present), a cross-origin smart-HTTP target with NO corsProxy will be blocked
 * by the same-origin policy → throw a directed error pointing at the proxy
 * env-config. In Node (no `location`) this is INERT so real-server integration
 * tests can drive actual cross-origin requests.
 */
export function assertCorsReachable(url: string, corsProxy: string): void {
  const loc = (globalThis as { location?: { origin?: string } }).location;
  if (!loc?.origin) return; // Node — inert, real requests proceed.
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return; // unparseable — let the transport guard / isomorphic-git surface it.
  }
  if (target.origin !== loc.origin && !corsProxy) {
    throw new NotImplementedError(
      'git.cors',
      'cross-origin git smart-HTTP needs a CORS proxy — set RIFTY_GIT_CORS_PROXY (browser same-origin ceiling)',
    );
  }
}

/**
 * Map an isomorphic-git network error to a directed message, then RETHROW —
 * never swallow. Known case: pushing from a shallow clone (unsupported) gets an
 * enriched message; everything else rethrows the original instance unchanged so
 * the underlying cause (status code, connection error) is preserved.
 */
export function mapGitNetworkError(err: unknown): never {
  if (isShallowPushError(err)) {
    throw new Error(
      'git push from a shallow clone is not supported — re-clone without `depth` (a full clone) before pushing',
      { cause: err },
    );
  }
  throw err;
}

/**
 * Detect isomorphic-git's shallow-push failure by message. The git protocol
 * surfaces this as a server-side "shallow update not allowed" wrapped in a
 * GitPushError/PushRejectedError; the message is the stable signal across both.
 */
function isShallowPushError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const { message } = err as { message?: unknown };
  return typeof message === 'string' && /shallow/i.test(message);
}
