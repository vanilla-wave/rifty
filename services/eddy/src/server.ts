/**
 * Eddy HTTP server (ADR-0182 §1): POST a dep-set, get one `EddyBundleV1` tar
 * stream (or a typed JSON decline). The bundle carries the as-of stamp in
 * `x-eddy-*` headers.
 *
 * `GET /bundle/<closureHash>` serves the same bytes content-addressed from the
 * immutable tier with `Cache-Control: immutable` — a shared/edge CDN (and the
 * browser HTTP cache) can hold them forever. A miss (LRU eviction, restart) is
 * a 404 `no-store`; the client falls back to POST, which re-seeds the tier.
 * Caching itself is the in-process `EddyCache` LRU (`cache.ts`) — bounded,
 * per-process.
 */
import { type IncomingMessage, type ServerResponse, createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { EDDY_STORE_DURABLE_HEADER } from '@riftydev/npm-client';
import type { EddyBundleManifestV1, Fetcher } from '@riftydev/npm-client';
import type { BundleStore } from './bundle-store.ts';
import { EddyCache } from './cache.ts';
import type { EddyResolveRequest } from './resolver.ts';

export interface EddyServerOptions {
  /** Upstream registry base URL eddy resolves against. */
  registryBaseUrl: string;
  /** Injectable fetch (tests pass a fixture registry; prod uses Node fetch). */
  fetch?: Fetcher;
  /** Mutable-tier TTL seconds (default 1800; 0 = always recompute). */
  ttlSeconds?: number;
  maxEntries?: number;
  /** Shared packument cache TTL seconds (ADR-0194 §1; default 300, 0 = off). */
  packumentTtlSeconds?: number;
  /** Shared tarball cache byte cap (ADR-0194 §2). */
  tarballCacheMaxBytes?: number;
  /** Immutable bundle tier (ADR-0194 §4). Default: byte-bounded memory LRU. */
  store?: BundleStore;
  /** Injectable resolution timestamp. */
  now?: () => string;
}

/** Promisified wrapper over `node:http.Server` for ergonomic listen/close. */
export interface EddyServer {
  readonly raw: Server;
  listen(port: number, host?: string): Promise<void>;
  address(): AddressInfo | string | null;
  close(): Promise<void>;
}

const MAX_BODY_BYTES = 1_000_000;

export function createEddyServer(opts: EddyServerOptions): EddyServer {
  const cache = new EddyCache({
    resolver: { registryBaseUrl: opts.registryBaseUrl, fetch: opts.fetch, now: opts.now },
    ttlSeconds: opts.ttlSeconds,
    maxEntries: opts.maxEntries,
    packumentTtlSeconds: opts.packumentTtlSeconds,
    tarballCacheMaxBytes: opts.tarballCacheMaxBytes,
    store: opts.store,
  });
  const server = createServer((req, res) => {
    void handle(req, res, cache);
  });
  return {
    raw: server,
    // Rejects on a listen failure (EADDRINUSE, EACCES) so the CLI can exit
    // nonzero with the real error instead of an uncaught 'error' event.
    listen: (port, host = '127.0.0.1') =>
      new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          server.removeListener('error', reject);
          resolve();
        });
      }),
    address: () => server.address(),
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}

async function handle(req: IncomingMessage, res: ServerResponse, cache: EddyCache): Promise<void> {
  if (req.method === 'OPTIONS') {
    // CORS preflight. The current client sends a CORS-simple POST (text/plain
    // body, no preflight); this answers already-deployed older clients that
    // still POST application/json. Handled before the 405 method gate.
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }
  if (req.method === 'GET' || req.method === 'HEAD') {
    // HEAD rides the same branch (RFC 9110: identical to GET minus the body —
    // node suppresses body writes for HEAD): the route is CDN-fronted, and
    // edge health checks / `curl -I` smoke tests probe it with HEAD.
    // `(.+)`, not `([^/]+)`: a closure hash is standard base64 and may carry
    // RAW `/` when a proxy/raw client forwards it decoded — the shape gate
    // below is the validator; the route must not 405 a valid hash first.
    const match = /^\/bundle\/(.+)$/.exec(req.url ?? '');
    if (!match) {
      sendJson(
        res,
        405,
        { error: 'method not allowed — POST a dep-set as JSON, or GET /bundle/<closureHash>' },
        // RFC 9110: 405 MUST advertise the target resource's methods. OPTIONS is
        // handled (CORS preflight above) so it belongs here too — same set the
        // CORS `access-control-allow-methods` advertises.
        { allow: 'GET, HEAD, POST, OPTIONS' },
      );
      return;
    }
    // The closure hash is `sha256-<base64>` — base64 carries `/`+`=`, so the
    // path segment arrives percent-encoded.
    let closureHash: string;
    try {
      closureHash = decodeURIComponent(match[1] as string);
    } catch {
      sendJson(
        res,
        400,
        { error: 'malformed percent-encoding in bundle path' },
        { 'cache-control': 'no-store' },
      );
      return;
    }
    // Shape gate BEFORE the store: the hash becomes an OBJECT KEY (an S3 path
    // segment) — junk like `.`/`..` would URL-normalize into non-bundle bucket
    // paths. Anything that is not `sha256-<base64>` is a 400, no-store (junk
    // must never pin at the CDN either).
    if (!/^sha256-[A-Za-z0-9+/]+={0,2}$/.test(closureHash)) {
      sendJson(
        res,
        400,
        { error: 'malformed closure hash — expected sha256-<base64>' },
        { 'cache-control': 'no-store' },
      );
      return;
    }
    let hit: Awaited<ReturnType<EddyCache['getBundle']>>;
    try {
      hit = await cache.getBundle(closureHash);
    } catch (err) {
      // An S3-backed store can fail at runtime (bucket outage) — answer 500,
      // never leave an unhandled rejection to kill the process (ADR-0194).
      // no-store: this route is CDN-fronted; an intermediary must never pin a
      // transient bucket failure over an immutable hash.
      sendJson(
        res,
        500,
        { error: err instanceof Error ? err.message : String(err) },
        { 'cache-control': 'no-store' },
      );
      return;
    }
    if (!hit) {
      // no-store: a shared cache must never pin a miss — the next POST may
      // re-seed this very hash.
      sendJson(res, 404, { error: 'unknown bundle hash' }, { 'cache-control': 'no-store' });
      return;
    }
    res.writeHead(200, {
      ...bundleHeaders(hit.manifest, CACHE_CONTROL_IMMUTABLE, true),
      // Explicit for HEAD (node suppresses the body, so nothing else sets it).
      'content-length': String(hit.bytes.byteLength),
    });
    res.end(req.method === 'HEAD' ? undefined : Buffer.from(hit.bytes));
    return;
  }
  if (req.method !== 'POST') {
    sendJson(
      res,
      405,
      { error: 'method not allowed — POST a dep-set as JSON, or GET /bundle/<closureHash>' },
      // RFC 9110: 405 MUST advertise the allowed methods; OPTIONS is handled
      // (CORS preflight) so it is included, matching `corsHeaders()`.
      { allow: 'GET, HEAD, POST, OPTIONS' },
    );
    return;
  }
  let body: string;
  try {
    body = await readBody(req);
  } catch (err) {
    const statusCode = (err as { statusCode?: number }).statusCode;
    const status = typeof statusCode === 'number' ? statusCode : 400;
    sendJson(res, status, { error: err instanceof Error ? err.message : 'failed to read body' });
    // Do NOT destroy the socket. `readBody` keeps draining (discarding) the
    // still-arriving upload, so the client finishes writing and reads the 4xx
    // cleanly. Destroying mid-upload tore the socket — ECONNRESET if before the
    // reply, EPIPE (client still writing) if after. Memory stays bounded because
    // `readBody` discards past the cap; bandwidth of an oversize body is the
    // trade for a reliable reply (eddy sits behind a proxy with its own limits).
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    sendJson(res, 400, { error: 'malformed JSON body' });
    return;
  }
  const request = parseRequest(parsed);
  if ('error' in request) {
    // Loud 4xx, never a filtered request: silently dropping malformed dep
    // fields used to resolve a happy-path bundle for an EMPTY/partial closure
    // — the wrong answer for the caller's actual intent.
    sendJson(res, 400, { error: request.error });
    return;
  }

  let result: Awaited<ReturnType<EddyCache['resolve']>>;
  try {
    result = await cache.resolve(request.req);
  } catch (err) {
    sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    return;
  }

  if (result.kind === 'unsupported') {
    sendJson(res, 422, { kind: 'unsupported', feature: result.feature, message: result.message });
    return;
  }
  // no-store: a POST response depends on the BODY — a cache that keys on the
  // URL (some CDNs can be configured to cache POST) would serve one dep-set's
  // bundle for another. Only the content-addressed GET is immutable.
  res.writeHead(200, bundleHeaders(result.manifest, 'no-store', result.storeDurable === true));
  res.end(Buffer.from(result.bytes));
}

const CACHE_CONTROL_IMMUTABLE = 'public, max-age=31536000, immutable';

/** 200-bundle headers, shared by the POST resolve and the GET-by-hash route —
 * only the cache policy differs: `immutable` is load-bearing on the GET (a
 * CDN/browser cache holds the content-addressed bytes forever) and WRONG on
 * the body-dependent POST (`no-store`). */
function bundleHeaders(
  manifest: EddyBundleManifestV1,
  cacheControl: string,
  storeDurable: boolean,
): Record<string, string> {
  return {
    'content-type': 'application/x-tar',
    'cache-control': cacheControl,
    'x-eddy-resolved-at': manifest.asOf.resolvedAt,
    'x-eddy-closure-hash': manifest.asOf.closureHash,
    'x-eddy-npm-client-version': manifest.npmClientVersion,
    [EDDY_STORE_DURABLE_HEADER]: storeDurable ? '1' : '0',
    ...corsHeaders(),
  };
}

const REQUEST_DEP_FIELDS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'overrides',
] as const;

/**
 * Validate the POST body LOUDLY (fidelity: bad input declines, never a happy
 * path for the wrong closure). The old parser silently FILTERED junk — a
 * malformed `dependencies` (string, array, nested objects à la npm aliases)
 * collapsed into an empty/partial request that resolved successfully. Every
 * present field must be an object of string ranges — the same shape the
 * client's own package.json reader enforces with `NotImplementedError`s.
 */
function parseRequest(parsed: unknown): { req: EddyResolveRequest } | { error: string } {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { error: 'body must be a JSON object of dependency maps' };
  }
  const obj = parsed as Record<string, unknown>;
  const req: EddyResolveRequest = {};
  for (const field of REQUEST_DEP_FIELDS) {
    const value = obj[field];
    if (value === undefined) continue;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { error: `${field} must be an object of string ranges` };
    }
    const out: Record<string, string> = {};
    for (const [name, range] of Object.entries(value as Record<string, unknown>)) {
      if (typeof range !== 'string') {
        return { error: `${field}[${JSON.stringify(name)}] must be a string range` };
      }
      out[name] = range;
    }
    if (Object.keys(out).length > 0) req[field] = out;
  }
  if (obj.prefer !== undefined) {
    if (obj.prefer !== 'online' && obj.prefer !== 'cached') {
      return { error: "prefer must be 'online' or 'cached'" };
    }
    req.prefer = obj.prefer;
  }
  return { req };
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (chunk: Buffer) => {
      if (tooLarge) return; // over the cap: discard the rest, don't buffer (memory-bounded)
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        tooLarge = true;
        // Reject WITHOUT destroying the socket — `handle` must still write the
        // 413. `req.destroy()` here (the old bug) reset the connection before
        // the response flushed, so the client got ECONNRESET, not a 4xx.
        reject(Object.assign(new Error('request body too large'), { statusCode: 413 }));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  extraHeaders?: Record<string, string>,
): void {
  res.writeHead(status, {
    'content-type': 'application/json',
    // Every JSON reply is an error/decline/miss for a body- or state-dependent
    // request — a URL-keyed proxy/CDN (some cache POST, and this service sits
    // behind one) must never pin any of them.
    'cache-control': 'no-store',
    ...corsHeaders(),
    ...extraHeaders,
  });
  res.end(JSON.stringify(body));
}

/**
 * Permissive CORS + cross-origin-resource-policy so the browser client (a
 * COEP-isolated Worker on a DIFFERENT origin, e.g. play.rifty.dev) can read the
 * bundle. The client's POST is CORS-simple (text/plain body) and the GET has no
 * custom headers, so neither preflights; OPTIONS stays answered for older
 * clients. `x-eddy-*` are exposed so a client may read the as-of stamp.
 * ADR-0182.
 */
function corsHeaders(): Record<string, string> {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, HEAD, POST, OPTIONS',
    // Kept although the current client sends a CORS-simple POST (no
    // content-type header, no preflight): an already-deployed older client
    // still preflights with `content-type`.
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
    'access-control-expose-headers':
      'x-eddy-resolved-at, x-eddy-closure-hash, x-eddy-npm-client-version, x-eddy-store-durable',
    'cross-origin-resource-policy': 'cross-origin',
  };
}
