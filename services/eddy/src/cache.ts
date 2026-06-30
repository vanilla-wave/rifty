import { createHash } from 'node:crypto';
/**
 * Two-tier resolution cache (ADR-0182 §6):
 *   - mutable `dep-set → closure-hash` with a TTL (default 1800s, operator-set,
 *     0 = always recompute) — the `--prefer-offline` analogue.
 *   - immutable `closure-hash → bundle` (content-addressed; safe forever) — what
 *     the CDN holds via `Cache-Control: immutable` on the response.
 * `prefer:'online'` bypasses the mutable tier (forces a fresh recompute, the
 * `--prefer-online` analogue). Both tiers are bounded LRUs.
 *
 * The cached bundle keeps its ORIGINAL as-of stamp (when it was first
 * resolved) — staleness is visible, never silently refreshed.
 */
import type { EddyBundleManifestV1 } from '@riftydev/npm-client';
import {
  type EddyResolveRequest,
  type EddyResolveResult,
  type EddyResolverDeps,
  resolveBundle,
} from './resolver.ts';

const DEFAULT_TTL_SECONDS = 1800;
const DEFAULT_MAX_ENTRIES = 256;

export interface EddyCacheOptions {
  resolver: EddyResolverDeps;
  /** Mutable-tier TTL in seconds. Default 1800; 0 = never reuse (always recompute). */
  ttlSeconds?: number;
  /** Per-tier LRU cap. Default 256. */
  maxEntries?: number;
  /** Injectable monotonic clock (ms) for TTL. Defaults to `Date.now`. */
  clock?: () => number;
  /** Injectable resolver (defaults to {@link resolveBundle}). */
  resolveFn?: typeof resolveBundle;
}

interface CachedBundle {
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
  private readonly immutable: Lru<CachedBundle>;

  constructor(opts: EddyCacheOptions) {
    this.resolver = opts.resolver;
    this.ttlMs = (opts.ttlSeconds ?? DEFAULT_TTL_SECONDS) * 1000;
    this.clock = opts.clock ?? Date.now;
    this.resolveFn = opts.resolveFn ?? resolveBundle;
    const cap = opts.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.mutable = new Lru(cap);
    this.immutable = new Lru(cap);
  }

  async resolve(req: EddyResolveRequest): Promise<EddyResolveResult> {
    const online = req.prefer === 'online';
    const key = depSetKey(req);

    if (!online) {
      const link = this.mutable.get(key);
      if (link && link.expiresAt > this.clock()) {
        const hit = this.immutable.get(link.closureHash);
        if (hit) return { kind: 'bundle', bytes: hit.bytes, manifest: hit.manifest };
      }
    }

    const result = await this.resolveFn(req, this.resolver);
    if (result.kind !== 'bundle') return result; // declines are not cached
    const closureHash = result.manifest.asOf.closureHash;
    this.immutable.set(closureHash, { bytes: result.bytes, manifest: result.manifest });
    // Re-seed the mutable link even on a prefer:'online' recompute, so a later
    // cached request reuses the just-computed closure (npm --prefer-online too
    // writes the lockfile it fetched).
    if (this.ttlMs > 0) {
      this.mutable.set(key, { closureHash, expiresAt: this.clock() + this.ttlMs });
    }
    return result;
  }
}
