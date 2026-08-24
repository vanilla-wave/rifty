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
import type { PackumentCacheLike } from '@riftydev/npm-client';
import { type BundleStore, type CachedBundle, MemoryBundleStore } from './bundle-store.ts';
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
const DEFAULT_MAX_CONCURRENT_RESOLVES = Number.POSITIVE_INFINITY;
const OVERLOAD_RETRY_AFTER_SECONDS = 1;

/** Typed fail-fast admission result. HTTP maps this exact class to 503; all
 * other resolver/store failures retain their existing behavior. */
export class EddyOverloadError extends Error {
  override readonly name = 'EddyOverloadError';
  readonly code = 'EEDDYOVERLOADED';
  readonly retryAfterSeconds = OVERLOAD_RETRY_AFTER_SECONDS;

  constructor(readonly maxConcurrentResolves: number) {
    super(`eddy resolve capacity exhausted (max ${maxConcurrentResolves})`);
  }
}

export interface EddyCacheOptions {
  resolver: EddyResolverDeps;
  /** Mutable-tier TTL in seconds. Default 1800; 0 = never reuse (always recompute). */
  ttlSeconds?: number;
  /** Mutable-tier LRU entry cap. Default 256. */
  maxEntries?: number;
  /** Shared packument cache TTL in seconds (ADR-0194 §1). Default 300
   *  (= npmjs edge `max-age`); 0 disables. */
  packumentTtlSeconds?: number;
  /** Shared serialized packument cache byte cap. */
  packumentCacheMaxBytes?: number;
  /** Shared immutable tarball cache byte cap (ADR-0194 §2). */
  tarballCacheMaxBytes?: number;
  /** Immutable bundle tier (ADR-0194 §4). Default: byte-bounded memory LRU. */
  store?: BundleStore;
  /** Process-wide distinct resolve-flight cap. No default cap preserves the
   *  library's existing behavior; production must set an explicit envelope. */
  maxConcurrentResolves?: number;
  /** Injectable monotonic clock (ms) for TTL. Defaults to `Date.now`. */
  clock?: () => number;
  /** Injectable resolver (defaults to {@link resolveBundle}). */
  resolveFn?: typeof resolveBundle;
}

type BundleResolveResult = EddyResolveResult & { kind: 'bundle' };

interface CachedFlight {
  readonly key: string;
  readonly controller: AbortController;
  readonly promise: Promise<EddyResolveResult>;
  readonly state: {
    waiters: number;
    accepting: boolean;
    settled: boolean;
  };
}

function bundleResult(bundle: CachedBundle, storeDurable: boolean): BundleResolveResult {
  return {
    kind: 'bundle',
    bytes: bundle.bytes,
    manifest: bundle.manifest,
    storeDurable,
  };
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
  /** Read WITHOUT promoting — the publish guard compares generations. */
  peek(key: string): V | undefined {
    return this.map.get(key);
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
  private readonly mutable: Lru<{ closureHash: string; expiresAt: number; gen: number }>;
  private readonly store: BundleStore;
  private readonly packuments: TtlPackumentCache;
  private readonly tarballs: MemoryTarballCache;
  private readonly maxConcurrentResolves: number;
  private activeResolves = 0;
  /** Cached-policy single-flight covers the WHOLE POST path, including a
   *  mutable-link store read. `prefer:'online'` computes are deliberately
   *  NOT joinable: a normal cached request must not inherit an online refresh's
   *  live-registry latency/failure mode. */
  private readonly cachedInflight = new Map<string, CachedFlight>();
  /** Generations of online refreshes currently in flight. Cached computes that
   * start while one is active are allowed to serve their caller, but their
   * write-throughs/publishes rank below the online refresh so stale cached
   * metadata cannot clobber fresh online state when it settles later. */
  private readonly activeOnlineGens = new Set<number>();
  private cachedDuringOnlineSeq = 0;
  /** Per-closureHash FIFO tail: serializes the store settle (get→serve|put) so
   *  concurrent computes of the SAME closure can't each PUT different-`resolvedAt`
   *  bytes over one immutable key — the second sees the first's stored artifact
   *  and serves it (byte stability, ADR-0194 §5). See {@link settleStore}. */
  private readonly storeTail = new Map<string, Promise<unknown>>();
  /** Monotonic per-compute stamp: a later-STARTED compute (fresher reads) has a
   *  higher gen and wins the mutable-link publish (see {@link compute}). */
  private computeSeq = 0;

  constructor(opts: EddyCacheOptions) {
    this.ttlMs = (opts.ttlSeconds ?? DEFAULT_TTL_SECONDS) * 1000;
    this.clock = opts.clock ?? Date.now;
    this.resolveFn = opts.resolveFn ?? resolveBundle;
    this.maxConcurrentResolves = opts.maxConcurrentResolves ?? DEFAULT_MAX_CONCURRENT_RESOLVES;
    if (
      this.maxConcurrentResolves !== Number.POSITIVE_INFINITY &&
      (!Number.isSafeInteger(this.maxConcurrentResolves) || this.maxConcurrentResolves < 1)
    ) {
      throw new RangeError('maxConcurrentResolves must be a positive safe integer');
    }
    this.mutable = new Lru(opts.maxEntries ?? DEFAULT_MAX_ENTRIES);
    this.store = opts.store ?? new MemoryBundleStore();
    this.packuments = new TtlPackumentCache({
      ttlSeconds: opts.packumentTtlSeconds ?? DEFAULT_PACKUMENT_TTL_SECONDS,
      clock: this.clock,
      ...(opts.packumentCacheMaxBytes === undefined
        ? {}
        : { maxBytes: opts.packumentCacheMaxBytes }),
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

  async resolve(req: EddyResolveRequest, signal?: AbortSignal): Promise<EddyResolveResult> {
    throwIfAborted(signal);
    const online = req.prefer === 'online';
    const key = depSetKey(req);

    if (!online) {
      const joined = this.cachedInflight.get(key);
      if (joined?.state.accepting) return this.joinCachedFlight(joined, signal);

      const release = this.admit();
      const flight = this.createCachedFlight(req, key, release);
      this.cachedInflight.set(key, flight);
      return this.joinCachedFlight(flight, signal);
    }

    const release = this.admit();
    try {
      return await this.startCompute(req, key, true, signal);
    } finally {
      release();
    }
  }

  /** One admitted cached-policy flight owns all work for a dep-set, including
   *  the linked immutable-store lookup. Waiters have independent lifecycles;
   *  only the LAST disconnect aborts the shared work. */
  private createCachedFlight(
    req: EddyResolveRequest,
    key: string,
    release: () => void,
  ): CachedFlight {
    const controller = new AbortController();
    const state = { waiters: 0, accepting: true, settled: false };
    const promise = this.resolveCachedPath(req, key, controller.signal).finally(() => {
      state.settled = true;
      state.accepting = false;
      release();
      if (this.cachedInflight.get(key)?.state === state) this.cachedInflight.delete(key);
    });
    const flight: CachedFlight = {
      key,
      controller,
      promise,
      state,
    };
    // Every caller gets its own derived waiter Promise. Keep the underlying
    // rejection observed even if all callers disconnect before it settles.
    void flight.promise.catch(() => undefined);
    return flight;
  }

  private joinCachedFlight(
    flight: CachedFlight,
    signal: AbortSignal | undefined,
  ): Promise<EddyResolveResult> {
    try {
      throwIfAborted(signal);
    } catch (err) {
      return Promise.reject(err);
    }
    flight.state.waiters += 1;
    return new Promise<EddyResolveResult>((resolve, reject) => {
      let left = false;
      const leave = (abandoned: boolean): void => {
        if (left) return;
        left = true;
        if (signal) signal.removeEventListener('abort', onAbort);
        flight.state.waiters -= 1;
        if (abandoned && flight.state.waiters === 0 && !flight.state.settled) {
          // A later caller must not join work whose lifecycle has already been
          // cancelled. Its fresh admission either starts after cleanup or gets
          // the honest overload response while this permit is still occupied.
          flight.state.accepting = false;
          if (this.cachedInflight.get(flight.key) === flight) {
            this.cachedInflight.delete(flight.key);
          }
          flight.controller.abort(abortReason(signal));
        }
      };
      const onAbort = (): void => {
        leave(true);
        reject(abortReason(signal));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      flight.promise.then(
        (result) => {
          leave(false);
          resolve(result);
        },
        (err: unknown) => {
          leave(false);
          reject(err);
        },
      );
    });
  }

  private async resolveCachedPath(
    req: EddyResolveRequest,
    key: string,
    signal: AbortSignal,
  ): Promise<EddyResolveResult> {
    const link = this.mutable.get(key);
    if (link && link.expiresAt > this.clock()) {
      // A throwing store read (bucket down / transient 5xx) is a MISS here,
      // never a 500: the POST path HAS the dep-set, so it can recompute and
      // ride the existing failed-put degrade. Only the direct GET-by-hash
      // route (getBundle — no dep-set to recompute from) surfaces the error.
      const hit = await this.store.get(link.closureHash).catch((err) => {
        console.error(
          `eddy: bundle store read failed for linked ${link.closureHash}: ${err instanceof Error ? err.message : String(err)} — recomputing`,
        );
        return null;
      });
      throwIfAborted(signal);
      if (hit) return bundleResult(hit, true);
    }
    // Generation is assigned only after the cache path misses, preserving the
    // online-vs-cached ordering rules that existed before whole-path flighting.
    return this.startCompute(req, key, false, signal);
  }

  private admit(): () => void {
    if (this.activeResolves >= this.maxConcurrentResolves) {
      throw new EddyOverloadError(this.maxConcurrentResolves);
    }
    this.activeResolves += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.activeResolves -= 1;
    };
  }

  private startCompute(
    req: EddyResolveRequest,
    key: string,
    online: boolean,
    signal: AbortSignal | undefined,
  ): Promise<EddyResolveResult> {
    const gen = this.nextGeneration(online);
    const flight = this.compute(req, key, gen, signal);
    if (online) {
      void flight
        .finally(() => {
          this.activeOnlineGens.delete(gen);
          if (this.activeOnlineGens.size === 0) this.cachedDuringOnlineSeq = 0;
        })
        .catch(() => undefined);
    }
    return flight;
  }

  private nextGeneration(online: boolean): number {
    if (online) {
      const gen = ++this.computeSeq;
      this.activeOnlineGens.add(gen);
      return gen;
    }
    if (this.activeOnlineGens.size > 0) {
      this.cachedDuringOnlineSeq += 1;
      return Math.min(...this.activeOnlineGens) - 1 / (this.cachedDuringOnlineSeq + 1);
    }
    return ++this.computeSeq;
  }

  private async compute(
    req: EddyResolveRequest,
    key: string,
    gen: number,
    signal: AbortSignal | undefined,
  ): Promise<EddyResolveResult> {
    throwIfAborted(signal);
    // Stamp this flight's packument write-throughs with `gen` so an OLDER cached
    // flight can't roll back the shared metadata cache after a newer online
    // refresh (ADR-0194). A cached flight started DURING an online refresh gets
    // a lower gen than that active online flight, even though it started later,
    // because it may have read the pre-refresh TTL cache. Reads stay direct; the
    // per-request overlay (resolver.ts) still layers self-consistency on top.
    const packumentCache: PackumentCacheLike = {
      get: (name) => this.packuments.get(name),
      set: (name, packument) => this.packuments.setWithGen(name, packument, gen),
    };
    const result = await this.resolveFn(req, {
      ...this.resolver,
      packumentCache,
      ...(signal === undefined ? {} : { signal }),
    });
    throwIfAborted(signal);
    if (result.kind !== 'bundle') return result; // declines are not cached
    const closureHash = result.manifest.asOf.closureHash;
    return this.settleStore(closureHash, result, key, gen, signal);
  }

  /** Serialize the store settle PER closureHash: concurrent computes of the same
   *  closure (e.g. two differently-spelled dep sets resolving identically) chain
   *  FIFO, so the second's {@link doSettleStore} sees the first's stored artifact
   *  and serves it instead of overwriting the key with different-`resolvedAt`
   *  bytes (byte stability, ADR-0194 §5). Different hashes never contend. */
  private settleStore(
    closureHash: string,
    result: BundleResolveResult,
    key: string,
    gen: number,
    signal: AbortSignal | undefined,
  ): Promise<EddyResolveResult> {
    const prior = this.storeTail.get(closureHash);
    const run = (): Promise<EddyResolveResult> => {
      throwIfAborted(signal);
      return this.doSettleStore(closureHash, result, key, gen, signal);
    };
    const mine = prior ? prior.then(run, run) : run();
    const tail = mine.then(
      () => undefined,
      () => undefined,
    );
    this.storeTail.set(closureHash, tail);
    void tail.finally(() => {
      if (this.storeTail.get(closureHash) === tail) this.storeTail.delete(closureHash);
    });
    return mine;
  }

  private async doSettleStore(
    closureHash: string,
    result: BundleResolveResult,
    key: string,
    gen: number,
    signal: AbortSignal | undefined,
  ): Promise<EddyResolveResult> {
    // Immutable-tier BYTE stability (round 15): the closure hash addresses the
    // LOCKFILE CLOSURE, not the tar bytes — a recompute of the same closure
    // packs different bytes (fresh `asOf.resolvedAt`), and overwriting the
    // stored object would make the one-year-`immutable` GET URL serve different
    // bytes depending on which cache layer answers (browser/CDN vs origin). The
    // FIRST stored artifact wins: a verified store hit is served as-is —
    // keeping the ORIGINAL as-of stamp, exactly this file's recorded contract
    // (staleness visible, never silently refreshed).
    let stored: CachedBundle | null;
    try {
      stored = await this.store.get(closureHash);
    } catch (err) {
      throwIfAborted(signal);
      // A TRANSIENT read failure (bucket blip) must NOT read as a miss (round
      // 18): an object may already exist and be VALID, and PUTting these
      // fresh-`resolvedAt` bytes would overwrite it — breaking byte stability.
      // Degrade: serve the fresh compute, but do NOT put or link (that would
      // learn an unproven-durable hash); the next request re-reads + heals.
      console.error(
        `eddy: bundle store read failed for recomputed ${closureHash}: ${err instanceof Error ? err.message : String(err)} — serving the fresh compute WITHOUT overwriting a possibly-durable object`,
      );
      // Stale-link kill: a fresher compute is still the freshest answer even
      // when we cannot safely prove/store its immutable artifact. Leaving an
      // OLDER mutable link would make the next cached request serve the stale
      // closure instead of recomputing and retrying the store read.
      const cur = this.mutable.peek(key);
      if (cur && gen > cur.gen) this.mutable.delete(key);
      return bundleResult(result, false);
    }
    throwIfAborted(signal);
    if (stored) {
      // A verified GET proves the bytes, but durable-before-link also needs the
      // store's delivery metadata (S3 `immutable`) proven/repaired before this
      // process publishes a mutable dep-set link to that hash.
      try {
        await this.store.put(closureHash, { bytes: stored.bytes, manifest: stored.manifest });
      } catch (err) {
        throwIfAborted(signal);
        console.error(
          `eddy: bundle store repair/proof failed for ${closureHash}: ${err instanceof Error ? err.message : String(err)}`,
        );
        const cur = this.mutable.peek(key);
        if (cur && gen > cur.gen) this.mutable.delete(key);
        return bundleResult(stored, false);
      }
      throwIfAborted(signal);
      this.publishLink(key, closureHash, gen);
      return bundleResult(stored, true);
    }
    // A genuine MISS (absent OR poisoned — get() reads a corrupt object as null,
    // so self-heal is intact). Durable-BEFORE-link (ADR-0194 §5): the awaited put
    // guarantees a linked hash is servable (GET-by-hash via CDN/bucket) before any
    // client learns it. put is idempotent + self-healing — it re-seeds a missing
    // OR corrupt/foreign object and skips the upload only when the SAME bytes are
    // already durable.
    try {
      await this.store.put(closureHash, { bytes: result.bytes, manifest: result.manifest });
    } catch (err) {
      throwIfAborted(signal);
      // Degrade, never 500: serve the computed bundle, skip the link so the
      // next request recomputes (and retries the put).
      console.error(
        `eddy: bundle store put failed for ${closureHash}: ${err instanceof Error ? err.message : String(err)}`,
      );
      // Stale-link kill: "skip the link" is not enough when an OLDER link for
      // this key already exists — it would outlive this FRESHER compute and a
      // later cached request would serve the stale closure instead of
      // recomputing. Delete it, under the same generation guard as the publish
      // below: a NEWER compute's published link is never torn down by an older
      // failed one.
      const cur = this.mutable.peek(key);
      if (cur && gen > cur.gen) this.mutable.delete(key);
      return bundleResult(result, false);
    }
    throwIfAborted(signal);
    this.publishLink(key, closureHash, gen);
    return bundleResult(result, true);
  }

  /** Re-seed the mutable link — even on a prefer:'online' recompute, so a later
   * cached request reuses the just-computed closure (npm --prefer-online too
   * writes the lockfile it fetched). Generation guard: an OLDER compute (read
   * staler packuments) must not clobber a link a NEWER compute already
   * published — else a slow cached-policy compute finishing AFTER a fresh
   * prefer:'online' refresh would republish the stale closure. Cached computes
   * started while an online refresh is active rank below that refresh, even if
   * they start later, because they may have read the pre-refresh TTL cache. */
  private publishLink(key: string, closureHash: string, gen: number): void {
    if (this.ttlMs <= 0) return;
    const cur = this.mutable.peek(key);
    if (!cur || gen > cur.gen) {
      this.mutable.set(key, { closureHash, expiresAt: this.clock() + this.ttlMs, gen });
    }
  }
}

function abortReason(signal: AbortSignal | undefined): unknown {
  return signal?.reason ?? new Error('eddy resolve: aborted');
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortReason(signal);
}
