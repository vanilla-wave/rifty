/**
 * Process-wide resolve caches (ADR-0194 §1–2). `resolver.ts` used to build a
 * fresh MemoryVfs + caches per request, so every cold dep set refetched every
 * packument and tarball (measured 17.3s cold-origin vs 7.1s warm standard).
 * These two caches make a cold-but-overlapping set cost only its novel
 * packages:
 *   - {@link TtlPackumentCache} — mutable metadata, TTL-bounded (default 300s
 *     = npmjs edge `max-age`), entry-capped LRU.
 *   - {@link MemoryTarballCache} — immutable bytes keyed (name, version,
 *     integrity), byte-bounded LRU, integrity-verified on put (a bad write
 *     must never be served process-wide; observable = put-then-miss, same as
 *     `VfsTarballCache`).
 * Plus the per-request layering that keeps a resolve self-consistent while
 * sharing: {@link layeredTarballCache}, {@link packumentOverlay}.
 */
import { createHash } from 'node:crypto';
import type { Packument, PackumentCacheLike, TarballCache } from '@riftydev/npm-client';
import { parseIntegrityAlgorithm } from '@riftydev/npm-client';

export const DEFAULT_PACKUMENT_TTL_SECONDS = 300;
export const DEFAULT_PACKUMENT_MAX_ENTRIES = 4096;
export const DEFAULT_TARBALL_CACHE_MAX_BYTES = 512 * 1024 * 1024;

export interface TtlPackumentCacheOptions {
  /** Seconds an entry stays fresh; 0 disables the cache. */
  ttlSeconds: number;
  /** Injectable clock (ms). */
  clock: () => number;
  /** Entry cap (LRU). Default {@link DEFAULT_PACKUMENT_MAX_ENTRIES}. */
  maxEntries?: number;
}

export class TtlPackumentCache implements PackumentCacheLike {
  private readonly map = new Map<
    string,
    { packument: Packument; expiresAt: number; gen: number }
  >();
  private readonly ttlMs: number;
  private readonly clock: () => number;
  private readonly maxEntries: number;

  constructor(opts: TtlPackumentCacheOptions) {
    this.ttlMs = opts.ttlSeconds * 1000;
    this.clock = opts.clock;
    this.maxEntries = opts.maxEntries ?? DEFAULT_PACKUMENT_MAX_ENTRIES;
  }

  get(name: string): Packument | undefined {
    const entry = this.map.get(name);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.clock()) {
      this.map.delete(name);
      return undefined;
    }
    // LRU promote.
    this.map.delete(name);
    this.map.set(name, entry);
    return entry.packument;
  }

  /** Ungenerationed write — unconditional (tests / non-generation callers). */
  set(name: string, packument: Packument): void {
    this.write(name, packument, 0);
  }

  /**
   * Generation-aware write (ADR-0194): metadata is MUTABLE, so a concurrent
   * `prefer:'online'` refresh (a NEWER generation) must not be rolled back by an
   * OLDER cached-policy flight that fetched stale metadata and writes it through
   * later. A write from generation `gen` is dropped when a live entry was already
   * written by a strictly-newer generation. (The immutable tarball cache needs no
   * such guard — same key ⇒ same bytes.)
   */
  setWithGen(name: string, packument: Packument, gen: number): void {
    const existing = this.map.get(name);
    if (existing && existing.expiresAt > this.clock() && existing.gen > gen) return;
    this.write(name, packument, gen);
  }

  private write(name: string, packument: Packument, gen: number): void {
    if (this.ttlMs <= 0) return;
    this.map.delete(name);
    this.map.set(name, { packument, expiresAt: this.clock() + this.ttlMs, gen });
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }
}

export interface MemoryTarballCacheOptions {
  /** Total byte cap across entries. Default {@link DEFAULT_TARBALL_CACHE_MAX_BYTES}. */
  maxBytes?: number;
}

export class MemoryTarballCache implements TarballCache {
  private readonly map = new Map<string, Uint8Array>();
  private readonly maxBytes: number;
  private totalBytes = 0;

  constructor(opts: MemoryTarballCacheOptions = {}) {
    this.maxBytes = opts.maxBytes ?? DEFAULT_TARBALL_CACHE_MAX_BYTES;
  }

  async get(name: string, version: string, integrity: string): Promise<Uint8Array | null> {
    const key = `${name}@${version}#${integrity}`;
    const bytes = this.map.get(key);
    if (!bytes) return null;
    // LRU promote.
    this.map.delete(key);
    this.map.set(key, bytes);
    return bytes;
  }

  async put(name: string, version: string, integrity: string, bytes: Uint8Array): Promise<string> {
    const key = `${name}@${version}#${integrity}`;
    // Verify ONCE on write instead of on every read (VfsTarballCache verifies
    // per read because external writers can corrupt the VFS; this map is
    // process-private, so put-time is the only corruption vector). A mismatch
    // is silently not stored — the next get misses and the caller refetches,
    // the same observable contract as VfsTarballCache.
    const algorithm = parseIntegrityAlgorithm(integrity);
    if (!algorithm || sri(bytes, algorithm) !== integrity) return `memory:${key}`;
    if (bytes.length > this.maxBytes) return `memory:${key}`;
    const existing = this.map.get(key);
    if (existing) {
      this.map.delete(key);
      this.totalBytes -= existing.length;
    }
    this.map.set(key, bytes);
    this.totalBytes += bytes.length;
    while (this.totalBytes > this.maxBytes) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.totalBytes -= this.map.get(oldest)?.length ?? 0;
      this.map.delete(oldest);
    }
    return `memory:${key}`;
  }
}

function sri(bytes: Uint8Array, algorithm: 'sha256' | 'sha384' | 'sha512'): string {
  return `${algorithm}-${createHash(algorithm).update(bytes).digest('base64')}`;
}

/**
 * Per-request tarball layer over the shared cache: reads go local → shared
 * (shared hits are copied local), writes go to BOTH. The local layer pins this
 * request's bytes for the bundle harvest — a shared-cache eviction mid-resolve
 * can never turn into a `tarball-missing` decline.
 */
export function layeredTarballCache(local: TarballCache, shared: TarballCache): TarballCache {
  return {
    async get(name, version, integrity) {
      const hit = await local.get(name, version, integrity);
      if (hit) return hit;
      const fromShared = await shared.get(name, version, integrity);
      if (fromShared) await local.put(name, version, integrity, fromShared);
      return fromShared;
    },
    async put(name, version, integrity, bytes) {
      await shared.put(name, version, integrity, bytes);
      return local.put(name, version, integrity, bytes);
    },
  };
}

/**
 * Per-request packument view over the shared TTL cache. `readShared: false` is
 * the `prefer:'online'` mode (npm `--prefer-online` forces staleness checks —
 * never read cached metadata) while still writing fresh packuments through.
 * The request-local map keeps ONE resolve self-consistent either way: a TTL
 * boundary mid-walk cannot hand the same name two different packuments.
 */
export function packumentOverlay(
  shared: PackumentCacheLike,
  readShared: boolean,
): PackumentCacheLike {
  const local = new Map<string, Packument>();
  return {
    get(name) {
      const own = local.get(name);
      if (own) return own;
      if (!readShared) return undefined;
      const fromShared = shared.get(name);
      if (fromShared) local.set(name, fromShared);
      return fromShared;
    },
    set(name, packument) {
      local.set(name, packument);
      shared.set(name, packument);
    },
  };
}
