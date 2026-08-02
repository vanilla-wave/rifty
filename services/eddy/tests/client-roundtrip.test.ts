/**
 * Full eddy round-trip + auto-fallback matrix (ADR-0182 §5,
 * `npm-client/eddy-client-opt-in`). A REAL eddy server over the vendored
 * fixture registry drives the client's `install({ resolverUrl })`; the failure
 * cases use real raw HTTP servers (closed port, 5xx, tampered bytes, coverage
 * gap) — nothing about the unit under test is mocked.
 */
import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  RegistryClient,
  VfsTarballCache,
  canonicalEddyRequestKey,
  closureHashOf,
  install,
  packEddyBundle,
  parseTarEntries,
  startEddyPrefetch,
  unpackEddyBundle,
} from '@riftydev/npm-client';
import { MemoryVfs } from '@riftydev/vfs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BUNDLED,
  BUNDLED_VERSION,
  LedgerRegistry,
  LedgerVfs,
  SOURCE,
  SOURCE_INTEGRITY,
  SOURCE_VERSION,
  eddyBundleFor,
  freshScope,
  installFixture,
  parentOnlyLockfile,
  writeProject,
} from '../../../packages/npm-client/src/_test-fixtures/shadow-recipe-v2-embedded-source.ts';
import {
  LOCAL_REGISTRY_BASE_URL,
  makeLocalFetcher,
} from '../../../tests/integration/fixtures/local-registry.ts';
import { resolveBundle } from '../src/index.ts';
import { type EddyServer, createEddyServer } from '../src/server.ts';

function makeRegistry() {
  const { fetch, calls } = makeLocalFetcher();
  return { registry: new RegistryClient({ baseUrl: LOCAL_REGISTRY_BASE_URL, fetch }), calls };
}

async function writePackageJson(vfs: MemoryVfs, deps: Record<string, string>): Promise<void> {
  await vfs.mkdir('/app', { recursive: true });
  await vfs.writeFile(
    '/app/package.json',
    JSON.stringify({ name: 'app', version: '1.0.0', dependencies: deps }),
  );
}

function startRaw(
  handler: Parameters<typeof createServer>[1],
): Promise<{ url: string; server: Server }> {
  const server = createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      resolve({ url: `http://127.0.0.1:${port}`, server });
    });
  });
}

function closeServer(server: Server): Promise<void> {
  // Sever keep-alive/hung sockets first: several tests below leave a response
  // body unread (an ignored prefetch) or never-ending (the early-abort case),
  // and a bare `close()` would wait on those sockets forever.
  (server as Server & { closeAllConnections?: () => void }).closeAllConnections?.();
  return new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
}

async function buildBundleFor(deps: Record<string, string>): Promise<Uint8Array> {
  const built = await resolveBundle(
    { dependencies: deps },
    { registryBaseUrl: LOCAL_REGISTRY_BASE_URL, fetch: makeLocalFetcher().fetch },
  );
  if (built.kind !== 'bundle') throw new Error('setup: expected a bundle');
  return built.bytes;
}

async function literalV2Fixture() {
  const fresh = await freshScope('root');
  const lock = parentOnlyLockfile(fresh.result.lockfile, 'root');
  const trace = (
    lock as unknown as {
      rifty: {
        shadowSubstitutions: {
          protocol: string;
          applied: Array<{
            acquisition: Record<string, unknown>;
            materialization: Record<string, unknown>;
          }>;
        };
      };
    }
  ).rifty.shadowSubstitutions;
  const fact = trace.applied[0];
  if (!fact) throw new Error('fixture lacks the LightningCSS trace fact');
  trace.protocol = 'rifty.shadow-substitutions/v2';
  fact.acquisition = {
    ...fact.acquisition,
    dependencies: { [BUNDLED]: '^1.0.1' },
    optionalDependencies: {},
    peerDependencies: {},
    bundleDependencies: [BUNDLED],
    bundled: [{ name: BUNDLED, version: BUNDLED_VERSION, inBundle: true }],
  };
  fact.materialization = { ...fact.materialization, bin: {} };
  return { ...fresh, lock, bundle: await eddyBundleFor(lock, fresh.entries) };
}

function replayFaultCache(fault: 'none' | 'missing' | 'corrupt') {
  const entries = new Map<string, Uint8Array>();
  const gets: string[] = [];
  const puts: string[] = [];
  const key = (name: string, version: string, integrity: string) =>
    `${name}\0${version}\0${integrity}`;
  return {
    gets,
    puts,
    cache: {
      async get(name: string, version: string, integrity: string) {
        const readKey = key(name, version, integrity);
        gets.push(readKey);
        const bytes = entries.get(readKey)?.slice() ?? null;
        if (name !== SOURCE || gets.filter((candidate) => candidate === readKey).length < 2) {
          return bytes;
        }
        if (fault === 'missing') return null;
        if (fault === 'corrupt' && bytes) bytes[0] = (bytes[0] ?? 0) ^ 0xff;
        return bytes;
      },
      async put(name: string, version: string, integrity: string, bytes: Uint8Array) {
        puts.push(key(name, version, integrity));
        entries.set(key(name, version, integrity), bytes.slice());
        return `memory:${name}@${version}`;
      },
    },
  };
}

let eddy: EddyServer;
let eddyUrl: string;

beforeEach(async () => {
  eddy = createEddyServer({
    registryBaseUrl: LOCAL_REGISTRY_BASE_URL,
    fetch: makeLocalFetcher().fetch,
  });
  await eddy.listen(0);
  eddyUrl = `http://127.0.0.1:${(eddy.address() as AddressInfo).port}`;
});
afterEach(async () => {
  await eddy.close();
});

const DEPS = { debug: '^4.4.1', 'diamond-conflict-parent': '1.0.0' };

describe('eddy client opt-in — fast path + auto-fallback', () => {
  it('fast path produces a tree+lockfile identical to a standard install, with zero own-registry traffic', async () => {
    // Standard reference.
    const stdVfs = new MemoryVfs();
    await writePackageJson(stdVfs, DEPS);
    const std = makeRegistry();
    const standard = await install({ vfs: stdVfs, cwd: '/app', registry: std.registry });
    expect(standard.source ?? 'standard').toBe('standard');

    // Eddy fast path.
    const fastVfs = new MemoryVfs();
    await writePackageJson(fastVfs, DEPS);
    const fast = makeRegistry();
    const result = await install({
      vfs: fastVfs,
      cwd: '/app',
      registry: fast.registry,
      resolverUrl: eddyUrl,
    });

    expect(result.source).toBe('eddy');
    // Zero packument/tarball traffic to the CLIENT's own registry (all from the bundle).
    expect(fast.calls.packument).toBe(0);
    expect(fast.calls.tarball).toBe(0);
    // Byte-identical lockfile (same root name → identical, including the diamond layout).
    expect(result.lockfile).toEqual(standard.lockfile);
    // node_modules materialized.
    expect(await fastVfs.exists('/app/node_modules/debug/package.json')).toBe(true);
    expect(
      await fastVfs.exists(
        '/app/node_modules/diamond-conflict-parent/node_modules/ms/package.json',
      ),
    ).toBe(true);
  });

  it('falls back to standard install when the resolver is unreachable (warns, never throws)', async () => {
    const vfs = new MemoryVfs();
    await writePackageJson(vfs, DEPS);
    const { registry } = makeRegistry();
    const result = await install({ vfs, cwd: '/app', registry, resolverUrl: 'http://127.0.0.1:1' });
    expect(result.source).toBe('standard');
    expect(await vfs.exists('/app/node_modules/debug/package.json')).toBe(true);
  });

  it('falls back when the resolver returns 5xx', async () => {
    const raw = await startRaw((_req, res) => {
      res.writeHead(503);
      res.end('upstream down');
    });
    try {
      const vfs = new MemoryVfs();
      await writePackageJson(vfs, DEPS);
      const { registry } = makeRegistry();
      const result = await install({ vfs, cwd: '/app', registry, resolverUrl: raw.url });
      expect(result.source).toBe('standard');
      expect(await vfs.exists('/app/node_modules/debug/package.json')).toBe(true);
    } finally {
      await closeServer(raw.server);
    }
  });

  it('cancels the non-OK resolver body on fallback (an unread body must not hold its stream open)', async () => {
    // 5xx with a body the client never consumes: the attempt pipeline moves on,
    // and the abandoned body must be CANCELLED (h2 stream hygiene — an unread
    // body holds its stream/connection open; the 404 GET-miss path hits this on
    // every unpinned install). Observable as the response closing server-side
    // while the handler still holds it open.
    let responseClosed = false;
    const raw = await startRaw((_req, res) => {
      res.writeHead(503, { 'content-type': 'text/plain' });
      res.write('upstream down, verbosely: ');
      res.on('close', () => {
        responseClosed = true;
      });
      // never res.end() — only a client-side cancel can close this response.
    });
    try {
      const vfs = new MemoryVfs();
      await writePackageJson(vfs, DEPS);
      const { registry } = makeRegistry();
      const result = await install({ vfs, cwd: '/app', registry, resolverUrl: raw.url });
      expect(result.source).toBe('standard');
      const deadline = Date.now() + 2_000;
      while (!responseClosed && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 25));
      }
      expect(responseClosed).toBe(true);
    } finally {
      await closeServer(raw.server);
    }
  });

  it('falls back (NOT a silent wrong install) when a bundle tarball fails integrity', async () => {
    // Build a real bundle, then tamper one tarball's bytes while leaving the
    // manifest integrity intact → the client's non-disableable byte check trips.
    const built = await resolveBundle(
      { dependencies: DEPS },
      { registryBaseUrl: LOCAL_REGISTRY_BASE_URL, fetch: makeLocalFetcher().fetch },
    );
    expect(built.kind).toBe('bundle');
    if (built.kind !== 'bundle') return;
    const contents = unpackEddyBundle(built.bytes);
    const victim = contents.tarballs[0];
    expect(victim).toBeDefined();
    if (!victim) return;
    const tampered = new Uint8Array(victim.bytes);
    const idx = Math.min(10, tampered.length - 1);
    tampered[idx] = (tampered[idx] ?? 0) ^ 0xff;
    victim.bytes = tampered; // manifest integrity unchanged → mismatch on the client
    const tamperedBytes = packEddyBundle(contents);

    const raw = await startRaw((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/x-tar' });
      res.end(Buffer.from(tamperedBytes));
    });
    try {
      const vfs = new MemoryVfs();
      await writePackageJson(vfs, DEPS);
      const { registry } = makeRegistry();
      const result = await install({ vfs, cwd: '/app', registry, resolverUrl: raw.url });
      expect(result.source).toBe('standard');
      // Standard install produced the correct tree (debug present, real bytes).
      expect(await vfs.exists('/app/node_modules/debug/package.json')).toBe(true);
    } finally {
      await closeServer(raw.server);
    }
  });

  it('falls back when the bundle lockfile does not cover the requested deps', async () => {
    // Server always returns a bundle for {debug} only; client requests debug + kleur.
    const built = await resolveBundle(
      { dependencies: { debug: '^4.4.1' } },
      { registryBaseUrl: LOCAL_REGISTRY_BASE_URL, fetch: makeLocalFetcher().fetch },
    );
    if (built.kind !== 'bundle') throw new Error('setup');
    const raw = await startRaw((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/x-tar' });
      res.end(Buffer.from(built.bytes));
    });
    try {
      const vfs = new MemoryVfs();
      await writePackageJson(vfs, { debug: '^4.4.1', kleur: '4.1.5' });
      const { registry } = makeRegistry();
      const result = await install({ vfs, cwd: '/app', registry, resolverUrl: raw.url });
      expect(result.source).toBe('standard');
      expect(await vfs.exists('/app/node_modules/kleur/package.json')).toBe(true);
    } finally {
      await closeServer(raw.server);
    }
  });

  it('falls back (never throws, no lockfile corruption) when the bundle lockfile is not v3', async () => {
    // A divergent/buggy resolver returns a bundle whose package-lock.json is a
    // NON-v3 shape (here v1) but whose `packages` still cover the request +
    // whose tarball integrity is intact. Honest eddy always emits v3
    // (`linker.ts` hardcode), but mirror-grade trust means the client must gate
    // this: adopting it would (a) write a v1 lockfile over the user's, and
    // (b) make install()'s post-seed re-read throw NotImplementedError(v1) —
    // breaking BOTH the "never throws" and "leaves the lockfile untouched"
    // promises.
    const built = await resolveBundle(
      { dependencies: DEPS },
      { registryBaseUrl: LOCAL_REGISTRY_BASE_URL, fetch: makeLocalFetcher().fetch },
    );
    if (built.kind !== 'bundle') throw new Error('setup');
    const contents = unpackEddyBundle(built.bytes);
    const lf = JSON.parse(contents.lockfileText) as { lockfileVersion: number };
    lf.lockfileVersion = 1; // valid `packages`, but a version the client must refuse
    contents.lockfileText = JSON.stringify(lf);
    const poisoned = packEddyBundle(contents);
    const raw = await startRaw((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/x-tar' });
      res.end(Buffer.from(poisoned));
    });
    try {
      const vfs = new MemoryVfs();
      await writePackageJson(vfs, DEPS);
      const { registry } = makeRegistry();
      const result = await install({ vfs, cwd: '/app', registry, resolverUrl: raw.url });
      expect(result.source).toBe('standard');
      expect(await vfs.exists('/app/node_modules/debug/package.json')).toBe(true);
      // The standard install wrote the correct v3 lockfile — the v1 bundle
      // lockfile was never persisted.
      const onDisk = JSON.parse(await vfs.readFileText('/app/package-lock.json')) as {
        lockfileVersion: number;
      };
      expect(onDisk.lockfileVersion).toBe(3);
    } finally {
      await closeServer(raw.server);
    }
  });

  it('falls back on a typed "unsupported" decline, naming the declined feature', async () => {
    // Server sends declines as 422 + JSON (server.ts). The client's warn must
    // name the feature (`declined (file)`), not a generic `HTTP 422` — the JSON
    // decline branch has to run BEFORE the `!response.ok` gate, else the typed
    // reason is unreachable and every decline reads as an opaque status.
    const raw = await startRaw((_req, res) => {
      res.writeHead(422, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ kind: 'unsupported', feature: 'file', message: 'use standard' }));
    });
    const warnings: string[] = [];
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation((...args) => {
      warnings.push(args.map((a) => String(a)).join(' '));
    });
    try {
      const vfs = new MemoryVfs();
      await writePackageJson(vfs, DEPS);
      const { registry } = makeRegistry();
      const result = await install({ vfs, cwd: '/app', registry, resolverUrl: raw.url });
      expect(result.source).toBe('standard');
      expect(await vfs.exists('/app/node_modules/debug/package.json')).toBe(true);
      expect(warnings.some((w) => /declined \(file\)/.test(w))).toBe(true);
    } finally {
      warnSpy.mockRestore();
      await closeServer(raw.server);
    }
  });

  it('sends a CORS-simple POST (text/plain default, no explicit content-type) — no browser preflight', async () => {
    // A fetch() with a string body and NO content-type header defaults to
    // `text/plain;charset=UTF-8` — a CORS-simple request, so a cross-origin
    // browser client skips the OPTIONS preflight (one RTT off the cold path).
    // The server parses the body unconditionally (readBody + JSON.parse).
    const built = await resolveBundle(
      { dependencies: DEPS },
      { registryBaseUrl: LOCAL_REGISTRY_BASE_URL, fetch: makeLocalFetcher().fetch },
    );
    if (built.kind !== 'bundle') throw new Error('setup');
    let seenContentType: string | undefined;
    const raw = await startRaw((req, res) => {
      seenContentType = req.headers['content-type'];
      res.writeHead(200, { 'content-type': 'application/x-tar' });
      res.end(Buffer.from(built.bytes));
    });
    try {
      const vfs = new MemoryVfs();
      await writePackageJson(vfs, DEPS);
      const { registry } = makeRegistry();
      const result = await install({ vfs, cwd: '/app', registry, resolverUrl: raw.url });
      expect(result.source).toBe('eddy');
      expect(seenContentType).toMatch(/^text\/plain/);
    } finally {
      await closeServer(raw.server);
    }
  });

  it('returns the adopted bundle closureHash on the eddy path; absent on standard/fallback (ADR-0194)', async () => {
    // Expected hash = the manifest hash of a locally built bundle for the same
    // deps (the fixture registry is deterministic, so eddy computes the same).
    const { manifest } = unpackEddyBundle(await buildBundleFor(DEPS));

    const fastVfs = new MemoryVfs();
    await writePackageJson(fastVfs, DEPS);
    const fast = await install({
      vfs: fastVfs,
      cwd: '/app',
      registry: makeRegistry().registry,
      resolverUrl: eddyUrl,
    });
    expect(fast.source).toBe('eddy');
    expect(fast.closureHash).toBe(manifest.asOf.closureHash);
    // The served bundle's as-of stamp rides out too (stale-pin honesty line:
    // `as-of <resolvedAt>` must come from the SERVED manifest, not pin age).
    expect(typeof fast.resolvedAt).toBe('string');
    expect(Number.isNaN(Date.parse(fast.resolvedAt as string))).toBe(false);
    // …and the attempt provenance: this install POSTed (no pin) — the pin
    // policy hangs off this (only a POST re-vouches a resolution's age).
    expect(fast.resolvedVia).toBe('post');

    // Standard install (resolver off) — no hash, key for learned pins staying
    // eddy-only.
    const stdVfs = new MemoryVfs();
    await writePackageJson(stdVfs, DEPS);
    const std = await install({ vfs: stdVfs, cwd: '/app', registry: makeRegistry().registry });
    expect(std.closureHash).toBeUndefined();
    expect(std.resolvedAt).toBeUndefined();

    // Fallback (resolver unreachable) — standard install, no hash.
    const fbVfs = new MemoryVfs();
    await writePackageJson(fbVfs, DEPS);
    const fb = await install({
      vfs: fbVfs,
      cwd: '/app',
      registry: makeRegistry().registry,
      resolverUrl: 'http://127.0.0.1:1',
    });
    expect(fb.source).toBe('standard');
    expect(fb.closureHash).toBeUndefined();
  });

  it('does not expose a learned-pin closureHash for an unproven POST bundle', async () => {
    const bytes = await buildBundleFor(DEPS);
    const raw = await startRaw((_req, res) => {
      res.writeHead(200, {
        'content-type': 'application/x-tar',
        'x-eddy-store-durable': '0',
      });
      res.end(Buffer.from(bytes));
    });
    try {
      const vfs = new MemoryVfs();
      await writePackageJson(vfs, DEPS);
      const result = await install({
        vfs,
        cwd: '/app',
        registry: makeRegistry().registry,
        resolverUrl: raw.url,
      });
      expect(result.source).toBe('eddy');
      expect(result.closureHash).toBeUndefined();
    } finally {
      await closeServer(raw.server);
    }
  });

  it('is inert when resolverUrl is unset (source standard, identical to today)', async () => {
    const vfs = new MemoryVfs();
    await writePackageJson(vfs, DEPS);
    const { registry, calls } = makeRegistry();
    const result = await install({ vfs, cwd: '/app', registry });
    expect(result.source ?? 'standard').toBe('standard');
    expect(calls.packument).toBeGreaterThan(0); // it really did resolve via the registry
  });

  it('resolverClosureHash: a pinned GET hit installs via eddy with ZERO POSTs', async () => {
    const bytes = await buildBundleFor(DEPS);
    const { manifest } = unpackEddyBundle(bytes);
    const hash = manifest.asOf.closureHash;
    let posts = 0;
    const raw = await startRaw((req, res) => {
      if (req.method === 'POST') {
        posts++;
        res.writeHead(500);
        res.end();
        return;
      }
      expect(req.url).toBe(`/bundle/${encodeURIComponent(hash)}`);
      res.writeHead(200, { 'content-type': 'application/x-tar' });
      res.end(Buffer.from(bytes));
    });
    try {
      const vfs = new MemoryVfs();
      await writePackageJson(vfs, DEPS);
      const { registry, calls } = makeRegistry();
      const result = await install({
        vfs,
        cwd: '/app',
        registry,
        resolverUrl: raw.url,
        resolverClosureHash: hash,
      });
      expect(result.source).toBe('eddy');
      expect(result.closureHash).toBe(hash);
      expect(posts).toBe(0);
      expect(calls.packument + calls.tarball).toBe(0);
    } finally {
      await closeServer(raw.server);
    }
  });

  it('resolverClosureHash: a 404 miss (restarted/evicted server) falls back to POST → still eddy', async () => {
    const bytes = await buildBundleFor(DEPS);
    let gets = 0;
    let posts = 0;
    const raw = await startRaw((req, res) => {
      if (req.method === 'GET') {
        gets++;
        res.writeHead(404, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify({ error: 'unknown bundle hash' }));
        return;
      }
      posts++;
      res.writeHead(200, { 'content-type': 'application/x-tar' });
      res.end(Buffer.from(bytes));
    });
    try {
      const vfs = new MemoryVfs();
      await writePackageJson(vfs, DEPS);
      const { registry } = makeRegistry();
      const result = await install({
        vfs,
        cwd: '/app',
        registry,
        resolverUrl: raw.url,
        resolverClosureHash: 'sha256-stale',
      });
      expect(result.source).toBe('eddy');
      expect(gets).toBe(1);
      expect(posts).toBe(1);
    } finally {
      await closeServer(raw.server);
    }
  });

  it('resolverClosureHash: a STALE pin (bundle no longer covers the deps) falls back to POST', async () => {
    // GET serves an old bundle for {debug} only; the project now also wants kleur.
    const staleBytes = await buildBundleFor({ debug: '^4.4.1' });
    const freshBytes = await buildBundleFor({ debug: '^4.4.1', kleur: '4.1.5' });
    // The pin is the stale bundle's REAL manifest hash: the content-address
    // gates PASS (the CDN served exactly what was asked) and the decline is
    // the COVERAGE gate — the scenario this test names. A made-up pin would
    // trip the hash-mismatch gate first and never exercise coverage.
    const stalePin = unpackEddyBundle(staleBytes).manifest.asOf.closureHash;
    const raw = await startRaw((req, res) => {
      res.writeHead(200, { 'content-type': 'application/x-tar' });
      res.end(Buffer.from(req.method === 'GET' ? staleBytes : freshBytes));
    });
    try {
      const vfs = new MemoryVfs();
      await writePackageJson(vfs, { debug: '^4.4.1', kleur: '4.1.5' });
      const { registry } = makeRegistry();
      const result = await install({
        vfs,
        cwd: '/app',
        registry,
        resolverUrl: raw.url,
        resolverClosureHash: stalePin,
      });
      expect(result.source).toBe('eddy');
      expect(await vfs.exists('/app/node_modules/kleur/package.json')).toBe(true);
    } finally {
      await closeServer(raw.server);
    }
  });

  it('resolverBundleBaseUrl: the pinned GET rides the CDN base, the POST fallback stays on the origin', async () => {
    // Real edges (Yandex CDN) refuse POST, so the two bases can differ: a
    // CDN-shaped server that ONLY answers GET-by-hash, and the origin that
    // answers POST. A stale pin on the CDN must fall back to the ORIGIN's POST.
    const bytes = await buildBundleFor(DEPS);
    let cdnGets = 0;
    const cdn = await startRaw((req, res) => {
      if (req.method !== 'GET') {
        res.writeHead(405, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'method not allowed at the edge' }));
        return;
      }
      cdnGets++;
      res.writeHead(404, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ error: 'unknown bundle hash' }));
    });
    let originPosts = 0;
    const origin = await startRaw((req, res) => {
      expect(req.method).toBe('POST');
      originPosts++;
      res.writeHead(200, { 'content-type': 'application/x-tar' });
      res.end(Buffer.from(bytes));
    });
    try {
      const vfs = new MemoryVfs();
      await writePackageJson(vfs, DEPS);
      const { registry } = makeRegistry();
      const result = await install({
        vfs,
        cwd: '/app',
        registry,
        resolverUrl: origin.url,
        resolverClosureHash: 'sha256-evicted',
        resolverBundleBaseUrl: cdn.url,
      });
      expect(result.source).toBe('eddy');
      expect(cdnGets).toBe(1);
      expect(originPosts).toBe(1);
    } finally {
      await closeServer(cdn.server);
      await closeServer(origin.server);
    }
  });

  it('resolverPrefetch: a matching prefetch is consumed — the server sees exactly ONE request', async () => {
    const bytes = await buildBundleFor(DEPS);
    let requests = 0;
    const raw = await startRaw((_req, res) => {
      requests++;
      res.writeHead(200, { 'content-type': 'application/x-tar' });
      res.end(Buffer.from(bytes));
    });
    try {
      const vfs = new MemoryVfs();
      await writePackageJson(vfs, DEPS);
      const { registry } = makeRegistry();
      const prefetch = startEddyPrefetch({
        resolverUrl: raw.url,
        request: { dependencies: DEPS, optionalDependencies: {} },
      });
      const result = await install({
        vfs,
        cwd: '/app',
        registry,
        resolverUrl: raw.url,
        resolverPrefetch: prefetch,
      });
      expect(result.source).toBe('eddy');
      expect(requests).toBe(1);
      // An UNPINNED prefetch is a POST resolve under the hood — its adoption
      // must carry 'post' provenance or the profile never learns a pin from
      // the boot-prefetch path (the primary cold-install flow).
      expect(result.resolvedVia).toBe('post');
    } finally {
      await closeServer(raw.server);
    }
  });

  it('resolverPrefetch against the REAL server: an unpinned prefetch adoption is learnable AND post-provenanced', async () => {
    const vfs = new MemoryVfs();
    await writePackageJson(vfs, DEPS);
    const prefetch = startEddyPrefetch({
      resolverUrl: eddyUrl,
      request: { dependencies: DEPS, optionalDependencies: {} },
    });
    const result = await install({
      vfs,
      cwd: '/app',
      registry: makeRegistry().registry,
      resolverUrl: eddyUrl,
      resolverPrefetch: prefetch,
    });
    expect(result.source).toBe('eddy');
    expect(result.resolvedVia).toBe('post'); // POST under the hood — server-vouched
    expect(result.closureHash).toBeDefined(); // durable-header gate passed → learnable
  });

  it('resolverPrefetch: an already-bounded slow buffered response is not raced by the direct header timeout', async () => {
    const bytes = await buildBundleFor(DEPS);
    let fallbackRequests = 0;
    const raw = await startRaw((_req, res) => {
      fallbackRequests++;
      res.writeHead(500);
      res.end();
    });
    try {
      const vfs = new MemoryVfs();
      await writePackageJson(vfs, DEPS);
      const { registry } = makeRegistry();
      const prefetch = {
        take: (_requestKey: string) =>
          new Promise<Response>((resolve) => {
            setTimeout(() => {
              const body = new ArrayBuffer(bytes.byteLength);
              new Uint8Array(body).set(bytes);
              resolve(
                new Response(body, {
                  status: 200,
                  headers: { 'content-type': 'application/x-tar' },
                }),
              );
            }, 50);
          }),
      };
      const result = await install({
        vfs,
        cwd: '/app',
        registry,
        resolverUrl: raw.url,
        resolverPrefetch: prefetch,
        resolverStallTimeoutMs: 5,
      });

      expect(result.source).toBe('eddy');
      expect(fallbackRequests).toBe(0);
    } finally {
      await closeServer(raw.server);
    }
  });

  it('resolverPrefetch: a prefetch for STALE deps is ignored (never trusted) — install fetches its own', async () => {
    const bytes = await buildBundleFor(DEPS);
    let requests = 0;
    const raw = await startRaw((_req, res) => {
      requests++;
      res.writeHead(200, { 'content-type': 'application/x-tar' });
      res.end(Buffer.from(bytes));
    });
    try {
      const vfs = new MemoryVfs();
      await writePackageJson(vfs, DEPS);
      const { registry } = makeRegistry();
      // Prefetched for a DIFFERENT dep-set (the user edited package.json since).
      const staleRequest = { dependencies: { kleur: '4.1.5' }, optionalDependencies: {} };
      const prefetch = startEddyPrefetch({ resolverUrl: raw.url, request: staleRequest });
      const result = await install({
        vfs,
        cwd: '/app',
        registry,
        resolverUrl: raw.url,
        resolverPrefetch: prefetch,
      });
      expect(result.source).toBe('eddy');
      expect(requests).toBe(2); // the untaken prefetch + install's own POST
      // Drain the ignored prefetch so the keep-alive socket can close.
      await prefetch.take(canonicalEddyRequestKey(staleRequest))?.then((r) => r.arrayBuffer());
    } finally {
      await closeServer(raw.server);
    }
  });

  it('resolverPrefetch: a NEVER-ENDING prefetch body does not hang install — bounded drain rejects, fallback runs', async () => {
    // Regression (round 5): the prefetch eager-drain was an unbounded
    // arrayBuffer(); a resolver holding the connection open parked install()
    // forever on the consumed prefetch — no error, no fallback, a hung
    // terminal. Server behavior: EVERY request gets the manifest+lockfile of a
    // NON-covering bundle, then the connection stays open. The bounded drain
    // must reject the prefetch; install's own POST attempt then streams,
    // declines on coverage, and the standard install completes.
    const bytes = await buildBundleFor({ debug: '^4.4.1' });
    const entries = parseTarEntries(bytes);
    const manifestSize = entries[0]?.data.length ?? 0;
    const lockfileSize = entries[1]?.data.length ?? 0;
    const boundary =
      512 + Math.ceil(manifestSize / 512) * 512 + 512 + Math.ceil(lockfileSize / 512) * 512;
    const raw = await startRaw((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/x-tar' });
      res.write(Buffer.from(bytes.slice(0, boundary)));
      // never end()
    });
    try {
      const vfs = new MemoryVfs();
      await writePackageJson(vfs, { debug: '^4.4.1', kleur: '4.1.5' }); // not covered
      const { registry } = makeRegistry();
      const request = {
        dependencies: { debug: '^4.4.1', kleur: '4.1.5' },
        optionalDependencies: {},
      };
      const prefetch = startEddyPrefetch({
        resolverUrl: raw.url,
        request,
        stallTimeoutMs: 100, // test-fast; default 10s
      });
      const result = await install({
        vfs,
        cwd: '/app',
        registry,
        resolverUrl: raw.url,
        resolverPrefetch: prefetch,
      });
      expect(result.source).toBe('standard');
      expect(await vfs.exists('/app/node_modules/kleur/package.json')).toBe(true);
    } finally {
      await closeServer(raw.server);
    }
  }, 15_000);

  it('a FAILED pinned prefetch still tries the direct pinned GET before POST (prefetch → GET → POST)', async () => {
    // Regression (round 7): a same-pin prefetch that stalled made the pipeline
    // SKIP the direct GET and jump to POST — the cacheable GET tier was lost
    // exactly when the retry was cheapest. A successful prefetch short-circuits
    // before the GET; a failed one must fall through TO it.
    const bytes = await buildBundleFor(DEPS);
    const hash = unpackEddyBundle(bytes).manifest.asOf.closureHash;
    let gets = 0;
    let posts = 0;
    const raw = await startRaw((req, res) => {
      if (req.method === 'POST') {
        posts++;
        res.writeHead(500);
        res.end();
        return;
      }
      gets++;
      res.writeHead(200, { 'content-type': 'application/x-tar' });
      res.end(Buffer.from(bytes));
    });
    try {
      const vfs = new MemoryVfs();
      await writePackageJson(vfs, DEPS);
      const { registry } = makeRegistry();
      // The prefetch is a pinned GET for the SAME hash, but its transport dies
      // (never-ending body → bounded drain rejects).
      const hangingFetch = (async () =>
        new Response(new ReadableStream<Uint8Array>({ start() {} }))) as unknown as typeof fetch;
      const prefetch = startEddyPrefetch({
        resolverUrl: raw.url,
        request: { dependencies: DEPS, optionalDependencies: {} },
        closureHash: hash,
        fetchImpl: hangingFetch,
        stallTimeoutMs: 25,
      });
      const result = await install({
        vfs,
        cwd: '/app',
        registry,
        resolverUrl: raw.url,
        resolverClosureHash: hash,
        resolverPrefetch: prefetch,
      });
      expect(result.source).toBe('eddy'); // adopted via the DIRECT pinned GET
      expect(gets).toBe(1);
      expect(posts).toBe(0); // POST never needed — the GET tier did its job
    } finally {
      await closeServer(raw.server);
    }
  });

  it('a COVERING bundle that stalls mid-tarball does not hang install — the stream bound fails the attempt, standard runs', async () => {
    // Regression (round 6): the coverage gates cannot save this case — the
    // lockfile COVERS the request, so the client keeps reading tarball bytes;
    // a resolver/CDN that hangs mid-body parked `npm install` forever. The
    // direct-stream no-progress bound must fail the POST attempt instead.
    const bytes = await buildBundleFor(DEPS);
    const entries = parseTarEntries(bytes);
    const manifestSize = entries[0]?.data.length ?? 0;
    const lockfileSize = entries[1]?.data.length ?? 0;
    const boundary =
      512 + Math.ceil(manifestSize / 512) * 512 + 512 + Math.ceil(lockfileSize / 512) * 512;
    const raw = await startRaw((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/x-tar' });
      // Manifest + lockfile + a partial first tarball, then hold the
      // connection open forever.
      res.write(Buffer.from(bytes.slice(0, boundary + 700)));
      // never end()
    });
    try {
      const vfs = new MemoryVfs();
      await writePackageJson(vfs, DEPS); // fully covered — coverage gate passes
      const { registry } = makeRegistry();
      const result = await install({
        vfs,
        cwd: '/app',
        registry,
        resolverUrl: raw.url,
        resolverStallTimeoutMs: 100, // test-fast; default 10s
      });
      expect(result.source).toBe('standard');
      expect(result.closureHash).toBeUndefined();
      expect(await vfs.exists('/app/node_modules/debug/package.json')).toBe(true);
    } finally {
      await closeServer(raw.server);
    }
  }, 15_000);

  it('streams the bundle: a coverage decline aborts BEFORE the tarball bytes transfer', async () => {
    // The server sends ONLY the manifest + lockfile members, then holds the
    // connection open forever. A buffering client would hang awaiting the full
    // body; the streaming client gates on the lockfile, declines (coverage
    // gap), cancels the download, and falls back to the standard install.
    const bytes = await buildBundleFor({ debug: '^4.4.1' });
    const entries = parseTarEntries(bytes);
    const manifestSize = entries[0]?.data.length ?? 0;
    const lockfileSize = entries[1]?.data.length ?? 0;
    const boundary =
      512 + Math.ceil(manifestSize / 512) * 512 + 512 + Math.ceil(lockfileSize / 512) * 512;
    let serverSawCancel = false;
    const raw = await startRaw((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/x-tar' });
      res.write(Buffer.from(bytes.slice(0, boundary)));
      // never end() — only a client-side CANCEL can close this response.
      res.on('close', () => {
        serverSawCancel = true;
      });
    });
    try {
      const vfs = new MemoryVfs();
      await writePackageJson(vfs, { debug: '^4.4.1', kleur: '4.1.5' }); // not covered
      const { registry } = makeRegistry();
      const result = await install({ vfs, cwd: '/app', registry, resolverUrl: raw.url });
      expect(result.source).toBe('standard');
      expect(await vfs.exists('/app/node_modules/kleur/package.json')).toBe(true);
      // The decline CANCELLED the download (gen.return → stream cancel → the
      // server's response closes) — not merely out-waited a stall timeout:
      // install (incl. the standard fallback) finished well under the 10s
      // stall bound, so a close here proves the early abort.
      for (let i = 0; i < 100 && !serverSawCancel; i++) {
        await new Promise((r) => setTimeout(r, 10));
      }
      expect(serverSawCancel).toBe(true);
    } finally {
      await closeServer(raw.server);
    }
  }, 15_000);

  it('seeds tarballs AS THEY ARRIVE: a mid-bundle integrity failure leaves earlier verified bytes cached', async () => {
    const built = await resolveBundle(
      { dependencies: DEPS },
      { registryBaseUrl: LOCAL_REGISTRY_BASE_URL, fetch: makeLocalFetcher().fetch },
    );
    if (built.kind !== 'bundle') throw new Error('setup');
    const contents = unpackEddyBundle(built.bytes);
    expect(contents.tarballs.length).toBeGreaterThan(1);
    const first = contents.tarballs[0];
    const victim = contents.tarballs[1];
    if (!first || !victim) return;
    const tampered = new Uint8Array(victim.bytes);
    tampered[0] = (tampered[0] ?? 0) ^ 0xff;
    victim.bytes = tampered;
    const raw = await startRaw((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/x-tar' });
      res.end(Buffer.from(packEddyBundle(contents)));
    });
    try {
      const vfs = new MemoryVfs();
      await writePackageJson(vfs, DEPS);
      const { registry } = makeRegistry();
      const cache = new VfsTarballCache(vfs);
      const puts: string[] = [];
      const recordingCache = {
        get: (name: string, version: string, integrity: string) =>
          cache.get(name, version, integrity),
        put: (name: string, version: string, integrity: string, bytes: Uint8Array) => {
          puts.push(`${name}@${version}`);
          return cache.put(name, version, integrity, bytes);
        },
      };
      const result = await install({
        vfs,
        cwd: '/app',
        registry,
        resolverUrl: raw.url,
        tarballCache: recordingCache,
      });
      // The tampered member declined the bundle → standard install ran…
      expect(result.source).toBe('standard');
      // …but the FIRST tarball had already been verified + seeded (content-
      // addressed cache: a partial seed leaves only correct bytes), so the
      // very first put predates the standard install's.
      expect(puts[0]).toBe(`${first.entry.name}@${first.entry.version}`);
      const seeded = await cache.get(first.entry.name, first.entry.version, first.entry.integrity);
      expect(seeded).not.toBeNull();
    } finally {
      await closeServer(raw.server);
    }
  });

  it('declines (source standard) when an override divergence would force chooseSource to live-resolve', async () => {
    // A parent-scoped override forces `chooseSource` to live-resolve regardless
    // of the lockfile (v3 flat lockfiles lose parent context). The eddy gate
    // must mirror that condition: writing the bundle lockfile + claiming
    // source:'eddy' here would be a provenance lie — the install would actually
    // live-resolve. So eddy must DECLINE; provenance stays honest.
    const vfs = new MemoryVfs();
    await vfs.mkdir('/app', { recursive: true });
    await vfs.writeFile(
      '/app/package.json',
      JSON.stringify({
        name: 'app',
        version: '1.0.0',
        dependencies: { debug: '^4.4.1' },
        overrides: { 'debug>ms': 'ms@2.0.0' },
      }),
    );
    const { registry } = makeRegistry();
    const result = await install({ vfs, cwd: '/app', registry, resolverUrl: eddyUrl });
    expect(result.source).toBe('standard');
    // Tree is still correct — the override applied (debug's ms pinned to 2.0.0).
    expect(await vfs.exists('/app/node_modules/debug/package.json')).toBe(true);
    const ms = JSON.parse(await vfs.readFileText('/app/node_modules/ms/package.json')) as {
      version: string;
    };
    expect(ms.version).toBe('2.0.0');
  });

  it('resolverClosureHash: a pinned GET whose bundle self-reports a DIFFERENT hash is refused (content-addressed), falls back to POST', async () => {
    // The GET serves a VALID, request-covering bundle — but its real closure hash
    // is NOT the pin the client asked for (a CDN/cache mixup, or a poisoned edge).
    // Coverage+integrity alone would adopt it AND learn a wrong pin; the
    // content-address check refuses the GET and the POST fallback wins.
    const bytes = await buildBundleFor(DEPS);
    let gets = 0;
    let posts = 0;
    const raw = await startRaw((req, res) => {
      if (req.method === 'POST') posts++;
      else gets++;
      res.writeHead(200, { 'content-type': 'application/x-tar' });
      res.end(Buffer.from(bytes));
    });
    try {
      const vfs = new MemoryVfs();
      await writePackageJson(vfs, DEPS);
      const { registry } = makeRegistry();
      const result = await install({
        vfs,
        cwd: '/app',
        registry,
        resolverUrl: raw.url,
        resolverClosureHash: 'sha256-not-the-served-hash',
      });
      expect(result.source).toBe('eddy'); // adopted via the POST fallback
      expect(gets).toBe(1); // the pinned GET was tried…
      expect(posts).toBe(1); // …refused on the hash mismatch → POST (cf. the ZERO-POST pinned-hit case)
      // The learned hash is the REAL served hash, never the bogus pin.
      expect(result.closureHash).not.toBe('sha256-not-the-served-hash');
    } finally {
      await closeServer(raw.server);
    }
  });

  it('refuses a PARTIAL bundle: a covering lockfile whose reachable package has no manifest tarball is declined, never adopted as eddy', async () => {
    // Regression (round 6): a buggy resolver sends a covering lockfile but
    // OMITS a required tarball from the manifest+bundle. Every gate up to now
    // passes (coverage ✓, hash self-consistency ✓ — the lockfile is untouched,
    // all MANIFEST-named tarballs land ✓) — but adopting it would make the
    // lockfile replay silently fetch the omission from the ORDINARY registry
    // on cache miss while reporting (and learning a pin for) source:'eddy'.
    const built = await resolveBundle(
      { dependencies: DEPS },
      { registryBaseUrl: LOCAL_REGISTRY_BASE_URL, fetch: makeLocalFetcher().fetch },
    );
    if (built.kind !== 'bundle') throw new Error('setup');
    const contents = unpackEddyBundle(built.bytes);
    const before = contents.tarballs.length;
    // Drop a REACHABLE transitive dep (ms — debug depends on it) from BOTH the
    // manifest and the packed members.
    contents.manifest.tarballs = contents.manifest.tarballs.filter((t) => t.name !== 'ms');
    contents.tarballs = contents.tarballs.filter((t) => t.entry.name !== 'ms');
    expect(contents.tarballs.length).toBeLessThan(before); // the omission is real
    const partial = packEddyBundle(contents);
    const raw = await startRaw((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/x-tar' });
      res.end(Buffer.from(partial));
    });
    try {
      const vfs = new MemoryVfs();
      await writePackageJson(vfs, DEPS);
      const { registry } = makeRegistry();
      const result = await install({ vfs, cwd: '/app', registry, resolverUrl: raw.url });
      expect(result.source).toBe('standard'); // declined → honest fallback
      expect(result.closureHash).toBeUndefined(); // no pin learned for a partial bundle
      // The standard install still produced the full correct tree.
      expect(await vfs.exists('/app/node_modules/ms/package.json')).toBe(true);
    } finally {
      await closeServer(raw.server);
    }
  });

  it('[fault: false-fallback / provenance-lie] literal v2 incompleteness declines before adoption and runs standard', async () => {
    const literal = await literalV2Fixture();
    const controlServer = await startRaw((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/x-tar' });
      res.end(Buffer.from(literal.bundle));
    });
    try {
      const vfs = new LedgerVfs();
      await writeProject(vfs, literal.dependencies);
      const control = await installFixture(
        vfs,
        new LedgerRegistry([]),
        literal.dependencies,
        replayFaultCache('none').cache,
        [],
        controlServer.url,
      ).then(
        (value) => ({ status: 'resolved' as const, value }),
        (error: unknown) => ({ status: 'rejected' as const, error }),
      );
      expect.soft(control.status, 'unmodified literal v2 decodes').toBe('resolved');
      expect.soft(control.status === 'resolved' ? control.value.source : undefined).toBe('eddy');
    } finally {
      await closeServer(controlServer.server);
    }

    const contents = unpackEddyBundle(literal.bundle);
    contents.manifest.tarballs = contents.manifest.tarballs.filter((t) => t.name !== SOURCE);
    contents.tarballs = contents.tarballs.filter((t) => t.entry.name !== SOURCE);
    const raw = await startRaw((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/x-tar' });
      res.end(Buffer.from(packEddyBundle(contents)));
    });
    const warnings: string[] = [];
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation((...args) => {
      warnings.push(args.map(String).join(' '));
    });
    try {
      const vfs = new LedgerVfs();
      await writeProject(vfs, literal.dependencies);
      const registry = new LedgerRegistry(literal.entries);
      const result = await installFixture(
        vfs,
        registry,
        literal.dependencies,
        replayFaultCache('none').cache,
        [],
        raw.url,
      );
      expect(result.source).toBe('standard');
      expect(warnings).toEqual([
        expect.stringContaining(`bundle omits the tarball for ${SOURCE}@${SOURCE_VERSION}`),
      ]);
      expect(registry.packumentReads.length + registry.tarballReads.length).toBeGreaterThan(0);
      expect(await vfs.exists('/project/node_modules/lightningcss/package.json')).toBe(true);
    } finally {
      warnSpy.mockRestore();
      await closeServer(raw.server);
    }
  });

  it.each(['missing', 'corrupt'] as const)(
    '[fault: poisoned-cache / false-fallback] adopted literal v2 replay rejects a %s parent with no effects',
    async (fault) => {
      const literal = await literalV2Fixture();
      const raw = await startRaw((_req, res) => {
        res.writeHead(200, { 'content-type': 'application/x-tar' });
        res.end(Buffer.from(literal.bundle));
      });
      try {
        const vfs = new LedgerVfs();
        await writeProject(vfs, literal.dependencies);
        vfs.clearLedger();
        const registry = new LedgerRegistry(literal.entries);
        const replayCache = replayFaultCache(fault);
        const reports: string[] = [];
        const outcome = await installFixture(
          vfs,
          registry,
          literal.dependencies,
          replayCache.cache,
          reports,
          raw.url,
        ).then(
          (value) => ({ status: 'resolved' as const, value }),
          (error: unknown) => ({ status: 'rejected' as const, error }),
        );
        const error = outcome.status === 'rejected' ? outcome.error : undefined;
        expect.soft(outcome.status).toBe('rejected');
        expect
          .soft({
            code: (error as { code?: unknown } | undefined)?.code,
            reason: (error as { reason?: unknown } | undefined)?.reason,
          })
          .toEqual({ code: 'EBROKENLOCK', reason: 'shadow-trace-drift' });
        expect.soft(registry.packumentReads).toEqual([]);
        expect.soft(registry.tarballReads).toEqual([]);
        const sourceKey = `${SOURCE}\0${SOURCE_VERSION}\0${SOURCE_INTEGRITY}`;
        expect.soft(replayCache.puts).toEqual([sourceKey]);
        expect.soft(replayCache.gets).toEqual([sourceKey, sourceKey]);
        expect.soft(reports).toEqual([]);
        expect.soft(vfs.mutations).toEqual([]);
        await expect.soft(vfs.exists('/project/package-lock.json')).resolves.toBe(false);
        await expect.soft(vfs.exists('/project/node_modules')).resolves.toBe(false);
      } finally {
        await closeServer(raw.server);
      }
    },
  );

  it('refuses a bundle whose manifest names DUPLICATE member files (two packages sharing one member)', async () => {
    // Regression (round 9): duplicate `file` values collapse in the client's
    // by-file map — debug's and ms's entries both point at ms's member, the
    // single member verifies against ms's integrity, the seeded-count check
    // compares collapsed sizes (1 === 1) and the completeness gate sees both
    // name@version in the manifest ARRAY — so the bundle ADOPTED as eddy with
    // debug's tarball never seeded (replayed from the ordinary registry).
    const built = await resolveBundle(
      { dependencies: { debug: '^4.4.1' } },
      { registryBaseUrl: LOCAL_REGISTRY_BASE_URL, fetch: makeLocalFetcher().fetch },
    );
    if (built.kind !== 'bundle') throw new Error('setup');
    const contents = unpackEddyBundle(built.bytes);
    const debugEntry = contents.manifest.tarballs.find((t) => t.name === 'debug');
    const msEntry = contents.manifest.tarballs.find((t) => t.name === 'ms');
    if (!debugEntry || !msEntry) throw new Error('setup: expected debug + ms tarballs');
    debugEntry.file = msEntry.file; // two required packages, one member file
    contents.tarballs = contents.tarballs.filter((t) => t.entry.name !== 'debug');
    const malformed = packEddyBundle(contents);
    const raw = await startRaw((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/x-tar' });
      res.end(Buffer.from(malformed));
    });
    try {
      const vfs = new MemoryVfs();
      await writePackageJson(vfs, { debug: '^4.4.1' });
      const { registry } = makeRegistry();
      const result = await install({ vfs, cwd: '/app', registry, resolverUrl: raw.url });
      expect(result.source).toBe('standard'); // declined, never a partial eddy adoption
      expect(result.closureHash).toBeUndefined();
      expect(await vfs.exists('/app/node_modules/debug/package.json')).toBe(true);
    } finally {
      await closeServer(raw.server);
    }
  });

  it('refuses a bundle whose lockfile entry lacks replay fields (resolved/integrity)', async () => {
    // Same class as the partial bundle: a lockfile the replay cannot satisfy
    // FROM THE BUNDLE must decline. The manifest hash is recomputed so the
    // self-consistency gate passes and THIS gate is what trips.
    const built = await resolveBundle(
      { dependencies: DEPS },
      { registryBaseUrl: LOCAL_REGISTRY_BASE_URL, fetch: makeLocalFetcher().fetch },
    );
    if (built.kind !== 'bundle') throw new Error('setup');
    const contents = unpackEddyBundle(built.bytes);
    const lf = JSON.parse(contents.lockfileText) as {
      packages: Record<string, { integrity?: string }>;
    };
    const victim = lf.packages['node_modules/ms'];
    expect(victim?.integrity).toBeDefined();
    if (victim) victim.integrity = undefined; // JSON.stringify drops it below
    contents.lockfileText = JSON.stringify(lf);
    contents.manifest.asOf.closureHash = await closureHashOf(
      lf as Parameters<typeof closureHashOf>[0],
    );
    const poisoned = packEddyBundle(contents);
    const raw = await startRaw((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/x-tar' });
      res.end(Buffer.from(poisoned));
    });
    try {
      const vfs = new MemoryVfs();
      await writePackageJson(vfs, DEPS);
      const { registry } = makeRegistry();
      const result = await install({ vfs, cwd: '/app', registry, resolverUrl: raw.url });
      expect(result.source).toBe('standard');
      expect(result.closureHash).toBeUndefined();
      expect(await vfs.exists('/app/node_modules/ms/package.json')).toBe(true);
    } finally {
      await closeServer(raw.server);
    }
  });

  it('refuses a bundle whose manifest closureHash does not match its own lockfile (content-addressed self-consistency)', async () => {
    // A divergent/buggy resolver stamps a manifest hash the lockfile does not
    // produce. Integrity+coverage pass, but the bundle lies about its identity —
    // adopting it would learn a pin that dereferences to nothing. Refuse it.
    const built = await resolveBundle(
      { dependencies: DEPS },
      { registryBaseUrl: LOCAL_REGISTRY_BASE_URL, fetch: makeLocalFetcher().fetch },
    );
    if (built.kind !== 'bundle') throw new Error('setup');
    const contents = unpackEddyBundle(built.bytes);
    contents.manifest.asOf.closureHash = 'sha256-liar'; // ≠ closureHashOf(its lockfile)
    const poisoned = packEddyBundle(contents);
    const raw = await startRaw((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/x-tar' });
      res.end(Buffer.from(poisoned));
    });
    try {
      const vfs = new MemoryVfs();
      await writePackageJson(vfs, DEPS);
      const { registry } = makeRegistry();
      const result = await install({ vfs, cwd: '/app', registry, resolverUrl: raw.url });
      expect(result.source).toBe('standard'); // refused → fell back
      expect(result.closureHash).toBeUndefined();
      expect(await vfs.exists('/app/node_modules/debug/package.json')).toBe(true);
    } finally {
      await closeServer(raw.server);
    }
  });

  it("prefer:'online' bypasses the pinned GET — only the fresh POST recompute runs (round 13)", async () => {
    // `prefer:'online'` promises a FRESH server-side recompute; a pinned
    // content-addressed GET serves a CACHED closure — pre-fix it was consulted
    // first and a hit skipped the recompute entirely.
    const bytes = await buildBundleFor(DEPS);
    const hash = unpackEddyBundle(bytes).manifest.asOf.closureHash;
    let gets = 0;
    let posts = 0;
    let postPrefer: unknown;
    const raw = await startRaw((req, res) => {
      if (req.method === 'GET') {
        gets++;
        res.writeHead(200, { 'content-type': 'application/x-tar' });
        res.end(Buffer.from(bytes));
        return;
      }
      posts++;
      let body = '';
      req.on('data', (c: Buffer) => {
        body += c.toString('utf8');
      });
      req.on('end', () => {
        postPrefer = (JSON.parse(body) as { prefer?: string }).prefer;
        res.writeHead(200, { 'content-type': 'application/x-tar' });
        res.end(Buffer.from(bytes));
      });
    });
    try {
      const vfs = new MemoryVfs();
      await writePackageJson(vfs, DEPS);
      const { registry } = makeRegistry();
      const result = await install({
        vfs,
        cwd: '/app',
        registry,
        resolverUrl: raw.url,
        resolverClosureHash: hash, // a SATISFYING pin — would hit if consulted
        prefer: 'online',
      });
      expect(result.source).toBe('eddy');
      expect(gets).toBe(0); // the pin was bypassed…
      expect(posts).toBe(1); // …in favour of ONE fresh recompute
      expect(postPrefer).toBe('online'); // which bypasses the server's mutable tier too
    } finally {
      await closeServer(raw.server);
    }
  });

  it("prefer:'online' never consumes a prefetch — a boot-time response is not a fresh recompute (round 13)", async () => {
    const bytes = await buildBundleFor(DEPS);
    const hash = unpackEddyBundle(bytes).manifest.asOf.closureHash;
    let gets = 0;
    let posts = 0;
    const raw = await startRaw((req, res) => {
      if (req.method === 'GET') gets++;
      else posts++;
      res.writeHead(200, { 'content-type': 'application/x-tar' });
      res.end(Buffer.from(bytes));
    });
    try {
      const vfs = new MemoryVfs();
      await writePackageJson(vfs, DEPS);
      const { registry } = makeRegistry();
      const handle = startEddyPrefetch({
        resolverUrl: raw.url,
        request: { dependencies: DEPS, optionalDependencies: {} },
        prefer: 'online',
        closureHash: hash, // ignored under online: the prefetch POSTs, never GETs
      });
      const take = vi.fn(handle.take.bind(handle));
      const result = await install({
        vfs,
        cwd: '/app',
        registry,
        resolverUrl: raw.url,
        resolverPrefetch: {
          ...(handle.closureHash ? { closureHash: handle.closureHash } : {}),
          take,
        },
        prefer: 'online',
      });
      expect(result.source).toBe('eddy');
      expect(take).not.toHaveBeenCalled(); // online install ignores ANY prefetch
      expect(gets).toBe(0); // and no pinned GET fired anywhere
      expect(posts).toBe(2); // the (untaken) prefetch POST + the install's own fresh POST
    } finally {
      await closeServer(raw.server);
    }
  });

  it('a resolver that never sends response HEADERS does not hang install — the header bound fails the attempt, standard runs (round 13)', async () => {
    // `resolverStallTimeoutMs` used to start only once a BODY existed; a fetch
    // whose connection/headers hang parked `npm install` forever.
    const raw = await startRaw(() => {
      // hold the socket open, never write a response
    });
    try {
      const vfs = new MemoryVfs();
      await writePackageJson(vfs, DEPS);
      const { registry } = makeRegistry();
      const result = await install({
        vfs,
        cwd: '/app',
        registry,
        resolverUrl: raw.url,
        resolverStallTimeoutMs: 50,
      });
      expect(result.source ?? 'standard').toBe('standard');
      expect(await vfs.exists('/app/node_modules/debug/package.json')).toBe(true);
    } finally {
      await closeServer(raw.server);
    }
  });

  it('a link failure AFTER bundle adoption leaves the PREVIOUS lockfile untouched (staged, never pre-committed — round 13)', async () => {
    // Pre-fix, adoption committed the bundle lockfile to disk BEFORE link +
    // shims ran; a failure there left the resolver's lockfile in the project
    // instead of the user's previous one.
    const vfs = new MemoryVfs();
    await writePackageJson(vfs, DEPS);
    const previous = `${JSON.stringify(
      { name: 'app', version: '1.0.0', lockfileVersion: 3, packages: { '': { dependencies: {} } } },
      null,
      2,
    )}\n`;
    await vfs.writeFile('/app/package-lock.json', previous);
    // node_modules writes fail (quota-class) only AFTER adoption succeeded —
    // the tarball cache lives under /.rifty and stays writable.
    const failing = new Proxy(vfs, {
      get(target, prop, receiver) {
        if (prop === 'writeFile' || prop === 'mkdir') {
          return async (path: string, ...rest: unknown[]) => {
            if (String(path).includes('/node_modules/')) {
              throw new Error('node_modules write boom');
            }
            return (
              target[prop as 'writeFile'] as unknown as (...a: unknown[]) => Promise<void>
            ).call(target, path, ...rest);
          };
        }
        const v = Reflect.get(target, prop, receiver);
        return typeof v === 'function' ? v.bind(target) : v;
      },
    }) as unknown as MemoryVfs;
    const { registry } = makeRegistry();
    await expect(
      install({ vfs: failing, cwd: '/app', registry, resolverUrl: eddyUrl }),
    ).rejects.toThrow(/node_modules write boom/);
    expect(await vfs.readFileText('/app/package-lock.json')).toBe(previous);
  });
});
