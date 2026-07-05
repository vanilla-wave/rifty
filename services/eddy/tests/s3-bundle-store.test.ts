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
import { packEddyBundle, unpackEddyBundle } from '@riftydev/npm-client';
import type { EddyBundleManifestV1 } from '@riftydev/npm-client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  LOCAL_REGISTRY_BASE_URL,
  makeLocalFetcher,
} from '../../../tests/integration/fixtures/local-registry.ts';
import { resolveBundle } from '../src/index.ts';
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

// A synthetic hash exercising every base64 special (`/`,`+`,`=`) for the
// URL-encoding shape test. A strict get() reads it as a miss (not content-
// addressed), but that test only asserts the REQUEST path, never the return.
const URL_SPECIALS_HASH = 'sha256-ab/cd+ef=';
const syntheticManifest: EddyBundleManifestV1 = {
  format: 'EddyBundleV1',
  npmClientVersion: '0.0.0',
  asOf: {
    resolvedAt: '2026-07-02T00:00:00Z',
    registry: 'packument:',
    closureHash: URL_SPECIALS_HASH,
  },
  tarballs: [],
};
const syntheticBundle = packEddyBundle({
  manifest: syntheticManifest,
  lockfileText: '{"lockfileVersion":3}',
  tarballs: [],
});

// The ONLY shape a strict get() accepts as a HIT: a REAL bundle whose manifest
// hash === closureHashOf(lockfile) and whose tarball integrities match. Built
// once from the vendored fixture registry (it has tarballs → mutable for the
// tamper tests).
let HASH: string;
let manifest: EddyBundleManifestV1;
let bundleBytes: Uint8Array;
beforeAll(async () => {
  const built = await resolveBundle(
    { dependencies: { debug: '^4.4.1' } },
    { registryBaseUrl: LOCAL_REGISTRY_BASE_URL, fetch: makeLocalFetcher().fetch },
  );
  if (built.kind !== 'bundle') throw new Error('setup: expected a bundle');
  bundleBytes = built.bytes;
  manifest = unpackEddyBundle(bundleBytes).manifest;
  HASH = manifest.asOf.closureHash;
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
  /** Per-object `Cache-Control` system metadata (as S3 stores + echoes it). */
  cacheControls: Map<string, string>;
}

function startFakeS3(): Promise<FakeS3> {
  const requests: FakeS3['requests'] = [];
  const objects = new Map<string, Buffer>();
  const cacheControls = new Map<string, string>();
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
        const cc = req.headers['cache-control'];
        if (typeof cc === 'string') cacheControls.set(path, cc);
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
    const cc = cacheControls.get(path);
    res.writeHead(200, {
      'content-type': 'application/x-tar',
      'content-length': body.length,
      etag: etagOf(body),
      ...(cc ? { 'cache-control': cc } : {}),
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      resolve({ url: `http://127.0.0.1:${port}`, server, requests, objects, cacheControls });
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

  it('PUTs the immutable Cache-Control header so the bucket-backed CDN serves bundles forever', async () => {
    fake = await startFakeS3();
    const store = makeStore(fake.url);
    await store.put(HASH, { bytes: bundleBytes, manifest });
    const put = fake.requests.find((r) => r.method === 'PUT');
    expect(put?.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    // It is signed (part of the canonical request), so S3 accepts + stores it.
    expect(String(put?.headers.authorization)).toMatch(/SignedHeaders=[^,]*cache-control/);
  });

  it('rejects a valid bundle stored under the WRONG key (manifest self-report ≠ key)', async () => {
    fake = await startFakeS3();
    const store = makeStore(fake.url);
    const key = `/eddy-bundles/bundle/${encodeURIComponent(HASH)}`;
    // A valid bundle whose manifest reports a DIFFERENT hash, mis-keyed at HASH.
    fake.objects.set(key, Buffer.from(syntheticBundle));
    expect(await store.get(HASH)).toBeNull(); // right shape, wrong hash → miss
  });

  it('rejects a bundle whose lockfile RE-DERIVES to a different hash (tampered lockfile, matching manifest hash)', async () => {
    fake = await startFakeS3();
    const store = makeStore(fake.url);
    const key = `/eddy-bundles/bundle/${encodeURIComponent(HASH)}`;
    // Keep the manifest's self-reported hash === key, but mutate the lockfile so
    // closureHashOf(lockfile) no longer equals it.
    const contents = unpackEddyBundle(bundleBytes);
    const lf = JSON.parse(contents.lockfileText) as { packages: Record<string, unknown> };
    lf.packages['node_modules/__injected'] = { version: '9.9.9' };
    contents.lockfileText = JSON.stringify(lf);
    fake.objects.set(key, Buffer.from(packEddyBundle(contents)));
    expect(await store.get(HASH)).toBeNull(); // manifest matches key, lockfile doesn't → miss
  });

  it('rejects a PARTIAL object: lockfile intact (hash matches) but a reachable tarball omitted from manifest+members', async () => {
    // Regression (round 8): the tarball loop only checks what the manifest
    // NAMES — an object with an unchanged lockfile (same closure hash) that
    // drops a reachable tarball from BOTH manifest and members passed every
    // prior gate, yet the browser client rejects exactly this via its
    // completeness gate. The store must read it as a miss (→ self-heal), not
    // serve a hit stricter clients bounce forever.
    fake = await startFakeS3();
    const store = makeStore(fake.url);
    const key = `/eddy-bundles/bundle/${encodeURIComponent(HASH)}`;
    const contents = unpackEddyBundle(bundleBytes);
    const before = contents.tarballs.length;
    contents.manifest.tarballs = contents.manifest.tarballs.filter((t) => t.name !== 'ms');
    contents.tarballs = contents.tarballs.filter((t) => t.entry.name !== 'ms');
    expect(contents.tarballs.length).toBeLessThan(before); // the omission is real
    fake.objects.set(key, Buffer.from(packEddyBundle(contents)));
    expect(await store.get(HASH)).toBeNull(); // incomplete → miss
  });

  it('rejects an object with a NON-v3 lockfile (hash ignores lockfileVersion; clients bounce non-v3)', async () => {
    // closureHashOf canonicalizes `packages` only, so mutating
    // lockfileVersion 3→1 keeps the key intact — every prior gate passes, yet
    // every browser client refuses non-v3 bundles: a permanent decline loop.
    fake = await startFakeS3();
    const store = makeStore(fake.url);
    const key = `/eddy-bundles/bundle/${encodeURIComponent(HASH)}`;
    const contents = unpackEddyBundle(bundleBytes);
    const lf = JSON.parse(contents.lockfileText) as { lockfileVersion: number };
    lf.lockfileVersion = 1;
    contents.lockfileText = JSON.stringify(lf);
    fake.objects.set(key, Buffer.from(packEddyBundle(contents)));
    expect(await store.get(HASH)).toBeNull(); // non-v3 → miss (self-heals on next put)
  });

  it('rejects an object with an UNEXPECTED extra member (client declines the same shape) — round 13', async () => {
    // Manifest, lockfile, completeness and every NAMED tarball all pass — the
    // smuggled member is invisible to those gates, yet the streaming client
    // declines exactly this (`unexpected bundle member`): a permanent store
    // hit strict clients bounce.
    fake = await startFakeS3();
    const store = makeStore(fake.url);
    const key = `/eddy-bundles/bundle/${encodeURIComponent(HASH)}`;
    const contents = unpackEddyBundle(bundleBytes);
    contents.tarballs.push({
      // NOT added to manifest.tarballs — an unclaimed extra member.
      entry: {
        file: 'tarballs/smuggled.tgz',
        name: 'smuggled',
        version: '0.0.0',
        integrity: 'sha512-x',
      },
      bytes: new Uint8Array([1, 2, 3]),
    });
    fake.objects.set(key, Buffer.from(packEddyBundle(contents)));
    expect(await store.get(HASH)).toBeNull(); // unexpected member → miss
  });

  it('rejects an object with DUPLICATE reserved members (a second manifest/lockfile later in the tar) — round 16', async () => {
    // `unpackEddyBundle` keeps the LAST occurrence by name, so a duplicate
    // that byte-equals the real manifest/lockfile passes every content gate —
    // while the streaming client reads the FIRST members positionally and
    // declines the duplicate as `unexpected bundle member`. The store must
    // validate the raw member SEQUENCE, not just the by-name view.
    fake = await startFakeS3();
    const store = makeStore(fake.url);
    const key = `/eddy-bundles/bundle/${encodeURIComponent(HASH)}`;
    const contents = unpackEddyBundle(bundleBytes);
    const manifestBytes = new TextEncoder().encode(JSON.stringify(contents.manifest));
    contents.tarballs.push({
      // Emits a SECOND eddy-bundle.json member after the tarballs.
      entry: { file: 'eddy-bundle.json', name: 'dup', version: '0.0.0', integrity: 'sha512-x' },
      bytes: manifestBytes,
    });
    fake.objects.set(key, Buffer.from(packEddyBundle(contents)));
    expect(await store.get(HASH)).toBeNull(); // duplicate reserved member → miss
  });

  it('rejects an object with a DUPLICATE tarball member (same manifest file twice) — round 18', async () => {
    // Both occurrences are manifest-NAMED, so the membership loop passes each;
    // but `unpackEddyBundle`'s by-name map keeps ONE while the streaming client
    // verifies whichever it reads FIRST. A good-bytes-then-bad-bytes pair (or
    // vice-versa) verifies as a HIT here yet the strict client declines
    // (integrity mismatch) — a permanent hit self-heal never clears. The store
    // must reject a duplicate raw member outright, not just a duplicate name in
    // the manifest array.
    fake = await startFakeS3();
    const store = makeStore(fake.url);
    const key = `/eddy-bundles/bundle/${encodeURIComponent(HASH)}`;
    const contents = unpackEddyBundle(bundleBytes);
    const real = contents.tarballs[0];
    if (!real) throw new Error('setup: expected ≥1 tarball');
    // Pack order [manifest, lockfile, x(BAD), x(GOOD=real)]: `unpackEddyBundle`
    // keeps the LAST (GOOD) bytes, so the store's integrity gate PASSES — only a
    // member-uniqueness gate catches it. A positional streaming client reads the
    // FIRST (BAD) occurrence and declines (integrity mismatch): the exploit.
    contents.tarballs.unshift({ entry: { ...real.entry }, bytes: new Uint8Array([9, 9, 9]) });
    fake.objects.set(key, Buffer.from(packEddyBundle(contents)));
    expect(await store.get(HASH)).toBeNull(); // duplicate tarball member → miss
  });

  it('a parseable object whose manifest is the WRONG SHAPE (missing asOf) reads as a MISS, never a store throw/500 — round 16', async () => {
    fake = await startFakeS3();
    const store = makeStore(fake.url);
    const key = `/eddy-bundles/bundle/${encodeURIComponent(HASH)}`;
    const contents = unpackEddyBundle(bundleBytes);
    (contents.manifest as { asOf?: unknown }).asOf = undefined; // format+tarballs intact
    fake.objects.set(key, Buffer.from(packEddyBundle(contents)));
    await expect(store.get(HASH)).resolves.toBeNull(); // miss + self-heal, not a rejection
  });

  it('rejects a parseable manifest missing direct-GET header fields', async () => {
    fake = await startFakeS3();
    const store = makeStore(fake.url);
    const key = `/eddy-bundles/bundle/${encodeURIComponent(HASH)}`;
    const contents = unpackEddyBundle(bundleBytes);
    (contents.manifest as { npmClientVersion?: unknown }).npmClientVersion = undefined;
    (contents.manifest.asOf as { resolvedAt?: unknown }).resolvedAt = undefined;
    if (contents.manifest.tarballs[0]) {
      (contents.manifest.tarballs[0] as { name?: unknown }).name = undefined;
    }
    fake.objects.set(key, Buffer.from(packEddyBundle(contents)));
    await expect(store.get(HASH)).resolves.toBeNull();
  });

  it('rejects an object whose manifest names DUPLICATE member files (client declines the same shape)', async () => {
    fake = await startFakeS3();
    const store = makeStore(fake.url);
    const key = `/eddy-bundles/bundle/${encodeURIComponent(HASH)}`;
    const contents = unpackEddyBundle(bundleBytes);
    const [a, b] = contents.manifest.tarballs;
    if (!a || !b) throw new Error('setup: expected ≥2 tarballs');
    b.file = a.file; // two required packages, one member file
    fake.objects.set(key, Buffer.from(packEddyBundle(contents)));
    expect(await store.get(HASH)).toBeNull(); // duplicate manifest member → miss
  });

  it('rejects a bundle with tampered tarball bytes (integrity mismatch), matching manifest+lockfile', async () => {
    fake = await startFakeS3();
    const store = makeStore(fake.url);
    const key = `/eddy-bundles/bundle/${encodeURIComponent(HASH)}`;
    const contents = unpackEddyBundle(bundleBytes);
    expect(contents.tarballs.length).toBeGreaterThan(0);
    const victim = contents.tarballs[0];
    if (!victim) return;
    const tampered = new Uint8Array(victim.bytes);
    tampered[0] = (tampered[0] ?? 0) ^ 0xff; // integrity no longer matches the manifest entry
    victim.bytes = tampered;
    fake.objects.set(key, Buffer.from(packEddyBundle(contents)));
    expect(await store.get(HASH)).toBeNull(); // hash/lockfile fine, tarball bytes bad → miss
  });

  it('re-PUTs a same-byte object that lacks the immutable Cache-Control (repairs metadata)', async () => {
    fake = await startFakeS3();
    const store = makeStore(fake.url);
    const key = `/eddy-bundles/bundle/${encodeURIComponent(HASH)}`;
    // An older upload: correct bytes but NO cache-control metadata.
    fake.objects.set(key, Buffer.from(bundleBytes));
    await store.put(HASH, { bytes: bundleBytes, manifest });
    // ETag matches, but the missing header forces a repair PUT.
    expect(fake.requests.filter((r) => r.method === 'PUT').length).toBe(1);
    expect(fake.cacheControls.get(key)).toBe('public, max-age=31536000, immutable');
  });

  it('addresses the object as /<bucket>/bundle/<percent-encoded hash> — the client bundleUrlFor shape', async () => {
    fake = await startFakeS3();
    const store = makeStore(fake.url);
    await store.put(URL_SPECIALS_HASH, { bytes: syntheticBundle, manifest: syntheticManifest });
    const expectedPath = `/eddy-bundles/bundle/${encodeURIComponent(URL_SPECIALS_HASH)}`;
    expect(fake.requests.map((r) => `${r.method} ${r.path}`)).toContain(`PUT ${expectedPath}`);
    await store.get(URL_SPECIALS_HASH);
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

  it('a provider with NON-MD5 ETags (encryption/multipart) still settles put via the GET+hash proof — no recompute loop', async () => {
    // Regression (round 9): the post-PUT proof REQUIRED ETag === body MD5;
    // an S3-compatible provider with bucket encryption or provider-specific
    // ETags served the object fine yet failed the proof forever.
    const objects = new Map<string, Buffer>();
    let gets = 0;
    const server = createServer((req, res) => {
      if (req.method === 'PUT') {
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          objects.set(req.url ?? '', Buffer.concat(chunks));
          res.writeHead(200, { etag: '"opaque-provider-etag-1"' });
          res.end();
        });
        return;
      }
      const body = objects.get(req.url ?? '');
      if (!body) {
        res.writeHead(404);
        res.end();
        return;
      }
      if (req.method === 'GET') gets++;
      res.writeHead(200, {
        'content-type': 'application/x-tar',
        'content-length': body.length,
        etag: '"opaque-provider-etag-1"', // never the body MD5
        // The provider stores the PUT metadata faithfully — only its ETags
        // are opaque (the put proof also requires the immutable header).
        'cache-control': 'public, max-age=31536000, immutable',
      });
      res.end(req.method === 'HEAD' ? undefined : body);
    });
    const url = await new Promise<string>((resolve) => {
      server.listen(0, '127.0.0.1', () =>
        resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`),
      );
    });
    try {
      const store = makeStore(url);
      await store.put(HASH, { bytes: bundleBytes, manifest }); // must NOT throw
      expect(gets).toBe(1); // proof degraded to the read-back GET + hash compare
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      );
    }
  });

  it('a non-MD5-ETag put proof whose read-back GET serves FOREIGN bytes rejects — round 16', async () => {
    // Opaque ETag → the proof degrades to GET + byte-hash compare; a public
    // path serving a DIFFERENT object (mis-routed CDN/bucket) must fail the
    // put so the unservable hash is never linked.
    const server = createServer((req, res) => {
      if (req.method === 'PUT') {
        req.on('data', () => {});
        req.on('end', () => {
          res.writeHead(200, { etag: '"opaque-provider-etag-1"' });
          res.end();
        });
        return;
      }
      const foreign = Buffer.from('not-the-bundle-you-uploaded');
      res.writeHead(200, {
        'content-type': 'application/x-tar',
        'content-length': foreign.length,
        etag: '"opaque-provider-etag-1"',
        'cache-control': 'public, max-age=31536000, immutable', // metadata is fine — the BYTES are wrong
      });
      res.end(req.method === 'HEAD' ? undefined : foreign);
    });
    const url = await new Promise<string>((resolve) => {
      server.listen(0, '127.0.0.1', () =>
        resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`),
      );
    });
    try {
      const store = makeStore(url);
      await expect(store.put(HASH, { bytes: bundleBytes, manifest })).rejects.toThrow(
        /read back DIFFERENT bytes/,
      );
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      );
    }
  });

  it('a PUT that succeeds against a NON-public bucket rejects (public HEAD 403) — the hash is never linked unservable', async () => {
    // Signed writes work but unsigned reads 403 (bucket not public-read): the
    // durable-before-link contract says a settled put == GET-by-hash serves,
    // and the CDN + clients read UNSIGNED — so put must prove the public read.
    const objects = new Map<string, Buffer>();
    const server = createServer((req, res) => {
      if (req.method === 'PUT') {
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          const body = Buffer.concat(chunks);
          objects.set(req.url ?? '', body);
          res.writeHead(200, { etag: `"${createHash('md5').update(body).digest('hex')}"` });
          res.end();
        });
        return;
      }
      // Unsigned GET/HEAD: AccessDenied — the object exists but is private.
      res.writeHead(403, { 'content-type': 'application/xml' });
      res.end(req.method === 'HEAD' ? undefined : '<Error><Code>AccessDenied</Code></Error>');
    });
    const url = await new Promise<string>((resolve) => {
      server.listen(0, '127.0.0.1', () =>
        resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`),
      );
    });
    try {
      const store = makeStore(url);
      await expect(store.put(HASH, { bytes: bundleBytes, manifest })).rejects.toThrow(
        /not publicly readable.*public-read/s,
      );
      expect(objects.size).toBe(1); // the signed PUT itself DID succeed
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      );
    }
  });

  it('a PUT whose public read STRIPS Cache-Control rejects — a non-immutable link would defeat the CDN tier', async () => {
    // Regression (round 10): the proof returned on MD5-ETag equality alone; a
    // provider/proxy that accepts the PUT but drops the `Cache-Control` system
    // metadata served correct bytes with NO immutable header, so the published
    // link silently lost the CDN/browser-cache tier ADR-0194 §4 depends on.
    const objects = new Map<string, Buffer>();
    const server = createServer((req, res) => {
      if (req.method === 'PUT') {
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          const body = Buffer.concat(chunks);
          objects.set(req.url ?? '', body);
          // Metadata dropped on the floor — only the bytes are stored.
          res.writeHead(200, { etag: `"${createHash('md5').update(body).digest('hex')}"` });
          res.end();
        });
        return;
      }
      const body = objects.get(req.url ?? '');
      if (!body) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, {
        'content-type': 'application/x-tar',
        'content-length': body.length,
        etag: `"${createHash('md5').update(body).digest('hex')}"`, // bytes ARE correct
        // no cache-control: the immutable metadata was stripped
      });
      res.end(req.method === 'HEAD' ? undefined : body);
    });
    const url = await new Promise<string>((resolve) => {
      server.listen(0, '127.0.0.1', () =>
        resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`),
      );
    });
    try {
      const store = makeStore(url);
      await expect(store.put(HASH, { bytes: bundleBytes, manifest })).rejects.toThrow(
        /Cache-Control.*immutable metadata/s,
      );
      expect(objects.size).toBe(1); // the PUT itself DID succeed — only the proof failed
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      );
    }
  });

  it('a fetch that never settles (dead bucket, signal ignored) → get() rejects on the op deadline, never hangs', async () => {
    const store = new S3BundleStore({
      endpoint: 'https://example.invalid',
      bucket: 'eddy-bundles',
      region: 'ru-central1',
      accessKeyId: 'k',
      secretAccessKey: 's',
      opTimeoutMs: 25,
      fetchImpl: () => new Promise<Response>(() => {}), // never settles, ignores the signal
    });
    await expect(store.get(HASH)).rejects.toThrow(/timed out after 25ms/);
  });

  it('a fetch that never settles → put() rejects on the op deadline (probe degrade, then the PUT itself times out)', async () => {
    const store = new S3BundleStore({
      endpoint: 'https://example.invalid',
      bucket: 'eddy-bundles',
      region: 'ru-central1',
      accessKeyId: 'k',
      secretAccessKey: 's',
      opTimeoutMs: 25,
      fetchImpl: () => new Promise<Response>(() => {}),
    });
    // The stalled probe is a degrade (→ PUT anyway); the stalled PUT is the throw.
    await expect(store.put(HASH, { bytes: bundleBytes, manifest })).rejects.toThrow(
      /PUT .* timed out after 25ms/,
    );
  });

  it('a 200 whose body then STALLS forever → get() rejects on the op deadline (the deadline spans the body read)', async () => {
    const stalled = new ReadableStream<Uint8Array>({
      pull: () => new Promise<never>(() => {}), // headers arrived; the body never does
    });
    const store = new S3BundleStore({
      endpoint: 'https://example.invalid',
      bucket: 'eddy-bundles',
      region: 'ru-central1',
      accessKeyId: 'k',
      secretAccessKey: 's',
      opTimeoutMs: 25,
      fetchImpl: async () => new Response(stalled, { status: 200 }),
    });
    await expect(store.get(HASH)).rejects.toThrow(/timed out after 25ms/);
  });

  it('a body that streams forever → get() rejects on the byte cap, never buffers unbounded', async () => {
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(64 * 1024));
      },
    });
    const store = new S3BundleStore({
      endpoint: 'https://example.invalid',
      bucket: 'eddy-bundles',
      region: 'ru-central1',
      accessKeyId: 'k',
      secretAccessKey: 's',
      maxBundleBytes: 256 * 1024,
      fetchImpl: async () => new Response(endless, { status: 200 }),
    });
    await expect(store.get(HASH)).rejects.toThrow(/exceeded the 262144-byte cap/);
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
