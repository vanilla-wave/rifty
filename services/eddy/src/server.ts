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
    listen: (port, host = '127.0.0.1') =>
      new Promise<void>((resolve) => server.listen(port, host, () => resolve())),
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
  if (req.method === 'GET') {
    const match = /^\/bundle\/([^/]+)$/.exec(req.url ?? '');
    if (!match) {
      sendJson(res, 405, {
        error: 'method not allowed — POST a dep-set as JSON, or GET /bundle/<closureHash>',
      });
      return;
    }
    // The closure hash is `sha256-<base64>` — base64 carries `/`+`=`, so the
    // path segment arrives percent-encoded.
    let hit: Awaited<ReturnType<EddyCache['getBundle']>>;
    try {
      hit = await cache.getBundle(decodeURIComponent(match[1] as string));
    } catch (err) {
      // An S3-backed store can fail at runtime (bucket outage) — answer 500,
      // never leave an unhandled rejection to kill the process (ADR-0194).
      sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
      return;
    }
    if (!hit) {
      // no-store: a shared cache must never pin a miss — the next POST may
      // re-seed this very hash.
      sendJson(res, 404, { error: 'unknown bundle hash' }, { 'cache-control': 'no-store' });
      return;
    }
    res.writeHead(200, bundleHeaders(hit.manifest));
    res.end(Buffer.from(hit.bytes));
    return;
  }
  if (req.method !== 'POST') {
    sendJson(res, 405, {
      error: 'method not allowed — POST a dep-set as JSON, or GET /bundle/<closureHash>',
    });
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

  let result: Awaited<ReturnType<EddyCache['resolve']>>;
  try {
    result = await cache.resolve(toRequest(parsed));
  } catch (err) {
    sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    return;
  }

  if (result.kind === 'unsupported') {
    sendJson(res, 422, { kind: 'unsupported', feature: result.feature, message: result.message });
    return;
  }
  res.writeHead(200, bundleHeaders(result.manifest));
  res.end(Buffer.from(result.bytes));
}

/** 200-bundle headers, shared by the POST resolve and the GET-by-hash route.
 * `immutable` is inert on the POST (shared caches don't store POST) but load-
 * bearing on the GET: a CDN/browser cache holds the content-addressed bytes
 * forever. */
function bundleHeaders(manifest: EddyBundleManifestV1): Record<string, string> {
  return {
    'content-type': 'application/x-tar',
    'cache-control': 'public, max-age=31536000, immutable',
    'x-eddy-resolved-at': manifest.asOf.resolvedAt,
    'x-eddy-closure-hash': manifest.asOf.closureHash,
    'x-eddy-npm-client-version': manifest.npmClientVersion,
    ...corsHeaders(),
  };
}

function pickRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function toRequest(parsed: unknown): EddyResolveRequest {
  const obj = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>;
  const req: EddyResolveRequest = {};
  const deps = pickRecord(obj.dependencies);
  const dev = pickRecord(obj.devDependencies);
  const opt = pickRecord(obj.optionalDependencies);
  const overrides = pickRecord(obj.overrides);
  if (deps) req.dependencies = deps;
  if (dev) req.devDependencies = dev;
  if (opt) req.optionalDependencies = opt;
  if (overrides) req.overrides = overrides;
  if (obj.prefer === 'online' || obj.prefer === 'cached') req.prefer = obj.prefer;
  return req;
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
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    // Kept although the current client sends a CORS-simple POST (no
    // content-type header, no preflight): an already-deployed older client
    // still preflights with `content-type`.
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
    'access-control-expose-headers':
      'x-eddy-resolved-at, x-eddy-closure-hash, x-eddy-npm-client-version',
    'cross-origin-resource-policy': 'cross-origin',
  };
}
