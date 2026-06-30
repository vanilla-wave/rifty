/**
 * Eddy HTTP server (ADR-0182 §1): POST a dep-set, get one `EddyBundleV1` tar
 * stream (or a typed JSON decline). The bundle carries the as-of stamp in
 * `x-eddy-*` headers + `Cache-Control: immutable` so the CDN holds the
 * content-addressed artifact (ADR-0163 streaming-proxy infra precedent).
 */
import { type IncomingMessage, type ServerResponse, createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Fetcher } from '@riftydev/npm-client';
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
    // CORS preflight: the JSON POST is non-simple, so a cross-origin browser
    // client sends OPTIONS first. Answer it before the 405 method gate.
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'method not allowed — POST a dep-set as JSON' });
    return;
  }
  let body: string;
  try {
    body = await readBody(req);
  } catch (err) {
    sendJson(res, 400, { error: err instanceof Error ? err.message : 'failed to read body' });
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
  res.writeHead(200, {
    'content-type': 'application/x-tar',
    'cache-control': 'public, max-age=31536000, immutable',
    'x-eddy-resolved-at': result.manifest.asOf.resolvedAt,
    'x-eddy-closure-hash': result.manifest.asOf.closureHash,
    'x-eddy-npm-client-version': result.manifest.npmClientVersion,
    ...corsHeaders(),
  });
  res.end(Buffer.from(result.bytes));
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
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json', ...corsHeaders() });
  res.end(JSON.stringify(body));
}

/**
 * Permissive CORS + cross-origin-resource-policy so the browser client (a
 * COEP-isolated Worker on a DIFFERENT origin, e.g. play.rifty.dev) can preflight
 * and read the bundle. The JSON POST is non-simple, so the browser sends an
 * OPTIONS preflight first (handled in `handle`). `x-eddy-*` are exposed so a
 * client may read the as-of stamp. ADR-0182.
 */
function corsHeaders(): Record<string, string> {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
    'access-control-expose-headers':
      'x-eddy-resolved-at, x-eddy-closure-hash, x-eddy-npm-client-version',
    'cross-origin-resource-policy': 'cross-origin',
  };
}
