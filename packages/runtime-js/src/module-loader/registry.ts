import type { ModuleKind } from './resolver.ts';

/**
 * A module registry record. `exports` is shared across the system: CJS modules
 * keep it as a plain object that they write to; ESM modules expose it as a
 * `null`-prototype object with getters that read from the module's internal
 * slot map, so re-exports see live updates.
 */
export interface ModuleRecord {
  readonly id: string;
  readonly kind: ModuleKind;
  state: 'loading' | 'loaded' | 'errored';
  exports: Record<string, unknown>;
  /** Mutable slot table for ESM live bindings — `exports` getters read from here. */
  slots: Record<string, unknown>;
  /** For CJS modules, the `module` object passed to the factory. */
  cjsModule?: { exports: Record<string, unknown> };
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
   * Create-or-get. Returns the existing record without touching its state — the
   * caller is responsible for initialising fresh records before yielding the
   * thread to user code that might recurse back through `import`/`require`.
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
}
