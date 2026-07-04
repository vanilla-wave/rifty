/**
 * BundleStore (ADR-0194 §4): the immutable `closureHash → bundle` tier behind
 * `EddyCache`, replacing the in-process entry-capped LRU (256 × 3–7MB ≈ RSS
 * risk, dies on deploy). Two implementations:
 *   - {@link MemoryBundleStore} — byte-bounded LRU; local/dev/test default.
 *   - `S3BundleStore` (`s3-bundle-store.ts`) — Object Storage behind the CDN;
 *     the origin stays stateless-restartable.
 * The contract `EddyCache` relies on (ADR-0194 §5): `put` completes before the
 * dep-set link is written (durable-before-link) AND is idempotent + self-healing
 * — it re-seeds a missing OR corrupt/foreign object (`get` reads either as a
 * miss) and skips the upload only when the SAME bytes are already durable. There
 * is deliberately no cheap `has`: a HEAD-exists check can't tell a valid object
 * from a poisoned one, so gating the heal on it would silently skip re-seeding.
 * `put` is durable-or-THROW — a settled put means GET-by-hash serves the bundle.
 * A put that cannot store (over-cap, bucket down) must reject so `EddyCache`
 * skips the link (the hash is never published unservable); a silent drop here
 * once linked hashes that 404'd on GET.
 */
import type { CachedBundle } from './cache.ts';

export interface BundleStore {
  get(closureHash: string): Promise<CachedBundle | null>;
  put(closureHash: string, bundle: CachedBundle): Promise<void>;
}

export const DEFAULT_BUNDLE_MEMORY_MAX_BYTES = 512 * 1024 * 1024;

export interface MemoryBundleStoreOptions {
  /** Total byte cap across bundles. Default {@link DEFAULT_BUNDLE_MEMORY_MAX_BYTES}. */
  maxBytes?: number;
}

export class MemoryBundleStore implements BundleStore {
  private readonly map = new Map<string, CachedBundle>();
  private readonly maxBytes: number;
  private totalBytes = 0;

  constructor(opts: MemoryBundleStoreOptions = {}) {
    this.maxBytes = opts.maxBytes ?? DEFAULT_BUNDLE_MEMORY_MAX_BYTES;
  }

  async get(closureHash: string): Promise<CachedBundle | null> {
    const bundle = this.map.get(closureHash);
    if (!bundle) return null;
    // LRU promote.
    this.map.delete(closureHash);
    this.map.set(closureHash, bundle);
    return bundle;
  }

  async put(closureHash: string, bundle: CachedBundle): Promise<void> {
    if (bundle.bytes.length > this.maxBytes) {
      // Storing would evict everything AND still not fit; a silent return here
      // would break durable-or-throw (the caller would link an unservable hash).
      throw new Error(
        `bundle ${closureHash} (${bundle.bytes.length} bytes) exceeds the memory store cap (${this.maxBytes})`,
      );
    }
    const existing = this.map.get(closureHash);
    if (existing) {
      this.map.delete(closureHash);
      this.totalBytes -= existing.bytes.length;
    }
    this.map.set(closureHash, bundle);
    this.totalBytes += bundle.bytes.length;
    while (this.totalBytes > this.maxBytes) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.totalBytes -= this.map.get(oldest)?.bytes.length ?? 0;
      this.map.delete(oldest);
    }
  }
}
