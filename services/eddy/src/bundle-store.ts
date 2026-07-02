/**
 * BundleStore (ADR-0194 §4): the immutable `closureHash → bundle` tier behind
 * `EddyCache`, replacing the in-process entry-capped LRU (256 × 3–7MB ≈ RSS
 * risk, dies on deploy). Two implementations:
 *   - {@link MemoryBundleStore} — byte-bounded LRU; local/dev/test default.
 *   - `S3BundleStore` (`s3-bundle-store.ts`) — Object Storage behind the CDN;
 *     the origin stays stateless-restartable.
 * The contract `EddyCache` relies on (ADR-0194 §5): `put` completes before the
 * dep-set link is written (durable-before-link); `has` lets a recompute of an
 * already-stored closure skip the upload.
 */
import type { CachedBundle } from './cache.ts';

export interface BundleStore {
  get(closureHash: string): Promise<CachedBundle | null>;
  has(closureHash: string): Promise<boolean>;
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

  async has(closureHash: string): Promise<boolean> {
    return this.map.has(closureHash);
  }

  async put(closureHash: string, bundle: CachedBundle): Promise<void> {
    if (bundle.bytes.length > this.maxBytes) return; // would evict everything for nothing
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
