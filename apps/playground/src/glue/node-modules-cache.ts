/**
 * In-memory cache over a {@link NodeModulesBridge} (ADR-0080).
 *
 * Solid-free. Coalesces concurrent expands of the same directory by storing the
 * *promise* (not the resolved value), so two near-simultaneous expands issue ONE
 * remote read. A rejected read is evicted so a transient timeout is retryable
 * rather than poisoned forever. `peek` gives the explorer a synchronous
 * "already loaded?" check to decide between a sync render and a loading row.
 * `invalidate` drops a subtree (or all) — called on mode-leave so a stale
 * `node_modules` view never lingers across a real-vite off→on cycle.
 *
 * Bounded by being dropped on mode-leave; per-dir listings are small, so v1 has
 * no LRU eviction (revisit only if a session expands thousands of dirs).
 */
import type { NodeModulesBridge, NodeModulesDirEntry } from './node-modules-port.ts';

export class NodeModulesCache {
  /** path → in-flight/settled listing promise (the coalescing key). */
  private readonly dirs = new Map<string, Promise<readonly NodeModulesDirEntry[]>>();
  /** path → resolved listing, for the synchronous {@link peek}. */
  private readonly resolved = new Map<string, readonly NodeModulesDirEntry[]>();

  constructor(private readonly bridge: NodeModulesBridge) {}

  /** Lazily list one directory level, coalescing concurrent calls. */
  readdir(path: string): Promise<readonly NodeModulesDirEntry[]> {
    const cached = this.dirs.get(path);
    if (cached) return cached;
    const promise = this.bridge.readdir(path).then(
      (entries) => {
        this.resolved.set(path, entries);
        return entries;
      },
      (err: unknown) => {
        // Evict so a retry re-issues — a transient timeout isn't poisoned.
        this.dirs.delete(path);
        this.resolved.delete(path);
        throw err;
      },
    );
    this.dirs.set(path, promise);
    return promise;
  }

  /** Read one file under node_modules. Not cached — the editor opens one at a
   *  time, so caching adds little (and could pin large buffers). */
  readFile(path: string): Promise<{ readonly size: number; readonly content: Uint8Array | null }> {
    return this.bridge.readFile(path);
  }

  /** The resolved listing for `path`, or undefined if not yet loaded. */
  peek(path: string): readonly NodeModulesDirEntry[] | undefined {
    return this.resolved.get(path);
  }

  /** Whether a listing for `path` has been requested (in-flight or settled). */
  has(path: string): boolean {
    return this.dirs.has(path);
  }

  /** Drop the subtree rooted at `path`, or everything when `path` is omitted. */
  invalidate(path?: string): void {
    if (path === undefined) {
      this.dirs.clear();
      this.resolved.clear();
      return;
    }
    const prefix = `${path}/`;
    for (const key of [...this.dirs.keys()]) {
      if (key === path || key.startsWith(prefix)) this.dirs.delete(key);
    }
    for (const key of [...this.resolved.keys()]) {
      if (key === path || key.startsWith(prefix)) this.resolved.delete(key);
    }
  }

  /** Drop everything (alias for `invalidate()`). */
  clear(): void {
    this.invalidate();
  }

  /** Dispose the underlying bridge and clear the cache. */
  dispose(): void {
    this.bridge.dispose();
    this.dirs.clear();
    this.resolved.clear();
  }
}
