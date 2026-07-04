/**
 * Process-wide resolve caches (ADR-0194 §1–3): packument TTL cache, immutable
 * byte-bounded tarball cache, and single-flight per dep-set. Counters come from
 * the vendored fixture registry (`makeLocalFetcher`), so every assertion is on
 * REAL upstream traffic, not mocks.
 */
import { describe, expect, it } from 'vitest';
import {
  LOCAL_REGISTRY_BASE_URL,
  makeLocalFetcher,
} from '../../../tests/integration/fixtures/local-registry.ts';
import { MemoryBundleStore } from '../src/bundle-store.ts';
import { EddyCache } from '../src/cache.ts';
import type { EddyResolveResult } from '../src/resolver.ts';
import { resolveBundle } from '../src/resolver.ts';
import { MemoryTarballCache, TtlPackumentCache } from '../src/shared-caches.ts';

const packument = (name: string) =>
  ({ name, 'dist-tags': {}, versions: {} }) as unknown as Parameters<TtlPackumentCache['set']>[1];

const okBundle = (closureHash: string): EddyResolveResult => ({
  kind: 'bundle',
  bytes: new Uint8Array([1]),
  manifest: {
    format: 'EddyBundleV1',
    npmClientVersion: '0.0.0',
    asOf: { resolvedAt: 't', registry: 'r', closureHash },
    tarballs: [],
  },
});

function makeCache(overrides: Partial<ConstructorParameters<typeof EddyCache>[0]> = {}) {
  const { fetch, calls } = makeLocalFetcher();
  const cache = new EddyCache({
    resolver: { registryBaseUrl: LOCAL_REGISTRY_BASE_URL, fetch },
    ...overrides,
  });
  return { cache, calls };
}

describe('shared caches across resolves (ADR-0194 §1–2)', () => {
  it('an overlapping UNSEEN dep set refetches only the non-overlapping packages', async () => {
    const { cache, calls } = makeCache();
    // debug pulls ms — two packuments, two tarballs.
    await cache.resolve({ dependencies: { debug: '^4.4.1' } });
    const packumentsAfterFirst = calls.packument;
    const tarballsAfterFirst = calls.tarball;
    expect(packumentsAfterFirst).toBeGreaterThan(0);

    // Different dep set (different depSetKey) overlapping debug+ms: only kleur
    // is new upstream traffic.
    const second = await cache.resolve({ dependencies: { debug: '^4.4.1', kleur: '4.1.5' } });
    expect(second.kind).toBe('bundle');
    expect(calls.packument - packumentsAfterFirst).toBe(1);
    expect(calls.tarball - tarballsAfterFirst).toBe(1);
  });

  it('a mutable-TTL recompute refetches packuments only — tarballs re-pack from the shared cache', async () => {
    let nowMs = 1_000_000;
    const { cache, calls } = makeCache({
      ttlSeconds: 60,
      packumentTtlSeconds: 30,
      clock: () => nowMs,
    });
    const first = await cache.resolve({ dependencies: { debug: '^4.4.1' } });
    expect(first.kind).toBe('bundle');
    const packumentsAfterFirst = calls.packument;
    const tarballsAfterFirst = calls.tarball;

    nowMs += 61_000; // past the mutable TTL AND the packument TTL
    const second = await cache.resolve({ dependencies: { debug: '^4.4.1' } });
    expect(second.kind).toBe('bundle');
    expect(calls.packument).toBeGreaterThan(packumentsAfterFirst); // fresh resolution
    expect(calls.tarball).toBe(tarballsAfterFirst); // immutable bytes reused
    if (first.kind === 'bundle' && second.kind === 'bundle') {
      expect(second.manifest.asOf.closureHash).toBe(first.manifest.asOf.closureHash);
    }
  });

  it('packuments are served from the TTL cache within the window', async () => {
    let nowMs = 1_000_000;
    const { cache, calls } = makeCache({
      ttlSeconds: 1, // mutable link expires almost immediately
      packumentTtlSeconds: 300,
      clock: () => nowMs,
    });
    await cache.resolve({ dependencies: { debug: '^4.4.1' } });
    const packumentsAfterFirst = calls.packument;
    nowMs += 2_000; // past the mutable TTL, within the packument TTL
    await cache.resolve({ dependencies: { debug: '^4.4.1' } });
    expect(calls.packument).toBe(packumentsAfterFirst); // recompute, zero packument traffic
  });

  it("prefer:'online' bypasses the shared packument cache but still reuses immutable tarballs", async () => {
    const { cache, calls } = makeCache();
    await cache.resolve({ dependencies: { debug: '^4.4.1' } });
    const packumentsAfterFirst = calls.packument;
    const tarballsAfterFirst = calls.tarball;

    const online = await cache.resolve({ dependencies: { debug: '^4.4.1' }, prefer: 'online' });
    expect(online.kind).toBe('bundle');
    expect(calls.packument).toBeGreaterThan(packumentsAfterFirst); // staleness check forced
    expect(calls.tarball).toBe(tarballsAfterFirst); // content-addressed reuse is safe
  });

  it("an 'online' recompute refreshes the shared packument cache (write-through)", async () => {
    const { cache, calls } = makeCache();
    await cache.resolve({ dependencies: { debug: '^4.4.1' }, prefer: 'online' });
    const packumentsAfterOnline = calls.packument;
    // A later cached-policy resolve of a DIFFERENT overlapping set reads the
    // packuments the online pass wrote through.
    await cache.resolve({ dependencies: { debug: '^4.4.1', kleur: '4.1.5' } });
    expect(calls.packument - packumentsAfterOnline).toBe(1); // only kleur
  });

  it('a late STALE cached flight cannot repollute the shared packument cache after a newer online refresh (metadata race)', async () => {
    // Publish/dist-tag race: a cached resolve (started FIRST, fetched stale
    // metadata) writes through LAST, after a newer prefer:'online' refresh wrote
    // fresh metadata. The shared cache must NOT roll back.
    const { fetch } = makeLocalFetcher();
    let releaseCached = (): void => {};
    let releaseOnline = (): void => {};
    const cachedGate = new Promise<void>((r) => {
      releaseCached = r;
    });
    const onlineGate = new Promise<void>((r) => {
      releaseOnline = r;
    });
    const fresh = packument('debug-fresh');
    const stale = packument('debug-stale');
    let readShared: (name: string) => { name: string } | undefined = () => undefined;
    const cache = new EddyCache({
      resolver: { registryBaseUrl: LOCAL_REGISTRY_BASE_URL, fetch },
      store: new MemoryBundleStore({ maxBytes: 1024 }),
      resolveFn: async (req, deps) => {
        readShared = (name) => deps.packumentCache?.get(name); // adapter.get → shared cache
        if (req.prefer === 'online') {
          await onlineGate;
          deps.packumentCache?.set('debug', fresh); // newer generation
          return okBundle('sha256-NEW');
        }
        await cachedGate;
        deps.packumentCache?.set('debug', stale); // older generation → must be dropped
        return okBundle('sha256-OLD');
      },
    });

    const cachedP = cache.resolve({ dependencies: { debug: '^4.4.1' } }); // gen1
    const onlineP = cache.resolve({ dependencies: { debug: '^4.4.1' }, prefer: 'online' }); // gen2
    releaseOnline();
    await onlineP; // writes FRESH (gen2)
    releaseCached();
    await cachedP; // writes STALE (gen1) → dropped by the generation guard

    expect(readShared('debug')?.name).toBe('debug-fresh');
  });

  it('a zero-capacity shared tarball cache never breaks a resolve (per-request layer holds the bytes)', async () => {
    const { cache } = makeCache({ tarballCacheMaxBytes: 1 });
    const result = await cache.resolve({ dependencies: { debug: '^4.4.1' } });
    expect(result.kind).toBe('bundle');
  });
});

describe('single-flight per depSetKey (ADR-0194 §3)', () => {
  it('concurrent identical requests compute once and share the bundle', async () => {
    const { fetch } = makeLocalFetcher();
    let computes = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const cache = new EddyCache({
      resolver: { registryBaseUrl: LOCAL_REGISTRY_BASE_URL, fetch },
      resolveFn: async (req, deps) => {
        computes++;
        await gate;
        return resolveBundle(req, deps);
      },
    });
    const a = cache.resolve({ dependencies: { debug: '^4.4.1' } });
    const b = cache.resolve({ dependencies: { debug: '^4.4.1' } });
    release();
    const [ra, rb] = await Promise.all([a, b]);
    expect(computes).toBe(1);
    if (ra.kind === 'bundle' && rb.kind === 'bundle') {
      expect([...rb.bytes]).toEqual([...ra.bytes]);
    } else {
      expect.unreachable('expected bundles');
    }
  });

  it('different dep sets do not share a flight', async () => {
    const { fetch } = makeLocalFetcher();
    let computes = 0;
    const cache = new EddyCache({
      resolver: { registryBaseUrl: LOCAL_REGISTRY_BASE_URL, fetch },
      resolveFn: async (req, deps) => {
        computes++;
        return resolveBundle(req, deps);
      },
    });
    await Promise.all([
      cache.resolve({ dependencies: { debug: '^4.4.1' } }),
      cache.resolve({ dependencies: { kleur: '4.1.5' } }),
    ]);
    expect(computes).toBe(2);
  });

  it("prefer:'online' never joins an in-flight cached compute (it may read TTL-cached packuments)", async () => {
    const { fetch } = makeLocalFetcher();
    let computes = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const cache = new EddyCache({
      resolver: { registryBaseUrl: LOCAL_REGISTRY_BASE_URL, fetch },
      resolveFn: async (req, deps) => {
        computes++;
        await gate;
        return resolveBundle(req, deps);
      },
    });
    const cached = cache.resolve({ dependencies: { debug: '^4.4.1' } });
    const online = cache.resolve({ dependencies: { debug: '^4.4.1' }, prefer: 'online' });
    release();
    await Promise.all([cached, online]);
    expect(computes).toBe(2);
  });

  it('a failed flight is not cached — the next request recomputes', async () => {
    const { fetch } = makeLocalFetcher();
    let computes = 0;
    const cache = new EddyCache({
      resolver: { registryBaseUrl: LOCAL_REGISTRY_BASE_URL, fetch },
      resolveFn: async (req, deps) => {
        computes++;
        if (computes === 1) throw new Error('upstream exploded');
        return resolveBundle(req, deps);
      },
    });
    await expect(cache.resolve({ dependencies: { debug: '^4.4.1' } })).rejects.toThrow(
      'upstream exploded',
    );
    const retry = await cache.resolve({ dependencies: { debug: '^4.4.1' } });
    expect(retry.kind).toBe('bundle');
    expect(computes).toBe(2);
  });
});

describe('TtlPackumentCache', () => {
  it('serves within TTL, expires after, 0 = disabled', () => {
    let nowMs = 0;
    const cache = new TtlPackumentCache({ ttlSeconds: 300, clock: () => nowMs });
    cache.set('debug', packument('debug'));
    nowMs += 299_000;
    expect(cache.get('debug')?.name).toBe('debug');
    nowMs += 2_000;
    expect(cache.get('debug')).toBeUndefined();

    const off = new TtlPackumentCache({ ttlSeconds: 0, clock: () => 0 });
    off.set('debug', packument('debug'));
    expect(off.get('debug')).toBeUndefined();
  });

  it('setWithGen: an older generation cannot roll back a newer live entry', () => {
    const cache = new TtlPackumentCache({ ttlSeconds: 300, clock: () => 0 });
    cache.setWithGen('debug', packument('new'), 2);
    cache.setWithGen('debug', packument('old'), 1); // older gen → dropped
    expect(cache.get('debug')?.name).toBe('new');
    cache.setWithGen('debug', packument('newer'), 3); // newer gen → writes
    expect(cache.get('debug')?.name).toBe('newer');
  });

  it('caps entries LRU (get promotes)', () => {
    const cache = new TtlPackumentCache({ ttlSeconds: 300, clock: () => 0, maxEntries: 2 });
    cache.set('a', packument('a'));
    cache.set('b', packument('b'));
    expect(cache.get('a')?.name).toBe('a'); // promote a
    cache.set('c', packument('c')); // evicts b
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')?.name).toBe('a');
    expect(cache.get('c')?.name).toBe('c');
  });
});

describe('MemoryTarballCache', () => {
  // Real sha512 SRI for the 3-byte payloads below, computed with node:crypto.
  const bytesA = new Uint8Array([1, 2, 3]);
  const bytesB = new Uint8Array([4, 5, 6]);
  const INTEGRITY_A =
    'sha512-J4ZMxSGalRp6blK4yN3faYHQmNoWWNliWMhwssiN+8tRhBrqFyoouvpqeXMRZVhGdwZgRclZ7Q+ZKWiNBN78KQ==';
  const INTEGRITY_B =
    'sha512-s865gsC+iS8hoWL/30bDQ6zxsdotWvJiLleH4OfnGepl01JSUUgu/2AnN351D2HVMJUcJaF9u6nIiwMRBeMNQw==';

  it('round-trips under the (name, version, integrity) key', async () => {
    const cache = new MemoryTarballCache({ maxBytes: 1024 });
    await cache.put('a', '1.0.0', INTEGRITY_A, bytesA);
    expect(await cache.get('a', '1.0.0', INTEGRITY_A)).toEqual(bytesA);
    expect(await cache.get('a', '1.0.1', INTEGRITY_A)).toBeNull();
  });

  it('refuses bytes that do not match the declared integrity (miss, like VfsTarballCache)', async () => {
    const cache = new MemoryTarballCache({ maxBytes: 1024 });
    await cache.put('a', '1.0.0', INTEGRITY_A, bytesB); // wrong bytes for that SRI
    expect(await cache.get('a', '1.0.0', INTEGRITY_A)).toBeNull();
  });

  it('evicts least-recently-used entries once over the byte cap', async () => {
    const cache = new MemoryTarballCache({ maxBytes: 5 }); // fits one 3-byte entry
    await cache.put('a', '1.0.0', INTEGRITY_A, bytesA);
    await cache.put('b', '1.0.0', INTEGRITY_B, bytesB); // evicts a
    expect(await cache.get('a', '1.0.0', INTEGRITY_A)).toBeNull();
    expect(await cache.get('b', '1.0.0', INTEGRITY_B)).toEqual(bytesB);
  });

  it('an entry larger than the cap is not stored (and evicts nothing)', async () => {
    const cache = new MemoryTarballCache({ maxBytes: 5 });
    await cache.put('a', '1.0.0', INTEGRITY_A, bytesA);
    const big = new Uint8Array(16);
    const INTEGRITY_BIG =
      'sha512-C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw==';
    await cache.put('big', '1.0.0', INTEGRITY_BIG, big);
    expect(await cache.get('a', '1.0.0', INTEGRITY_A)).toEqual(bytesA);
  });
});
