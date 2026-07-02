import { describe, expect, it } from 'vitest';
import {
  LOCAL_REGISTRY_BASE_URL,
  makeLocalFetcher,
} from '../../../tests/integration/fixtures/local-registry.ts';
import { EddyCache } from '../src/cache.ts';
import { resolveBundle } from '../src/resolver.ts';

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
