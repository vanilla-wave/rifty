import { describe, expect, it } from 'vitest';
import {
  LOCAL_REGISTRY_BASE_URL,
  makeLocalFetcher,
} from '../../../tests/integration/fixtures/local-registry.ts';
import { EddyCache } from '../src/cache.ts';

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

  it('recomputes after the mutable TTL expires', async () => {
    const { fetch, calls } = makeLocalFetcher();
    let nowMs = 1_000_000;
    const cache = new EddyCache({
      resolver: { registryBaseUrl: LOCAL_REGISTRY_BASE_URL, fetch },
      ttlSeconds: 60,
      clock: () => nowMs,
    });
    await cache.resolve({ dependencies: { debug: '^4.4.1' } });
    const afterFirst = calls.packument + calls.tarball;
    nowMs += 61_000; // past TTL
    await cache.resolve({ dependencies: { debug: '^4.4.1' } });
    expect(calls.packument + calls.tarball).toBeGreaterThan(afterFirst);
  });

  it('prefer:online forces a recompute even within TTL', async () => {
    const { fetch, calls } = makeLocalFetcher();
    const cache = new EddyCache({ resolver: { registryBaseUrl: LOCAL_REGISTRY_BASE_URL, fetch } });
    await cache.resolve({ dependencies: { debug: '^4.4.1' } });
    const afterFirst = calls.packument + calls.tarball;
    await cache.resolve({ dependencies: { debug: '^4.4.1' }, prefer: 'online' });
    expect(calls.packument + calls.tarball).toBeGreaterThan(afterFirst);
  });

  it('evicts the least-recently-used closure when over capacity', async () => {
    const { fetch, calls } = makeLocalFetcher();
    const cache = new EddyCache({
      resolver: { registryBaseUrl: LOCAL_REGISTRY_BASE_URL, fetch },
      maxEntries: 1,
    });
    await cache.resolve({ dependencies: { debug: '^4.4.1' } });
    await cache.resolve({ dependencies: { kleur: '4.1.5' } }); // evicts debug
    const before = calls.packument + calls.tarball;
    await cache.resolve({ dependencies: { debug: '^4.4.1' } }); // must recompute
    expect(calls.packument + calls.tarball).toBeGreaterThan(before);
  });
});
