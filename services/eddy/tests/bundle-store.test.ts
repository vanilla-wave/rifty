/**
 * BundleStore (ADR-0194 §4–5): the immutable `closureHash → bundle` tier
 * behind `EddyCache`. Memory implementation here; the S3 one lives in
 * `s3-bundle-store.test.ts`. Plus the cache↔store contract: durable-before-
 * link, store-hit skips put, failed put degrades (no link, no 500).
 */
import type { EddyBundleManifestV1 } from '@riftydev/npm-client';
import { describe, expect, it } from 'vitest';
import {
  LOCAL_REGISTRY_BASE_URL,
  makeLocalFetcher,
} from '../../../tests/integration/fixtures/local-registry.ts';
import { type BundleStore, MemoryBundleStore } from '../src/bundle-store.ts';
import { EddyCache } from '../src/cache.ts';

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

  it('a bundle larger than the cap is not stored (and evicts nothing)', async () => {
    const store = new MemoryBundleStore({ maxBytes: 10 });
    await store.put('sha256-a', bundle('sha256-a', 8));
    await store.put('sha256-big', bundle('sha256-big', 64));
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

  it('a cold recompute re-affirms durability with an idempotent put (the store dedups the upload, not the cache)', async () => {
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
    await cache.resolve({ dependencies: { debug: '^4.4.1' } });
    expect(log.filter((l) => l.startsWith('put ')).length).toBe(1);
    nowMs += 61_000; // expire the mutable link → recompute, same closure
    const again = await cache.resolve({ dependencies: { debug: '^4.4.1' } });
    expect(again.kind).toBe('bundle');
    // No has()-gate: the cache re-puts on every cold recompute; the STORE
    // (S3 via its ETag check, `s3-bundle-store.test.ts`) skips the redundant
    // upload. Self-heal depends on this — a cache-side gated skip would never
    // overwrite a poisoned key.
    expect(log.filter((l) => l.startsWith('put ')).length).toBe(2);
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
