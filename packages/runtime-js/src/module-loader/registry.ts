import type { ModuleKind } from './resolver.ts';

/** Exact registry record exposed as the CJS `module` object during execution. */
export interface CjsModule extends ModuleRecord {
  readonly filename: string;
  readonly path: string;
  readonly paths: string[];
  readonly parent: CjsModule | null | undefined;
  readonly children: CjsModule[];
  readonly loaded: boolean;
  _compile(source: string, filename: string): void;
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
  /** Failure from this execution generation; retained for an issued import job. */
  error?: unknown;
  exports: Record<string, unknown>;
  /** Mutable slot table for ESM live bindings — `exports` getters read from here. */
  slots: Record<string, unknown>;
  /** Node-visible CJS fields exist on this same record once CJS loading starts. */
  filename?: string;
  path?: string;
  paths?: string[];
  parent?: CjsModule | null;
  children?: CjsModule[];
  loaded?: boolean;
  _compile?(source: string, filename: string): void;
  /** Lazy ESM view of the final CJS exports. Same lifetime as this record. */
  cjsNamespace?: Record<string, unknown>;
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
      // The record IS the object CJS code receives as `module` (ADR-0325), so
      // the loader's own bookkeeping must not enumerate: Node's module has no
      // `kind`/`state`/`slots`/`error`, and packages copy or serialize
      // `module` by its keys. Writable and configurable — only invisible.
      rec = { id, exports: Object.create(null) } as ModuleRecord;
      for (const [key, value] of [
        ['kind', kind],
        ['state', 'loading'],
        ['slots', Object.create(null)],
      ] as const) {
        Object.defineProperty(rec, key, {
          value,
          writable: true,
          enumerable: false,
          configurable: true,
        });
      }
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
   * execution record, leaving the CJS import job, id-keyed transform/AST caches,
   * and resolver caches stale. HMR / file-update callers MUST use
   * `ModuleLoader.invalidate(id)` (loader.ts), which drops all caches in
   * lockstep. Treat this method as a loader-internal primitive.
   */
  invalidate(id?: string): void {
    if (id === undefined) {
      this.records.clear();
      return;
    }
    this.records.delete(id);
  }
}
