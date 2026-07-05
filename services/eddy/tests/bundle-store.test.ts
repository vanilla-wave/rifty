/**
 * BundleStore (ADR-0194 §4–5): the immutable `closureHash → bundle` tier
 * behind `EddyCache`. Memory implementation here; the S3 one lives in
 * `s3-bundle-store.test.ts`. Plus the cache↔store contract: durable-before-
 * link, store-hit skips put, failed put degrades (no link, no 500).
 */
import type { EddyBundleManifestV1 } from '@riftydev/npm-client';
import { describe, expect, it, vi } from 'vitest';
import {
  LOCAL_REGISTRY_BASE_URL,
  makeLocalFetcher,
} from '../../../tests/integration/fixtures/local-registry.ts';
import { type BundleStore, MemoryBundleStore } from '../src/bundle-store.ts';
import { EddyCache } from '../src/cache.ts';
import { resolveBundle } from '../src/resolver.ts';

const manifestFor = (hash: string): EddyBundleManifestV1 => ({
  format: 'EddyBundleV1',
  npmClientVersion: '0.0.0',
  asOf: { resolvedAt: 'now', registry: 'r', closureHash: hash },
  tarballs: [],
});

const bundle = (hash: string, size: number) => ({
  bytes: new Uint8Array(size),
  manifest: manifestFor(hash),
});

describe('MemoryBundleStore', () => {
  it('round-trips get/put', async () => {
    const store = new MemoryBundleStore({ maxBytes: 1024 });
    expect(await store.get('sha256-a')).toBeNull();
    await store.put('sha256-a', bundle('sha256-a', 8));
    expect((await store.get('sha256-a'))?.manifest.asOf.closureHash).toBe('sha256-a');
  });

  it('evicts least-recently-used bundles once over the byte cap (get promotes)', async () => {
    const store = new MemoryBundleStore({ maxBytes: 20 });
    await store.put('sha256-a', bundle('sha256-a', 8));
    await store.put('sha256-b', bundle('sha256-b', 8));
    await store.get('sha256-a'); // promote a
    await store.put('sha256-c', bundle('sha256-c', 8)); // evicts b
    expect(await store.get('sha256-b')).toBeNull();
    expect(await store.get('sha256-a')).not.toBeNull();
    expect(await store.get('sha256-c')).not.toBeNull();
  });

  it('an over-cap bundle REJECTS the put (durable-or-throw) and evicts nothing', async () => {
    // A silent return here published unservable hashes: cache.ts linked the
    // hash after an apparently-successful put, then GET-by-hash 404'd forever.
    const store = new MemoryBundleStore({ maxBytes: 10 });
    await store.put('sha256-a', bundle('sha256-a', 8));
    await expect(store.put('sha256-big', bundle('sha256-big', 64))).rejects.toThrow(
      /exceeds the memory store cap/,
    );
    expect(await store.get('sha256-big')).toBeNull();
    expect(await store.get('sha256-a')).not.toBeNull();
  });
});

describe('EddyCache ↔ BundleStore contract (ADR-0194 §5)', () => {
  function recordingStore(inner: BundleStore, log: string[]): BundleStore {
    return {
      get: (h) => {
        log.push(`get ${h}`);
        return inner.get(h);
      },
      put: (h, b) => {
        log.push(`put ${h}`);
        return inner.put(h, b);
      },
    };
  }

  it('a cold resolve puts the bundle into the store BEFORE returning (durable-before-link)', async () => {
    const { fetch } = makeLocalFetcher();
    const log: string[] = [];
    const store = recordingStore(new MemoryBundleStore({ maxBytes: 1024 * 1024 }), log);
    const cache = new EddyCache({
      resolver: { registryBaseUrl: LOCAL_REGISTRY_BASE_URL, fetch },
      store,
    });
    const result = await cache.resolve({ dependencies: { debug: '^4.4.1' } });
    expect(result.kind).toBe('bundle');
    if (result.kind !== 'bundle') return;
    const hash = result.manifest.asOf.closureHash;
    expect(log).toContain(`put ${hash}`);
    // getBundle serves the stored bytes.
    const hit = await cache.getBundle(hash);
    expect(hit).not.toBeNull();
    expect([...(hit as { bytes: Uint8Array }).bytes]).toEqual([...result.bytes]);
  });

  it('a compute whose closure reads as a store miss (corrupt/foreign object) re-puts to heal it', async () => {
    const { fetch } = makeLocalFetcher();
    let puts = 0;
    // The key holds a poisoned object: get() reads it as a miss. A HEAD-exists
    // gate would have said "present" and skipped the put, never healing it — so
    // compute must put unconditionally (the store dedups a genuine no-op upload).
    const store: BundleStore = {
      get: async () => null,
      put: async () => {
        puts++;
      },
    };
    const cache = new EddyCache({
      resolver: { registryBaseUrl: LOCAL_REGISTRY_BASE_URL, fetch },
      store,
    });
    const result = await cache.resolve({ dependencies: { debug: '^4.4.1' } });
    expect(result.kind).toBe('bundle');
    expect(puts).toBe(1); // re-seeded, not skipped
  });

  it('resolve settles only AFTER the store put settles (durable-before-link is awaited, not fire-and-forget)', async () => {
    const { fetch } = makeLocalFetcher();
    const events: string[] = [];
    const store: BundleStore = {
      get: async () => null,
      put: async () => {
        await new Promise((r) => setTimeout(r, 20));
        events.push('put-settled');
      },
    };
    const cache = new EddyCache({
      resolver: { registryBaseUrl: LOCAL_REGISTRY_BASE_URL, fetch },
      store,
    });
    const result = await cache.resolve({ dependencies: { debug: '^4.4.1' } });
    events.push('resolved');
    expect(result.kind).toBe('bundle');
    expect(events).toEqual(['put-settled', 'resolved']);
  });

  it('a cold recompute of an ALREADY-STORED closure serves the stored artifact — no re-put, byte-stable immutable tier (round 15)', async () => {
    const { fetch } = makeLocalFetcher();
    const log: string[] = [];
    const store = recordingStore(new MemoryBundleStore({ maxBytes: 1024 * 1024 }), log);
    let nowMs = 1_000_000;
    const cache = new EddyCache({
      resolver: { registryBaseUrl: LOCAL_REGISTRY_BASE_URL, fetch },
      store,
      ttlSeconds: 60,
      clock: () => nowMs,
    });
    const first = await cache.resolve({ dependencies: { debug: '^4.4.1' } });
    expect(log.filter((l) => l.startsWith('put ')).length).toBe(1);
    nowMs += 61_000; // expire the mutable link → recompute, same closure
    const again = await cache.resolve({ dependencies: { debug: '^4.4.1' } });
    expect(again.kind).toBe('bundle');
    // The recompute gate is a VERIFIED store.get, not a HEAD-exists check
    // (ADR-0194 §5: existence can't tell a valid object from a poisoned one;
    // the S3 get() fully content-addresses, so a poisoned key still reads as
    // a MISS → the put path re-seeds it). A verified hit is served AS-IS —
    // re-putting fresh bytes (new `asOf.resolvedAt`) would let the immutable
    // GET URL serve different bytes than a browser/CDN already holds.
    expect(log.filter((l) => l.startsWith('put ')).length).toBe(1);
    if (first.kind === 'bundle' && again.kind === 'bundle') {
      expect([...again.bytes]).toEqual([...first.bytes]);
    }
  });

  it('an OVER-CAP bundle never becomes a servable GET-by-hash or a mutable link (degrades, no 500)', async () => {
    // End-to-end through a REAL MemoryBundleStore with a tiny cap: the resolve
    // still serves the computed bundle, but the hash must NOT be published —
    // getBundle misses (no unservable "linked" hash) and the next resolve
    // recomputes (no mutable link was written).
    const { fetch } = makeLocalFetcher();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const store = new MemoryBundleStore({ maxBytes: 16 }); // every real bundle is over-cap
      let computes = 0;
      const cache = new EddyCache({
        resolver: { registryBaseUrl: LOCAL_REGISTRY_BASE_URL, fetch },
        store,
        resolveFn: (req, deps) => {
          computes++;
          return resolveBundle(req, deps);
        },
      });
      const first = await cache.resolve({ dependencies: { debug: '^4.4.1' } });
      expect(first.kind).toBe('bundle');
      if (first.kind !== 'bundle') return;
      expect(await cache.getBundle(first.manifest.asOf.closureHash)).toBeNull();
      const second = await cache.resolve({ dependencies: { debug: '^4.4.1' } });
      expect(second.kind).toBe('bundle');
      expect(computes).toBe(2); // no link survived → full recompute, not a cache hit
      // LOUD, never silent (Fidelity): the drop is visible in the server log.
      expect(errSpy.mock.calls.some((c) => /exceeds the memory store cap/.test(c.join(' ')))).toBe(
        true,
      );
    } finally {
      errSpy.mockRestore();
    }
  });

  it('a THROWING store read on a fresh mutable link degrades to recompute — the POST never 500s while the registry is up', async () => {
    // First resolve computes + links; then the store starts THROWING on reads
    // (bucket down). The linked resolve must treat that as a miss and
    // recompute (it has the dep-set), not propagate a 500 through server.ts.
    const { fetch } = makeLocalFetcher();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      let reads = 0;
      let computes = 0;
      const store: BundleStore = {
        get: async () => {
          reads++;
          throw new Error('bucket down');
        },
        put: async () => {},
      };
      const cache = new EddyCache({
        resolver: { registryBaseUrl: LOCAL_REGISTRY_BASE_URL, fetch },
        store,
        resolveFn: (req, deps) => {
          computes++;
          return resolveBundle(req, deps);
        },
      });
      const first = await cache.resolve({ dependencies: { debug: '^4.4.1' } });
      expect(first.kind).toBe('bundle');
      const second = await cache.resolve({ dependencies: { debug: '^4.4.1' } }); // fresh link → throwing read
      expect(second.kind).toBe('bundle'); // degraded to recompute, never a throw
      expect(reads).toBeGreaterThan(0);
      expect(computes).toBe(2);
      expect(errSpy.mock.calls.some((c) => /bucket down.*recomputing/s.test(c.join(' ')))).toBe(
        true,
      );
    } finally {
      errSpy.mockRestore();
    }
  });

  it('a failed store put still serves the computed bundle and does NOT link it (recompute next time)', async () => {
    const { fetch } = makeLocalFetcher();
    let puts = 0;
    const store: BundleStore = {
      get: async () => null,
      put: async () => {
        puts++;
        throw new Error('bucket down');
      },
    };
    const cache = new EddyCache({
      resolver: { registryBaseUrl: LOCAL_REGISTRY_BASE_URL, fetch },
      store,
    });
    const first = await cache.resolve({ dependencies: { debug: '^4.4.1' } });
    expect(first.kind).toBe('bundle'); // degraded, never a throw
    const second = await cache.resolve({ dependencies: { debug: '^4.4.1' } });
    expect(second.kind).toBe('bundle');
    expect(puts).toBe(2); // no mutable link was written → full recompute + retry put
  });
});
