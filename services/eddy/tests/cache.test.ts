import { describe, expect, it } from 'vitest';
import {
  LOCAL_REGISTRY_BASE_URL,
  makeLocalFetcher,
} from '../../../tests/integration/fixtures/local-registry.ts';
import { type BundleStore, MemoryBundleStore } from '../src/bundle-store.ts';
import { EddyCache } from '../src/cache.ts';
import type { EddyResolveResult } from '../src/resolver.ts';
import { resolveBundle } from '../src/resolver.ts';

function bundleFor(closureHash: string): EddyResolveResult {
  return {
    kind: 'bundle',
    bytes: new Uint8Array([closureHash.length]),
    manifest: {
      format: 'EddyBundleV1',
      npmClientVersion: '0.0.0',
      asOf: { resolvedAt: 't', registry: 'r', closureHash },
      tarballs: [],
    },
  };
}

describe('EddyCache — two-tier (ADR-0182 §6)', () => {
  it('serves a repeat identical request from cache with zero upstream fetches', async () => {
    const { fetch, calls } = makeLocalFetcher();
    const cache = new EddyCache({ resolver: { registryBaseUrl: LOCAL_REGISTRY_BASE_URL, fetch } });

    const first = await cache.resolve({ dependencies: { debug: '^4.4.1' } });
    expect(first.kind).toBe('bundle');
    const afterFirst = calls.packument + calls.tarball;
    expect(afterFirst).toBeGreaterThan(0);

    const second = await cache.resolve({ dependencies: { debug: '^4.4.1' } });
    expect(second.kind).toBe('bundle');
    // No new upstream traffic — served from the immutable tier via the mutable lookup.
    expect(calls.packument + calls.tarball).toBe(afterFirst);
    // Byte-identical bundle.
    if (first.kind === 'bundle' && second.kind === 'bundle') {
      expect([...second.bytes]).toEqual([...first.bytes]);
    }
  });

  it('recomputes after the mutable TTL expires (traffic-free within the packument TTL — ADR-0194)', async () => {
    const { fetch } = makeLocalFetcher();
    let nowMs = 1_000_000;
    let computes = 0;
    const cache = new EddyCache({
      resolver: { registryBaseUrl: LOCAL_REGISTRY_BASE_URL, fetch },
      ttlSeconds: 60,
      clock: () => nowMs,
      resolveFn: async (req, deps) => {
        computes++;
        return resolveBundle(req, deps);
      },
    });
    await cache.resolve({ dependencies: { debug: '^4.4.1' } });
    expect(computes).toBe(1);
    nowMs += 61_000; // past TTL
    await cache.resolve({ dependencies: { debug: '^4.4.1' } });
    expect(computes).toBe(2);
  });

  it('prefer:online forces a recompute even within TTL', async () => {
    const { fetch, calls } = makeLocalFetcher();
    const cache = new EddyCache({ resolver: { registryBaseUrl: LOCAL_REGISTRY_BASE_URL, fetch } });
    await cache.resolve({ dependencies: { debug: '^4.4.1' } });
    const afterFirst = calls.packument + calls.tarball;
    await cache.resolve({ dependencies: { debug: '^4.4.1' }, prefer: 'online' });
    expect(calls.packument + calls.tarball).toBeGreaterThan(afterFirst);
  });

  it('a slow OLDER cached compute does not clobber the link a newer prefer:online refresh published (generation guard)', async () => {
    const { fetch } = makeLocalFetcher();
    let releaseCached = (): void => {};
    let releaseOnline = (): void => {};
    const cachedGate = new Promise<void>((r) => {
      releaseCached = r;
    });
    const onlineGate = new Promise<void>((r) => {
      releaseOnline = r;
    });
    const cache = new EddyCache({
      resolver: { registryBaseUrl: LOCAL_REGISTRY_BASE_URL, fetch },
      store: new MemoryBundleStore({ maxBytes: 1024 }),
      resolveFn: async (req) => {
        // The online compute reads FRESH → 'sha256-NEW'; the cached one reads
        // staler → 'sha256-OLD'. Gates make the online (started 2nd) FINISH
        // first and the cached (started 1st) finish LAST.
        if (req.prefer === 'online') {
          await onlineGate;
          return bundleFor('sha256-NEW');
        }
        await cachedGate;
        return bundleFor('sha256-OLD');
      },
    });

    const cachedP = cache.resolve({ dependencies: { debug: '^4.4.1' } }); // compute gen1
    const onlineP = cache.resolve({ dependencies: { debug: '^4.4.1' }, prefer: 'online' }); // gen2
    releaseOnline();
    const online = await onlineP;
    expect(online.kind === 'bundle' && online.manifest.asOf.closureHash).toBe('sha256-NEW');
    releaseCached(); // the older compute settles LAST — must not republish the stale link
    await cachedP;

    // A later cached resolve must reuse the FRESH online closure, not the stale one.
    const third = await cache.resolve({ dependencies: { debug: '^4.4.1' } });
    expect(third.kind === 'bundle' && third.manifest.asOf.closureHash).toBe('sha256-NEW');
  });

  it('a FRESHER compute whose store put FAILS kills the stale mutable link — the next cached request recomputes', async () => {
    // Regression (round 11): "failed put skips the link" is not enough when an
    // OLDER link already exists for the key — it outlived the fresher failed
    // compute, so a later cached request served the STALE closure from the
    // store instead of recomputing (contradicting the ADR-0194 degrade story).
    const { fetch } = makeLocalFetcher();
    let failPuts = false;
    let computes = 0;
    const store = new MemoryBundleStore({ maxBytes: 1024 });
    const flaky: BundleStore = {
      get: (hash) => store.get(hash),
      put: async (hash, bundle) => {
        if (failPuts) throw new Error('bucket down');
        await store.put(hash, bundle);
      },
    };
    const cache = new EddyCache({
      resolver: { registryBaseUrl: LOCAL_REGISTRY_BASE_URL, fetch },
      store: flaky,
      resolveFn: async () => {
        computes++;
        return bundleFor(computes === 1 ? 'sha256-OLD' : 'sha256-NEW');
      },
    });
    const first = await cache.resolve({ dependencies: { debug: '^4.4.1' } }); // link → OLD (put ok)
    expect(first.kind === 'bundle' && first.manifest.asOf.closureHash).toBe('sha256-OLD');
    failPuts = true;
    const refresh = await cache.resolve({ dependencies: { debug: '^4.4.1' }, prefer: 'online' });
    expect(refresh.kind === 'bundle' && refresh.manifest.asOf.closureHash).toBe('sha256-NEW'); // degrade serves the computed bundle
    failPuts = false;
    // Pre-fix this served sha256-OLD straight from the store (stale link hit).
    const third = await cache.resolve({ dependencies: { debug: '^4.4.1' } });
    expect(third.kind === 'bundle' && third.manifest.asOf.closureHash).toBe('sha256-NEW');
    expect(computes).toBe(3); // recompute + put retry, never the stale closure
  });

  it('an OLDER compute whose put fails does NOT kill the link a NEWER refresh published (generation guard on the kill)', async () => {
    const { fetch } = makeLocalFetcher();
    let releaseCached = (): void => {};
    let releaseOnline = (): void => {};
    const cachedGate = new Promise<void>((r) => {
      releaseCached = r;
    });
    const onlineGate = new Promise<void>((r) => {
      releaseOnline = r;
    });
    let computes = 0;
    const store = new MemoryBundleStore({ maxBytes: 1024 });
    const flaky: BundleStore = {
      get: (hash) => store.get(hash),
      put: async (hash, bundle) => {
        // Only the OLDER compute's closure fails to store.
        if (hash === 'sha256-OLD') throw new Error('bucket down');
        await store.put(hash, bundle);
      },
    };
    const cache = new EddyCache({
      resolver: { registryBaseUrl: LOCAL_REGISTRY_BASE_URL, fetch },
      store: flaky,
      resolveFn: async (req) => {
        computes++;
        if (req.prefer === 'online') {
          await onlineGate;
          return bundleFor('sha256-NEW');
        }
        await cachedGate;
        return bundleFor('sha256-OLD');
      },
    });

    const cachedP = cache.resolve({ dependencies: { debug: '^4.4.1' } }); // gen1, will put-fail
    const onlineP = cache.resolve({ dependencies: { debug: '^4.4.1' }, prefer: 'online' }); // gen2
    releaseOnline();
    const online = await onlineP;
    expect(online.kind === 'bundle' && online.manifest.asOf.closureHash).toBe('sha256-NEW');
    releaseCached(); // older compute settles LAST; its failed put must not tear down the gen2 link
    await cachedP;

    const third = await cache.resolve({ dependencies: { debug: '^4.4.1' } });
    expect(third.kind === 'bundle' && third.manifest.asOf.closureHash).toBe('sha256-NEW');
    expect(computes).toBe(2); // served via the surviving link + store hit, no recompute
  });

  it('a TTL recompute of the SAME closure serves the ORIGINAL stored bytes — the immutable GET URL never changes bytes (round 15)', async () => {
    // The closure hash addresses the lockfile CLOSURE, not the tar bytes: a
    // recompute packs a fresh `asOf.resolvedAt`, so overwriting the store
    // would let the one-year-immutable `/bundle/<hash>` URL serve different
    // bytes than a browser/CDN already holds for the same hash.
    const { fetch } = makeLocalFetcher();
    let nowMs = 1_000_000;
    let resolutions = 0;
    const cache = new EddyCache({
      resolver: {
        registryBaseUrl: LOCAL_REGISTRY_BASE_URL,
        fetch,
        // Distinct per compute — exactly what varies on a real recompute.
        now: () => new Date(1_700_000_000_000 + ++resolutions * 60_000).toISOString(),
      },
      ttlSeconds: 60,
      clock: () => nowMs,
    });
    const first = await cache.resolve({ dependencies: { debug: '^4.4.1' } });
    expect(first.kind).toBe('bundle');
    if (first.kind !== 'bundle') return;
    nowMs += 61_000; // past the mutable TTL → full recompute with a fresh resolvedAt
    const second = await cache.resolve({ dependencies: { debug: '^4.4.1' } });
    expect(second.kind).toBe('bundle');
    if (second.kind !== 'bundle') return;
    // The FIRST stored artifact wins: original as-of stamp (ADR-0194 —
    // staleness visible, never silently refreshed), byte-identical answer…
    expect(second.manifest.asOf.resolvedAt).toBe(first.manifest.asOf.resolvedAt);
    expect([...second.bytes]).toEqual([...first.bytes]);
    // …and the immutable tier itself never changed under the hash.
    const got = await cache.getBundle(first.manifest.asOf.closureHash);
    expect([...(got?.bytes ?? [])]).toEqual([...first.bytes]);
  });

  it('getBundle returns the immutable-tier bundle by closure hash, null for unknown', async () => {
    const { fetch } = makeLocalFetcher();
    const cache = new EddyCache({ resolver: { registryBaseUrl: LOCAL_REGISTRY_BASE_URL, fetch } });
    const result = await cache.resolve({ dependencies: { debug: '^4.4.1' } });
    expect(result.kind).toBe('bundle');
    if (result.kind !== 'bundle') return;
    const hit = await cache.getBundle(result.manifest.asOf.closureHash);
    expect(hit).not.toBeNull();
    expect([...(hit as { bytes: Uint8Array }).bytes]).toEqual([...result.bytes]);
    expect(await cache.getBundle('sha256-nope')).toBeNull();
  });

  it('evicts the least-recently-used dep-set link when over capacity — recompute, but traffic-free via the shared caches (ADR-0194)', async () => {
    const { fetch, calls } = makeLocalFetcher();
    let computes = 0;
    const cache = new EddyCache({
      resolver: { registryBaseUrl: LOCAL_REGISTRY_BASE_URL, fetch },
      maxEntries: 1,
      resolveFn: async (req, deps) => {
        computes++;
        return resolveBundle(req, deps);
      },
    });
    await cache.resolve({ dependencies: { debug: '^4.4.1' } });
    await cache.resolve({ dependencies: { kleur: '4.1.5' } }); // evicts the debug link
    const trafficBefore = calls.packument + calls.tarball;
    await cache.resolve({ dependencies: { debug: '^4.4.1' } }); // link miss → recompute…
    expect(computes).toBe(3);
    // …with ZERO upstream refetch: packuments within TTL, tarballs immutable.
    expect(calls.packument + calls.tarball).toBe(trafficBefore);
  });
});
