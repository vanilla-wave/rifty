import type { ModuleKind } from './resolver.ts';

/** Node-visible metadata object passed to each CommonJS wrapper. */
export interface CjsModule {
  id: string;
  path: string;
  exports: Record<string, unknown>;
  filename: string;
  loaded: boolean;
  /** First CommonJS parent; absent for a module loaded from a non-CJS entry. */
  parent?: CjsModule | null;
  children: CjsModule[];
  paths: string[];
}

/**
 * Module registry record. `exports` is shared: CJS modules write to it as a
 * plain object; ESM modules expose it as a `null`-prototype object whose getters
 * read from the slot map, so re-exports see live updates.
 */
export interface ModuleRecord {
  readonly id: string;
  readonly kind: ModuleKind;
  state: 'loading' | 'loaded' | 'errored';
  exports: Record<string, unknown>;
  /** Mutable slot table for ESM live bindings — `exports` getters read from here. */
  slots: Record<string, unknown>;
  /** For CJS modules, the `module` object passed to the factory. */
  cjsModule?: CjsModule;
}

export class ModuleRegistry {
  private readonly records: Map<string, ModuleRecord> = new Map();

  has(id: string): boolean {
    return this.records.has(id);
  }

  get(id: string): ModuleRecord | undefined {
    return this.records.get(id);
  }

  /**
   * Create-or-get. Returns an existing record without touching its state — the
   * caller must initialise fresh records before yielding to user code that might
   * recurse back through `import`/`require`.
   */
  getOrCreate(id: string, kind: ModuleKind): ModuleRecord {
    let rec = this.records.get(id);
    if (!rec) {
      rec = {
        id,
        kind,
        state: 'loading',
        exports: Object.create(null),
        slots: Object.create(null),
      };
      this.records.set(id, rec);
    }
    return rec;
  }

  clear(): void {
    this.records.clear();
  }

  /**
   * Drop records so they re-resolve + re-execute on next `require`/`import`.
   * No `id` wipes the whole registry (used by the `load-fixture` hot path so the
   * worker entry keeps its `ModuleLoader`/`Resolver` alive across editor saves).
   * An absolute `id` drops only that record, leaving siblings cached — the hook
   * for editor-driven HMR / file-update messages. A missing id is a no-op
   * (matches `Map.delete` semantics).
   *
   * Single-entry drop only: parents that already imported the invalidated id keep
   * their resolved namespace until they too are invalidated. Dependency-graph
   * propagation is HMR-grade work, left to the downstream layer (see 2026-05-26
   * architecture review, Tier 1 #4 / D-E).
   *
   * WARNING: this is NOT the coherent invalidation seam. It drops ONLY the
   * executed-module record, leaving the id-keyed transform/AST caches (and the
   * resolver caches) stale — a subsequent load would re-run a cached transform.
   * HMR / file-update callers MUST use `ModuleLoader.invalidate(id)` (loader.ts),
   * which drops all caches in lockstep. Treat this method as a loader-internal
   * primitive.
   */
  invalidate(id?: string): void {
    if (id === undefined) {
      this.records.clear();
      return;
    }
    this.records.delete(id);
  }
}
