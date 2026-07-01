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

  it('GET → 405 method not allowed', async () => {
    const res = await fetch(baseUrl, { method: 'GET' });
    expect(res.status).toBe(405);
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
});
