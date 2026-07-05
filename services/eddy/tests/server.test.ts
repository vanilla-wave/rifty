import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { unpackEddyBundle } from '@riftydev/npm-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  LOCAL_REGISTRY_BASE_URL,
  makeLocalFetcher,
} from '../../../tests/integration/fixtures/local-registry.ts';
import { type EddyServer, createEddyServer } from '../src/server.ts';

let server: EddyServer;
let baseUrl: string;

beforeEach(async () => {
  server = createEddyServer({
    registryBaseUrl: LOCAL_REGISTRY_BASE_URL,
    fetch: makeLocalFetcher().fetch,
  });
  await server.listen(0);
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterEach(async () => {
  await server.close();
});

describe('eddy HTTP server', () => {
  it('POST dep-set → 200 streamed EddyBundleV1 with as-of + immutable headers', async () => {
    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dependencies: { debug: '^4.4.1' } }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/x-tar/);
    expect(res.headers.get('x-eddy-resolved-at')).toBeTruthy();
    expect(res.headers.get('x-eddy-closure-hash')).toBeTruthy();
    expect(res.headers.get('x-eddy-npm-client-version')).toBeTruthy();
    expect(res.headers.get('x-eddy-store-durable')).toBe('1');
    // no-store: the response depends on the BODY — a URL-keyed cache (some
    // CDNs can cache POST) would serve one dep-set's bundle for another. Only
    // the content-addressed GET-by-hash is immutable.
    expect(res.headers.get('cache-control')).toBe('no-store');

    const bytes = new Uint8Array(await res.arrayBuffer());
    const { manifest, lockfileText } = unpackEddyBundle(bytes);
    expect(manifest.format).toBe('EddyBundleV1');
    expect(JSON.parse(lockfileText).packages['node_modules/debug']).toBeTruthy();
  });

  it('POST a non-registry (file:) dep → 422 typed unsupported decline (JSON)', async () => {
    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dependencies: { x: 'file:./y' } }),
    });
    expect(res.status).toBe(422);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    const body = (await res.json()) as { kind: string; feature: string };
    expect(body.kind).toBe('unsupported');
    expect(body.feature).toMatch(/file/);
  });

  it('GET / → 405 method not allowed, with an Allow header including OPTIONS (RFC 9110)', async () => {
    const res = await fetch(baseUrl, { method: 'GET' });
    expect(res.status).toBe(405);
    // OPTIONS is handled (CORS preflight), so Allow advertises it too — the same
    // set as `access-control-allow-methods`.
    expect(res.headers.get('allow')).toBe('GET, HEAD, POST, OPTIONS');
    await res.body?.cancel();
  });

  it('an unsupported method (PUT) → 405 with an Allow header including OPTIONS', async () => {
    const res = await fetch(baseUrl, { method: 'PUT' });
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('GET, HEAD, POST, OPTIONS');
    await res.body?.cancel();
  });

  // CDN tier: the closure hash names an immutable artifact, so a GET by hash is
  // safe for a shared/edge cache to hold forever (unlike the POST, which shared
  // caches never store). The client falls back to POST on a miss.
  it('GET /bundle/<closureHash> → 200 byte-identical bundle with immutable + CORS headers', async () => {
    const post = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dependencies: { debug: '^4.4.1' } }),
    });
    expect(post.status).toBe(200);
    const hash = post.headers.get('x-eddy-closure-hash') as string;
    const posted = new Uint8Array(await post.arrayBuffer());

    const res = await fetch(`${baseUrl}/bundle/${encodeURIComponent(hash)}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/x-tar/);
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(res.headers.get('x-eddy-closure-hash')).toBe(hash);
    expect(res.headers.get('x-eddy-resolved-at')).toBeTruthy();
    expect(res.headers.get('x-eddy-store-durable')).toBe('1');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
    const got = new Uint8Array(await res.arrayBuffer());
    expect([...got]).toEqual([...posted]);
  });

  it('HEAD /bundle/<hash> → 200 with the GET headers and NO body (edge health checks, curl -I smoke) — round 13', async () => {
    const post = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dependencies: { debug: '^4.4.1' } }),
    });
    const hash = post.headers.get('x-eddy-closure-hash') as string;
    const bytes = new Uint8Array(await post.arrayBuffer());

    const head = await fetch(`${baseUrl}/bundle/${encodeURIComponent(hash)}`, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(head.headers.get('x-eddy-closure-hash')).toBe(hash);
    expect(Number(head.headers.get('content-length'))).toBe(bytes.byteLength);
    expect((await head.arrayBuffer()).byteLength).toBe(0); // no body on HEAD

    const miss = await fetch(`${baseUrl}/bundle/${encodeURIComponent('sha256-nope')}`, {
      method: 'HEAD',
    });
    expect(miss.status).toBe(404);
    expect(miss.headers.get('cache-control')).toBe('no-store');
  });

  it('GET /bundle/<unknown> → 404 JSON with no-store (a CDN must never pin a miss)', async () => {
    const res = await fetch(`${baseUrl}/bundle/${encodeURIComponent('sha256-nope')}`);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    const body = (await res.json()) as { error?: string };
    expect(body.error).toMatch(/unknown bundle/);
  });

  it('a RAW (un-encoded) base64 slash inside the hash reaches the validator — 404 miss, never a 405 (round 15)', async () => {
    // Normal clients percent-encode; a proxy/raw client may forward the
    // decoded form. The old one-segment route regex 405'd it before the
    // shape gate ever saw a perfectly valid hash.
    const res = await fetch(`${baseUrl}/bundle/sha256-ab/cd+ef=`);
    expect(res.status).toBe(404); // valid shape → store miss, not a routing reject
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('GET /bundle/<junk> that is not a sha256-<base64> hash → 400 no-store, never reaches the store', async () => {
    for (const junk of ['foo', 'sha256-%20', 'md5-abcd']) {
      const res = await fetch(`${baseUrl}/bundle/${junk}`);
      expect(res.status).toBe(400);
      expect(res.headers.get('cache-control')).toBe('no-store');
      const body = (await res.json()) as { error?: string };
      expect(body.error).toMatch(/malformed closure hash/);
    }
  });

  it('a RAW dot-segment bundle path (proxy/raw client) → 400 no-store, never an object-key traversal', async () => {
    // The hash becomes an S3 object-key path segment: `.`/`..` URL-normalize
    // into non-bundle bucket paths at the store. fetch normalizes them away
    // client-side (incl. `%2E%2E` — WHATWG dot-segment rules), so exercise
    // the route the way a raw client/proxy would: node:http sends the path
    // VERBATIM.
    const addr = server.address() as AddressInfo;
    const rawGet = (path: string) =>
      new Promise<{ status: number; cacheControl: string | undefined; body: string }>(
        (resolve, reject) => {
          const req = httpRequest(
            { hostname: '127.0.0.1', port: addr.port, path, method: 'GET' },
            (res) => {
              let data = '';
              res.on('data', (c: Buffer) => {
                data += c.toString('utf8');
              });
              res.on('end', () =>
                resolve({
                  status: res.statusCode ?? 0,
                  cacheControl: res.headers['cache-control'],
                  body: data,
                }),
              );
            },
          );
          req.on('error', reject);
          req.end();
        },
      );
    for (const path of ['/bundle/..', '/bundle/.', '/bundle/%2E%2E']) {
      const res = await rawGet(path);
      expect(res.status).toBe(400);
      expect(res.cacheControl).toBe('no-store');
      expect(res.body).toMatch(/malformed closure hash/);
    }
  });

  it('GET /bundle/<bad-percent-encoding> → 400 no-store, not a 500', async () => {
    const res = await fetch(`${baseUrl}/bundle/%zz`);
    expect(res.status).toBe(400);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = (await res.json()) as { error?: string };
    expect(body.error).toMatch(/percent-encoding/);
  });

  it('OPTIONS advertises GET alongside POST', async () => {
    const res = await fetch(baseUrl, {
      method: 'OPTIONS',
      headers: { origin: 'https://play.rifty.dev', 'access-control-request-method': 'GET' },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-methods')).toMatch(/GET/);
  });

  // The playground fetches eddy CROSS-ORIGIN from a COEP-isolated Worker; the
  // JSON POST is preflighted. Without an OPTIONS handler + permissive CORS the
  // browser blocks the request and the fast path never runs (ADR-0182).
  it('OPTIONS preflight → 204 with permissive CORS', async () => {
    const res = await fetch(baseUrl, {
      method: 'OPTIONS',
      headers: {
        origin: 'https://play.rifty.dev',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('access-control-allow-methods')).toMatch(/POST/);
    expect(res.headers.get('access-control-allow-headers')).toMatch(/content-type/i);
  });

  it('200 bundle carries CORS + CORP so a cross-origin COEP page can read it', async () => {
    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dependencies: { debug: '^4.4.1' } }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
    expect(res.headers.get('access-control-expose-headers')).toMatch(/x-eddy-closure-hash/);
    expect(res.headers.get('access-control-expose-headers')).toMatch(/x-eddy-store-durable/);
  });

  it('422 decline is also CORS-readable cross-origin', async () => {
    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dependencies: { x: 'file:./y' } }),
    });
    expect(res.status).toBe(422);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('POST body over the size limit → 4xx JSON, not a torn socket', async () => {
    // > MAX_BODY_BYTES (1 MB). The server must REPLY (4xx JSON) before it stops
    // the upload — the pre-fix code called `req.destroy()` mid-stream, tearing
    // the shared socket before the response flushed, so the client saw
    // ECONNRESET instead of a readable error (reproduced on Node 24).
    const huge = 'x'.repeat(1_200_000);
    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dependencies: { debug: huge } }),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toMatch(/too large/);
  });

  it('POST malformed JSON → 400', async () => {
    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });
    expect(res.status).toBe(400);
  });

  it('POST error/decline responses are no-store — body-dependent replies must never pin in a URL-keyed cache (round 16)', async () => {
    const badJson = await fetch(baseUrl, { method: 'POST', body: '{not json' });
    expect(badJson.status).toBe(400);
    expect(badJson.headers.get('cache-control')).toBe('no-store');

    const badShape = await fetch(baseUrl, {
      method: 'POST',
      body: JSON.stringify({ dependencies: 'junk' }),
    });
    expect(badShape.status).toBe(400);
    expect(badShape.headers.get('cache-control')).toBe('no-store');

    const decline = await fetch(baseUrl, {
      method: 'POST',
      body: JSON.stringify({ dependencies: { x: 'file:./y' } }),
    });
    expect(decline.status).toBe(422);
    expect(decline.headers.get('cache-control')).toBe('no-store');
  });

  it('POST with MALFORMED dependency fields → 400, never a silently-filtered happy path (round 14)', async () => {
    // The old parser dropped junk entries and resolved the REMAINDER — a
    // malformed request got a successful bundle for an empty/partial closure.
    const bad: Array<{ body: unknown; want: RegExp }> = [
      { body: [1, 2], want: /JSON object/ },
      { body: 'debug@^4', want: /JSON object/ },
      { body: { dependencies: 'debug@^4' }, want: /dependencies must be an object/ },
      { body: { dependencies: ['debug'] }, want: /dependencies must be an object/ },
      {
        body: { dependencies: { debug: { version: '^4.4.1' } } },
        want: /dependencies\["debug"\] must be a string/,
      },
      { body: { devDependencies: { a: 1 } }, want: /devDependencies\["a"\] must be a string/ },
      { body: { overrides: null, dependencies: {} }, want: /overrides must be an object/ },
      { body: { dependencies: { debug: '^4.4.1' }, prefer: 'fresh' }, want: /prefer must be/ },
    ];
    for (const { body, want } of bad) {
      const res = await fetch(baseUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(400);
      const parsed = (await res.json()) as { error?: string };
      expect(parsed.error).toMatch(want);
    }
  });

  it('listen on an already-bound port REJECTS (EADDRINUSE) — the bin exits nonzero, not an uncaught error event', async () => {
    const addr = server.address() as AddressInfo;
    const second = createEddyServer({
      registryBaseUrl: LOCAL_REGISTRY_BASE_URL,
      fetch: makeLocalFetcher().fetch,
    });
    await expect(second.listen(addr.port)).rejects.toThrow(/EADDRINUSE/);
  });

  it('GET /bundle/<hash> with a throwing store → 500 JSON, server stays alive (ADR-0194)', async () => {
    // An S3-backed store can fail at runtime (bucket outage). The GET route
    // must answer 500 — not leave an unhandled rejection that kills the
    // process — and the next request must work.
    const broken = createEddyServer({
      registryBaseUrl: LOCAL_REGISTRY_BASE_URL,
      fetch: makeLocalFetcher().fetch,
      store: {
        get: async () => {
          throw new Error('bucket down');
        },
        put: async () => {},
      },
    });
    await broken.listen(0);
    const url = `http://127.0.0.1:${(broken.address() as AddressInfo).port}`;
    try {
      const res = await fetch(`${url}/bundle/sha256-x`);
      expect(res.status).toBe(500);
      expect(res.headers.get('content-type')).toMatch(/application\/json/);
      // no-store: the route is CDN-fronted — a transient bucket failure must
      // never be pinned by an intermediary over an immutable hash.
      expect(res.headers.get('cache-control')).toBe('no-store');
      const again = await fetch(`${url}/bundle/sha256-x`);
      expect(again.status).toBe(500); // still answering — no crash
    } finally {
      await broken.close();
    }
  });
});
