import { createHash } from 'node:crypto';
/**
 * Two-tier resolution cache (ADR-0182 §6, restructured by ADR-0194):
 *   - mutable `dep-set → closure-hash` with a TTL (default 1800s, operator-set,
 *     0 = always recompute) — the `--prefer-offline` analogue. RAM-only and
 *     reconstructible: a restart loses nothing durable.
 *   - immutable `closure-hash → bundle` lives in a {@link BundleStore}
 *     (byte-bounded memory locally; Object Storage behind the CDN in prod).
 * `prefer:'online'` bypasses the mutable tier (forces a fresh recompute, the
 * `--prefer-online` analogue) AND the shared packument reads.
 *
 * Cold resolves share process-wide packument/tarball caches and are
 * single-flighted per dep-set (ADR-0194 §1–3). The cached bundle keeps its
 * ORIGINAL as-of stamp (when it was first resolved) — staleness is visible,
 * never silently refreshed.
 */
import type { EddyBundleManifestV1 } from '@riftydev/npm-client';
import { type BundleStore, MemoryBundleStore } from './bundle-store.ts';
import {
  type EddyResolveRequest,
  type EddyResolveResult,
  type EddyResolverDeps,
  resolveBundle,
} from './resolver.ts';
import {
  DEFAULT_PACKUMENT_TTL_SECONDS,
  MemoryTarballCache,
  TtlPackumentCache,
} from './shared-caches.ts';

const DEFAULT_TTL_SECONDS = 1800;
const DEFAULT_MAX_ENTRIES = 256;

export interface EddyCacheOptions {
  resolver: EddyResolverDeps;
  /** Mutable-tier TTL in seconds. Default 1800; 0 = never reuse (always recompute). */
  ttlSeconds?: number;
  /** Mutable-tier LRU entry cap. Default 256. */
  maxEntries?: number;
  /** Shared packument cache TTL in seconds (ADR-0194 §1). Default 300
   *  (= npmjs edge `max-age`); 0 disables. */
  packumentTtlSeconds?: number;
  /** Shared immutable tarball cache byte cap (ADR-0194 §2). */
  tarballCacheMaxBytes?: number;
  /** Immutable bundle tier (ADR-0194 §4). Default: byte-bounded memory LRU. */
  store?: BundleStore;
  /** Injectable monotonic clock (ms) for TTL. Defaults to `Date.now`. */
  clock?: () => number;
  /** Injectable resolver (defaults to {@link resolveBundle}). */
  resolveFn?: typeof resolveBundle;
}

export interface CachedBundle {
  bytes: Uint8Array;
  manifest: EddyBundleManifestV1;
}

/** Insertion-ordered LRU: `get` promotes; `set` evicts the oldest over cap. */
class Lru<V> {
  private readonly map = new Map<string, V>();
  constructor(private readonly cap: number) {}
  get(key: string): V | undefined {
    const v = this.map.get(key);
    if (v === undefined) return undefined;
    this.map.delete(key);
    this.map.set(key, v);
    return v;
  }
  set(key: string, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.cap) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }
  delete(key: string): void {
    this.map.delete(key);
  }
}

function sortRecord(rec: Record<string, string> | undefined): Record<string, string> {
  if (!rec) return {};
  const out: Record<string, string> = {};
  for (const k of Object.keys(rec).sort()) out[k] = rec[k] as string;
  return out;
}

/** Canonical dep-set key — `prefer` excluded (it changes cache POLICY, not the
 * resolved closure). */
function depSetKey(req: EddyResolveRequest): string {
  const canonical = JSON.stringify({
    dependencies: sortRecord(req.dependencies),
    devDependencies: sortRecord(req.devDependencies),
    optionalDependencies: sortRecord(req.optionalDependencies),
    overrides: sortRecord(req.overrides),
  });
  return createHash('sha256').update(canonical).digest('base64');
}

export class EddyCache {
  private readonly resolver: EddyResolverDeps;
  private readonly ttlMs: number;
  private readonly clock: () => number;
  private readonly resolveFn: typeof resolveBundle;
  private readonly mutable: Lru<{ closureHash: string; expiresAt: number }>;
  private readonly store: BundleStore;
  private readonly packuments: TtlPackumentCache;
  private readonly tarballs: MemoryTarballCache;
  private readonly inflight = new Map<string, Promise<EddyResolveResult>>();

  constructor(opts: EddyCacheOptions) {
    this.ttlMs = (opts.ttlSeconds ?? DEFAULT_TTL_SECONDS) * 1000;
    this.clock = opts.clock ?? Date.now;
    this.resolveFn = opts.resolveFn ?? resolveBundle;
    this.mutable = new Lru(opts.maxEntries ?? DEFAULT_MAX_ENTRIES);
    this.store = opts.store ?? new MemoryBundleStore();
    this.packuments = new TtlPackumentCache({
      ttlSeconds: opts.packumentTtlSeconds ?? DEFAULT_PACKUMENT_TTL_SECONDS,
      clock: this.clock,
    });
    this.tarballs = new MemoryTarballCache(
      opts.tarballCacheMaxBytes === undefined ? {} : { maxBytes: opts.tarballCacheMaxBytes },
    );
    // Every compute resolves through the process-wide caches; resolver.ts
    // layers its per-request view on top (self-consistency + harvest pinning).
    this.resolver = {
      ...opts.resolver,
      packumentCache: this.packuments,
      tarballCache: this.tarballs,
    };
  }

  /** Immutable-tier direct lookup (`GET /bundle/<closureHash>`). A miss is
   * answered by the client's POST fallback, which re-seeds the tier. */
  getBundle(closureHash: string): Promise<CachedBundle | null> {
    return this.store.get(closureHash);
  }

  async resolve(req: EddyResolveRequest): Promise<EddyResolveResult> {
    const online = req.prefer === 'online';
    const key = depSetKey(req);

    if (!online) {
      const link = this.mutable.get(key);
      if (link && link.expiresAt > this.clock()) {
        const hit = await this.store.get(link.closureHash);
        if (hit) return { kind: 'bundle', bytes: hit.bytes, manifest: hit.manifest };
      }
      // Thundering herd: identical cold requests join one compute. An 'online'
      // request never joins (the flight may have read TTL-cached packuments)…
      const joined = this.inflight.get(key);
      if (joined) return joined;
    }

    const flight = this.compute(req, key);
    // …but every flight — online included — registers: an online compute is
    // fresher than any cached-policy joiner requires.
    this.inflight.set(key, flight);
    void flight
      .catch(() => undefined)
      .then(() => {
        if (this.inflight.get(key) === flight) this.inflight.delete(key);
      });
    return flight;
  }

  private async compute(req: EddyResolveRequest, key: string): Promise<EddyResolveResult> {
    const result = await this.resolveFn(req, this.resolver);
    if (result.kind !== 'bundle') return result; // declines are not cached
    const closureHash = result.manifest.asOf.closureHash;
    // Durable-BEFORE-link (ADR-0194 §5): the awaited put guarantees a linked
    // hash is servable (GET-by-hash via CDN/bucket) before any client learns
    // it. A recompute of an already-stored closure skips the upload.
    try {
      if (!(await this.store.has(closureHash))) {
        await this.store.put(closureHash, { bytes: result.bytes, manifest: result.manifest });
      }
    } catch (err) {
      // Degrade, never 500: serve the computed bundle, skip the link so the
      // next request recomputes (and retries the put).
      console.error(
        `eddy: bundle store put failed for ${closureHash}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return result;
    }
    // Re-seed the mutable link even on a prefer:'online' recompute, so a later
    // cached request reuses the just-computed closure (npm --prefer-online too
    // writes the lockfile it fetched).
    if (this.ttlMs > 0) {
      this.mutable.set(key, { closureHash, expiresAt: this.clock() + this.ttlMs });
    }
    return result;
  }
}
