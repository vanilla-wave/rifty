import { describe, expect, it } from 'vitest';
import {
  LOCAL_REGISTRY_BASE_URL,
  makeLocalFetcher,
} from '../../../tests/integration/fixtures/local-registry.ts';
import { type BundleStore, MemoryBundleStore } from '../src/bundle-store.ts';
import { EddyCache, EddyOverloadError } from '../src/cache.ts';
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

/** Same closure hash, caller-chosen bytes — a recompute of one closure packs a
 *  fresh `asOf.resolvedAt`, so two artifacts for one hash can differ byte-wise. */
function bundleBytes(closureHash: string, bytes: number[]): EddyResolveResult & { kind: 'bundle' } {
  return {
    kind: 'bundle',
    bytes: new Uint8Array(bytes),
    manifest: {
      format: 'EddyBundleV1',
      npmClientVersion: '0.0.0',
      asOf: { resolvedAt: `t-${bytes.join('')}`, registry: 'r', closureHash },
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

  it('a cached compute started DURING a prefer:online refresh does not clobber the fresh link', async () => {
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
    const cache = new EddyCache({
      resolver: { registryBaseUrl: LOCAL_REGISTRY_BASE_URL, fetch },
      store: new MemoryBundleStore({ maxBytes: 1024 }),
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

    const onlineP = cache.resolve({ dependencies: { debug: '^4.4.1' }, prefer: 'online' }); // active online gen
    const cachedP = cache.resolve({ dependencies: { debug: '^4.4.1' } }); // lower than active online
    releaseOnline();
    const online = await onlineP;
    expect(online.kind === 'bundle' && online.manifest.asOf.closureHash).toBe('sha256-NEW');
    releaseCached();
    const cached = await cachedP;
    expect(cached.kind === 'bundle' && cached.manifest.asOf.closureHash).toBe('sha256-OLD');

    const third = await cache.resolve({ dependencies: { debug: '^4.4.1' } });
    expect(third.kind === 'bundle' && third.manifest.asOf.closureHash).toBe('sha256-NEW');
    expect(computes).toBe(2);
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
    expect(refresh.kind === 'bundle' && refresh.storeDurable).toBe(false);
    failPuts = false;
    // Pre-fix this served sha256-OLD straight from the store (stale link hit).
    const third = await cache.resolve({ dependencies: { debug: '^4.4.1' } });
    expect(third.kind === 'bundle' && third.manifest.asOf.closureHash).toBe('sha256-NEW');
    expect(third.kind === 'bundle' && third.storeDurable).toBe(true);
    expect(computes).toBe(3); // recompute + put retry, never the stale closure
  });

  it('a FRESHER compute whose store read FAILS kills the stale mutable link — the next cached request recomputes', async () => {
    // Store-read failure is NOT a miss: do not overwrite a possibly-durable
    // same-hash object. But the fresher compute also must not leave an OLDER
    // mutable link behind, or cached requests keep serving the stale closure.
    const { fetch } = makeLocalFetcher();
    let failFreshRead = false;
    let computes = 0;
    const store = new MemoryBundleStore({ maxBytes: 1024 });
    const flaky: BundleStore = {
      get: async (hash) => {
        if (failFreshRead && hash === 'sha256-NEW') throw new Error('bucket down');
        return await store.get(hash);
      },
      put: (hash, bundle) => store.put(hash, bundle),
    };
    const cache = new EddyCache({
      resolver: { registryBaseUrl: LOCAL_REGISTRY_BASE_URL, fetch },
      store: flaky,
      resolveFn: async () => {
        computes++;
        return bundleFor(computes === 1 ? 'sha256-OLD' : 'sha256-NEW');
      },
    });
    const first = await cache.resolve({ dependencies: { debug: '^4.4.1' } }); // link -> OLD
    expect(first.kind === 'bundle' && first.manifest.asOf.closureHash).toBe('sha256-OLD');
    failFreshRead = true;
    const refresh = await cache.resolve({ dependencies: { debug: '^4.4.1' }, prefer: 'online' });
    expect(refresh.kind === 'bundle' && refresh.manifest.asOf.closureHash).toBe('sha256-NEW');
    failFreshRead = false;

    const third = await cache.resolve({ dependencies: { debug: '^4.4.1' } });
    expect(third.kind === 'bundle' && third.manifest.asOf.closureHash).toBe('sha256-NEW');
    expect(computes).toBe(3); // recompute + retry store read/put, never the stale closure
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

  it('a TRANSIENT store read failure does NOT overwrite an existing object — byte stability (round 18)', async () => {
    // The compute's store.get throws (bucket blip). An object may already exist
    // and be VALID — treating the throw as a miss and PUTting these fresh bytes
    // would overwrite it, so the one-year-immutable GET URL would flip bytes.
    const { fetch } = makeLocalFetcher();
    const inner = new MemoryBundleStore({ maxBytes: 1024 });
    const original = bundleBytes('sha256-H', [1, 1, 1]);
    await inner.put('sha256-H', { bytes: original.bytes, manifest: original.manifest });
    let throwGet = false;
    let putCalls = 0;
    const flaky: BundleStore = {
      get: async (h) => {
        if (throwGet) throw new Error('bucket blip');
        return inner.get(h);
      },
      put: async (h, b) => {
        putCalls += 1;
        await inner.put(h, b);
      },
    };
    const cache = new EddyCache({
      resolver: { registryBaseUrl: LOCAL_REGISTRY_BASE_URL, fetch },
      store: flaky,
      resolveFn: async () => bundleBytes('sha256-H', [2, 2, 2]), // fresh bytes DIFFER
    });
    throwGet = true;
    const r = await cache.resolve({ dependencies: { debug: '^4.4.1' } });
    expect(r.kind === 'bundle' && [...r.bytes]).toEqual([2, 2, 2]); // served the fresh compute…
    expect(putCalls).toBe(0); // …but NEVER overwrote the durable object
    throwGet = false;
    const stored = await cache.getBundle('sha256-H');
    expect([...(stored?.bytes ?? [])]).toEqual([1, 1, 1]); // original bytes intact
  });

  it('repairs/proves a stored SAME-closure hit before publishing the mutable link', async () => {
    // Regression (round 19): S3 `get()` verifies bytes but cannot prove
    // cache-control metadata. A store-hit must still run the idempotent `put`
    // repair path before publishing a dep-set link to that hash.
    const { fetch } = makeLocalFetcher();
    const original = bundleBytes('sha256-H', [1, 1, 1]);
    const fresh = bundleBytes('sha256-H', [2, 2, 2]);
    const putBytes: number[][] = [];
    const store: BundleStore = {
      get: async () => ({ bytes: original.bytes, manifest: original.manifest }),
      put: async (_hash, bundle) => {
        putBytes.push([...bundle.bytes]);
      },
    };
    const cache = new EddyCache({
      resolver: { registryBaseUrl: LOCAL_REGISTRY_BASE_URL, fetch },
      store,
      resolveFn: async () => fresh,
    });

    const first = await cache.resolve({ dependencies: { debug: '^4.4.1' } });
    expect(first.kind === 'bundle' && [...first.bytes]).toEqual([1, 1, 1]);
    expect(putBytes).toEqual([[1, 1, 1]]); // repair/proof uses the durable bytes, not recompute bytes

    await cache.resolve({ dependencies: { debug: '^4.4.1' } });
    expect(putBytes).toEqual([[1, 1, 1]]); // mutable hit is safe because the proof already happened
  });

  it('skips the mutable link when stored-hit metadata repair/proof fails', async () => {
    const { fetch } = makeLocalFetcher();
    const original = bundleBytes('sha256-H', [1, 1, 1]);
    let computes = 0;
    let failProof = true;
    const store: BundleStore = {
      get: async () => ({ bytes: original.bytes, manifest: original.manifest }),
      put: async () => {
        if (failProof) throw new Error('metadata write failed');
      },
    };
    const cache = new EddyCache({
      resolver: { registryBaseUrl: LOCAL_REGISTRY_BASE_URL, fetch },
      store,
      resolveFn: async () => {
        computes += 1;
        return bundleBytes('sha256-H', [2, 2, computes]);
      },
    });

    const first = await cache.resolve({ dependencies: { debug: '^4.4.1' } });
    expect(first.kind === 'bundle' && [...first.bytes]).toEqual([1, 1, 1]);
    expect(first.kind === 'bundle' && first.storeDurable).toBe(false);
    failProof = false;
    const second = await cache.resolve({ dependencies: { debug: '^4.4.1' } });
    expect(second.kind === 'bundle' && second.storeDurable).toBe(true);
    expect(computes).toBe(2); // first proof failure did not publish a reusable link
  });

  it('concurrent computes of the SAME closure never overwrite with recompute bytes (round 18)', async () => {
    // Two DIFFERENT dep sets resolve to the SAME closure with different bytes,
    // concurrently. Without per-hash serialization both PUT (last wins) and the
    // two callers see different bytes for one immutable hash.
    const { fetch } = makeLocalFetcher();
    const inner = new MemoryBundleStore({ maxBytes: 4096 });
    const putBytes: number[][] = [];
    const counting: BundleStore = {
      get: (h) => inner.get(h),
      put: async (h, b) => {
        putBytes.push([...b.bytes]);
        await inner.put(h, b);
      },
    };
    let releaseA = (): void => {};
    let releaseB = (): void => {};
    const gateA = new Promise<void>((r) => {
      releaseA = r;
    });
    const gateB = new Promise<void>((r) => {
      releaseB = r;
    });
    const cache = new EddyCache({
      resolver: { registryBaseUrl: LOCAL_REGISTRY_BASE_URL, fetch },
      store: counting,
      resolveFn: async (req) => {
        if ('a' in (req.dependencies ?? {})) {
          await gateA;
          return bundleBytes('sha256-SAME', [1, 1, 1]);
        }
        await gateB;
        return bundleBytes('sha256-SAME', [2, 2, 2]);
      },
    });
    const pA = cache.resolve({ dependencies: { a: '^1.0.0' } });
    const pB = cache.resolve({ dependencies: { b: '^1.0.0' } });
    releaseA(); // A reaches the store settle first → wins the single PUT
    releaseB();
    const [a, b] = await Promise.all([pA, pB]);
    const aBytes = a.kind === 'bundle' ? [...a.bytes] : [];
    const bBytes = b.kind === 'bundle' ? [...b.bytes] : [];
    expect(bBytes).toEqual(aBytes); // both callers serve the SAME (first-stored) bytes
    expect(putBytes).toEqual([aBytes, aBytes]); // second proof never overwrites with recompute bytes
    const stored = await cache.getBundle('sha256-SAME');
    expect([...(stored?.bytes ?? [])]).toEqual(aBytes); // the immutable key is byte-stable
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

  it('single-flights the entire cached path, including a warm linked store GET', async () => {
    const { fetch } = makeLocalFetcher();
    const inner = new MemoryBundleStore({ maxBytes: 100_000 });
    let blockGets = false;
    let linkedGets = 0;
    let releaseGet = (): void => {};
    let markGetStarted = (): void => {};
    const getGate = new Promise<void>((resolve) => {
      releaseGet = resolve;
    });
    const getStarted = new Promise<void>((resolve) => {
      markGetStarted = resolve;
    });
    const store: BundleStore = {
      get: async (hash) => {
        if (blockGets) {
          linkedGets += 1;
          markGetStarted();
          await getGate;
        }
        return inner.get(hash);
      },
      put: (hash, bundle) => inner.put(hash, bundle),
    };
    const cache = new EddyCache({
      resolver: { registryBaseUrl: LOCAL_REGISTRY_BASE_URL, fetch },
      store,
    });
    const request = { dependencies: { debug: '^4.4.1' } };
    await cache.resolve(request);

    blockGets = true;
    const first = cache.resolve(request);
    await getStarted;
    const joined = cache.resolve(request);
    expect(linkedGets).toBe(1);
    releaseGet();
    const [a, b] = await Promise.all([first, joined]);
    expect(a.kind === 'bundle' && b.kind === 'bundle' && [...a.bytes]).toEqual(
      b.kind === 'bundle' ? [...b.bytes] : [],
    );
    expect(linkedGets).toBe(1);
  });

  it('admits one distinct flight without queuing; same-key cached callers still join', async () => {
    const { fetch } = makeLocalFetcher();
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let computes = 0;
    const cache = new EddyCache({
      resolver: { registryBaseUrl: LOCAL_REGISTRY_BASE_URL, fetch },
      maxConcurrentResolves: 1,
      resolveFn: async () => {
        computes += 1;
        await gate;
        return bundleFor('sha256-A');
      },
    });
    const request = { dependencies: { a: '^1.0.0' } };
    const first = cache.resolve(request);
    const joined = cache.resolve(request);

    const distinct = cache.resolve({ dependencies: { b: '^1.0.0' } });
    await expect(distinct).rejects.toMatchObject({
      name: 'EddyOverloadError',
      code: 'EEDDYOVERLOADED',
      maxConcurrentResolves: 1,
      retryAfterSeconds: 1,
    });
    await expect(cache.resolve({ ...request, prefer: 'online' })).rejects.toBeInstanceOf(
      EddyOverloadError,
    );
    expect(computes).toBe(1);

    release();
    await expect(Promise.all([first, joined])).resolves.toHaveLength(2);
  });

  it('keeps a shared cached resolve alive for remaining waiters, then aborts and releases on the last disconnect', async () => {
    const { fetch } = makeLocalFetcher();
    let seenSignal: AbortSignal | undefined;
    let markResolverSettled = (): void => {};
    const resolverSettled = new Promise<void>((resolve) => {
      markResolverSettled = resolve;
    });
    let computes = 0;
    const cache = new EddyCache({
      resolver: { registryBaseUrl: LOCAL_REGISTRY_BASE_URL, fetch },
      maxConcurrentResolves: 1,
      resolveFn: async (_req, deps) => {
        computes += 1;
        if (computes > 1) return bundleFor('sha256-B');
        seenSignal = deps.signal;
        try {
          return await new Promise<EddyResolveResult>((_resolve, reject) => {
            const signal = deps.signal as AbortSignal;
            const onAbort = (): void => reject(signal.reason);
            if (signal.aborted) onAbort();
            else signal.addEventListener('abort', onAbort, { once: true });
          });
        } finally {
          markResolverSettled();
        }
      },
    });
    const firstController = new AbortController();
    const secondController = new AbortController();
    const request = { dependencies: { a: '^1.0.0' } };
    const first = cache.resolve(request, firstController.signal);
    const second = cache.resolve(request, secondController.signal);
    const firstReason = new Error('first caller disconnected');
    firstController.abort(firstReason);
    await expect(first).rejects.toBe(firstReason);
    expect(seenSignal?.aborted).toBe(false);

    const secondReason = new Error('last caller disconnected');
    secondController.abort(secondReason);
    await expect(second).rejects.toBe(secondReason);
    await resolverSettled;
    expect(seenSignal?.aborted).toBe(true);
    expect(seenSignal?.reason).toBe(secondReason);
    await new Promise<void>((resolve) => setImmediate(resolve));

    const recovered = await cache.resolve({ dependencies: { b: '^1.0.0' } });
    expect(recovered.kind === 'bundle' && recovered.manifest.asOf.closureHash).toBe('sha256-B');
    expect(computes).toBe(2);
  });

  it('preserves the library default of unbounded distinct-flight admission', async () => {
    const { fetch } = makeLocalFetcher();
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let computes = 0;
    const cache = new EddyCache({
      resolver: { registryBaseUrl: LOCAL_REGISTRY_BASE_URL, fetch },
      resolveFn: async (_req) => {
        computes += 1;
        await gate;
        return bundleFor(`sha256-${computes}`);
      },
    });
    const a = cache.resolve({ dependencies: { a: '^1.0.0' } });
    const b = cache.resolve({ dependencies: { b: '^1.0.0' } });
    expect(computes).toBe(2);
    release();
    await expect(Promise.all([a, b])).resolves.toHaveLength(2);
  });

  it('releases admission exactly once after resolver throws and after a typed decline', async () => {
    const { fetch } = makeLocalFetcher();
    let computes = 0;
    const cache = new EddyCache({
      resolver: { registryBaseUrl: LOCAL_REGISTRY_BASE_URL, fetch },
      maxConcurrentResolves: 1,
      resolveFn: async () => {
        computes += 1;
        if (computes === 1) throw new Error('resolver exploded');
        if (computes === 2) {
          return { kind: 'unsupported', feature: 'fixture', message: 'fixture decline' };
        }
        return bundleFor('sha256-recovered');
      },
    });

    await expect(cache.resolve({ dependencies: { a: '1' } })).rejects.toThrow('resolver exploded');
    await expect(cache.resolve({ dependencies: { b: '1' } })).resolves.toEqual({
      kind: 'unsupported',
      feature: 'fixture',
      message: 'fixture decline',
    });
    const recovered = await cache.resolve({ dependencies: { c: '1' } });
    expect(recovered.kind === 'bundle' && recovered.manifest.asOf.closureHash).toBe(
      'sha256-recovered',
    );
    expect(computes).toBe(3);
  });

  it('cancels an online flight directly and retains its permit until resolver cleanup settles', async () => {
    const { fetch } = makeLocalFetcher();
    let seenSignal: AbortSignal | undefined;
    let markAbortSeen = (): void => {};
    const abortSeen = new Promise<void>((resolve) => {
      markAbortSeen = resolve;
    });
    let releaseCleanup = (): void => {};
    const cleanupGate = new Promise<void>((resolve) => {
      releaseCleanup = resolve;
    });
    const cache = new EddyCache({
      resolver: { registryBaseUrl: LOCAL_REGISTRY_BASE_URL, fetch },
      maxConcurrentResolves: 1,
      resolveFn: async (req, deps) => {
        if (req.prefer !== 'online') return bundleFor('sha256-recovered');
        seenSignal = deps.signal;
        try {
          return await new Promise<EddyResolveResult>((_resolve, reject) => {
            const signal = deps.signal as AbortSignal;
            const onAbort = (): void => reject(signal.reason);
            if (signal.aborted) onAbort();
            else signal.addEventListener('abort', onAbort, { once: true });
          });
        } catch (err) {
          markAbortSeen();
          await cleanupGate;
          throw err;
        }
      },
    });
    const controller = new AbortController();
    const reason = new Error('online caller disconnected');
    const online = cache.resolve({ dependencies: { a: '1' }, prefer: 'online' }, controller.signal);
    expect(seenSignal).toBe(controller.signal);
    controller.abort(reason);
    await abortSeen;

    await expect(cache.resolve({ dependencies: { b: '1' } })).rejects.toBeInstanceOf(
      EddyOverloadError,
    );
    releaseCleanup();
    await expect(online).rejects.toBe(reason);

    const recovered = await cache.resolve({ dependencies: { b: '1' } });
    expect(recovered.kind === 'bundle' && recovered.manifest.asOf.closureHash).toBe(
      'sha256-recovered',
    );
  });
});
