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
    expect(res.headers.get('cache-control')).toMatch(/immutable/);

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

  it('GET / → 405 method not allowed', async () => {
    const res = await fetch(baseUrl, { method: 'GET' });
    expect(res.status).toBe(405);
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
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
    const got = new Uint8Array(await res.arrayBuffer());
    expect([...got]).toEqual([...posted]);
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
        has: async () => false,
        put: async () => {},
      },
    });
    await broken.listen(0);
    const url = `http://127.0.0.1:${(broken.address() as AddressInfo).port}`;
    try {
      const res = await fetch(`${url}/bundle/sha256-x`);
      expect(res.status).toBe(500);
      expect(res.headers.get('content-type')).toMatch(/application\/json/);
      const again = await fetch(`${url}/bundle/sha256-x`);
      expect(again.status).toBe(500); // still answering — no crash
    } finally {
      await broken.close();
    }
  });
});
