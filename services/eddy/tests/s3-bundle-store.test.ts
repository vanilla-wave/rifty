/**
 * S3BundleStore + hand-rolled SigV4 (ADR-0194 §4). The signer is verified
 * against the PUBLISHED AWS Signature V4 example vectors (fixed keys, date,
 * bucket — from the S3 "Authenticating Requests: Using the Authorization
 * Header" documentation), so a signing regression is a test failure, not a
 * mystery 403 in prod. The store is exercised against a real local HTTP
 * server speaking the S3 path-style subset (PUT/GET/HEAD on /<bucket>/<key>).
 */
import { createHash } from 'node:crypto';
import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { packEddyBundle } from '@riftydev/npm-client';
import type { EddyBundleManifestV1 } from '@riftydev/npm-client';
import { afterEach, describe, expect, it } from 'vitest';
import { S3BundleStore } from '../src/s3-bundle-store.ts';
import { signV4 } from '../src/sigv4.ts';

describe('signV4 — AWS published example vectors', () => {
  // S3 docs, "Example: Object upload" — PUT test$file.text to examplebucket,
  // payload "Welcome to Amazon S3.", 20130524, us-east-1.
  it('reproduces the documented PUT signature', () => {
    const authorization = signV4({
      method: 'PUT',
      path: '/test%24file.text',
      query: '',
      headers: {
        date: 'Fri, 24 May 2013 00:00:00 GMT',
        host: 'examplebucket.s3.amazonaws.com',
        'x-amz-content-sha256': '44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072',
        'x-amz-date': '20130524T000000Z',
        'x-amz-storage-class': 'REDUCED_REDUNDANCY',
      },
      payloadSha256Hex: '44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      region: 'us-east-1',
      service: 's3',
      amzDate: '20130524T000000Z',
    });
    expect(authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request,' +
        'SignedHeaders=date;host;x-amz-content-sha256;x-amz-date;x-amz-storage-class,' +
        'Signature=98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd',
    );
  });

  // Same docs, "Example: Object download" — GET test.txt with a Range header.
  it('reproduces the documented GET signature', () => {
    const authorization = signV4({
      method: 'GET',
      path: '/test.txt',
      query: '',
      headers: {
        host: 'examplebucket.s3.amazonaws.com',
        range: 'bytes=0-9',
        'x-amz-content-sha256': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        'x-amz-date': '20130524T000000Z',
      },
      payloadSha256Hex: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      region: 'us-east-1',
      service: 's3',
      amzDate: '20130524T000000Z',
    });
    expect(authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request,' +
        'SignedHeaders=host;range;x-amz-content-sha256;x-amz-date,' +
        'Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
    );
  });
});

// A closure hash exercising every base64 special: `/`, `+`, `=`.
const HASH = 'sha256-ab/cd+ef=';

const manifest: EddyBundleManifestV1 = {
  format: 'EddyBundleV1',
  npmClientVersion: '0.0.0',
  asOf: { resolvedAt: '2026-07-02T00:00:00Z', registry: 'packument:', closureHash: HASH },
  tarballs: [],
};
const bundleBytes = packEddyBundle({
  manifest,
  lockfileText: '{"lockfileVersion":3}',
  tarballs: [],
});

interface FakeS3 {
  url: string;
  server: Server;
  /** RAW request paths seen, with the method, in arrival order. */
  requests: Array<{
    method: string;
    path: string;
    headers: Record<string, string | string[] | undefined>;
  }>;
  objects: Map<string, Buffer>;
}

function startFakeS3(): Promise<FakeS3> {
  const requests: FakeS3['requests'] = [];
  const objects = new Map<string, Buffer>();
  // S3 ETag of a single-part PUT is the quoted hex MD5 of the body — returned on
  // PUT and echoed on GET/HEAD. `put`'s skip-identical/self-heal path keys on it.
  const etagOf = (body: Buffer): string => `"${createHash('md5').update(body).digest('hex')}"`;
  const server = createServer((req, res) => {
    const path = req.url ?? '';
    requests.push({ method: req.method ?? '', path, headers: req.headers });
    if (req.method === 'PUT') {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks);
        objects.set(path, body);
        res.writeHead(200, { etag: etagOf(body) });
        res.end();
      });
      return;
    }
    const body = objects.get(path);
    if (!body) {
      res.writeHead(404, { 'content-type': 'application/xml' });
      res.end(req.method === 'HEAD' ? undefined : '<Error><Code>NoSuchKey</Code></Error>');
      return;
    }
    res.writeHead(200, {
      'content-type': 'application/x-tar',
      'content-length': body.length,
      etag: etagOf(body),
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      resolve({ url: `http://127.0.0.1:${port}`, server, requests, objects });
    });
  });
}

let fake: FakeS3 | null = null;
afterEach(async () => {
  if (!fake) return;
  await new Promise<void>((resolve, reject) =>
    fake?.server.close((e) => (e ? reject(e) : resolve())),
  );
  fake = null;
});

function makeStore(url: string): S3BundleStore {
  return new S3BundleStore({
    endpoint: url,
    bucket: 'eddy-bundles',
    region: 'ru-central1',
    accessKeyId: 'test-access-key',
    secretAccessKey: 'test-secret-key',
  });
}

describe('S3BundleStore', () => {
  it('put→get round-trips through a real HTTP server; manifest recovered from the bundle bytes', async () => {
    fake = await startFakeS3();
    const store = makeStore(fake.url);
    expect(await store.get(HASH)).toBeNull();

    await store.put(HASH, { bytes: bundleBytes, manifest });
    const hit = await store.get(HASH);
    expect(hit).not.toBeNull();
    expect([...(hit?.bytes ?? [])]).toEqual([...bundleBytes]);
    expect(hit?.manifest.asOf.closureHash).toBe(HASH);
  });

  it('a second put of the SAME bytes skips the upload (ETag match) — no redundant re-upload on cold recompute', async () => {
    fake = await startFakeS3();
    const store = makeStore(fake.url);
    await store.put(HASH, { bytes: bundleBytes, manifest });
    await store.put(HASH, { bytes: bundleBytes, manifest });
    expect(fake.requests.filter((r) => r.method === 'PUT').length).toBe(1);
  });

  it('self-heals a corrupt/truncated object: get reads it as a miss, put overwrites the poisoned key', async () => {
    fake = await startFakeS3();
    const store = makeStore(fake.url);
    const key = `/eddy-bundles/bundle/${encodeURIComponent(HASH)}`;
    // A prior failed upload left garbage at the key.
    fake.objects.set(key, Buffer.from('truncated-garbage-not-a-tar'));
    expect(await store.get(HASH)).toBeNull(); // corrupt → miss

    await store.put(HASH, { bytes: bundleBytes, manifest });
    // ETag of the garbage ≠ MD5 of the valid bytes → the put re-seeds the key.
    expect(fake.requests.filter((r) => r.method === 'PUT').length).toBe(1);
    const hit = await store.get(HASH);
    expect([...(hit?.bytes ?? [])]).toEqual([...bundleBytes]);
  });

  it('rejects a valid bundle stored under the WRONG key (content-addressed invariant)', async () => {
    fake = await startFakeS3();
    const store = makeStore(fake.url);
    const key = `/eddy-bundles/bundle/${encodeURIComponent(HASH)}`;
    // A valid bundle whose closure is a DIFFERENT hash, mis-keyed at HASH.
    const otherManifest: EddyBundleManifestV1 = {
      ...manifest,
      asOf: { ...manifest.asOf, closureHash: 'sha256-different' },
    };
    const otherBytes = packEddyBundle({
      manifest: otherManifest,
      lockfileText: '{"lockfileVersion":3}',
      tarballs: [],
    });
    fake.objects.set(key, Buffer.from(otherBytes));
    expect(await store.get(HASH)).toBeNull(); // right shape, wrong hash → miss
  });

  it('addresses the object as /<bucket>/bundle/<percent-encoded hash> — the client bundleUrlFor shape', async () => {
    fake = await startFakeS3();
    const store = makeStore(fake.url);
    await store.put(HASH, { bytes: bundleBytes, manifest });
    const expectedPath = `/eddy-bundles/bundle/${encodeURIComponent(HASH)}`;
    expect(fake.requests.map((r) => `${r.method} ${r.path}`)).toContain(`PUT ${expectedPath}`);
    await store.get(HASH);
    expect(fake.requests.at(-1)).toMatchObject({ method: 'GET', path: expectedPath });
  });

  it('signs the PUT (SigV4 authorization + payload hash headers); GET/HEAD stay unsigned public reads', async () => {
    fake = await startFakeS3();
    const store = makeStore(fake.url);
    await store.put(HASH, { bytes: bundleBytes, manifest });
    const put = fake.requests.find((r) => r.method === 'PUT');
    expect(put?.headers.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=test-access-key\/\d{8}\/ru-central1\/s3\/aws4_request,SignedHeaders=[a-z0-9;-]+,Signature=[0-9a-f]{64}$/,
    );
    const expectedSha = createHash('sha256').update(bundleBytes).digest('hex');
    expect(put?.headers['x-amz-content-sha256']).toBe(expectedSha);

    // put emits an unsigned HEAD (skip-identical probe) before the signed PUT;
    // get is an unsigned GET. Only the PUT carries an Authorization header.
    await store.get(HASH);
    for (const r of fake.requests.filter((x) => x.method !== 'PUT')) {
      expect(r.headers.authorization).toBeUndefined();
    }
  });

  it('throws loudly on a rejected PUT (status + body) — the cache degrades, never silently unlinked', async () => {
    const server = createServer((_req, res) => {
      res.writeHead(403, { 'content-type': 'application/xml' });
      res.end('<Error><Code>AccessDenied</Code></Error>');
    });
    const url = await new Promise<string>((resolve) => {
      server.listen(0, '127.0.0.1', () =>
        resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`),
      );
    });
    try {
      const store = makeStore(url);
      await expect(store.put(HASH, { bytes: bundleBytes, manifest })).rejects.toThrow(
        /403.*AccessDenied/s,
      );
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      );
    }
  });
});
