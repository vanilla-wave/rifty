import { NotImplementedError } from '@riftydev/io';
import { type CjsStaticExports, lexCjsStaticExports } from './cjs-static-exports.ts';
import { cjsNamespaceFor, primeCjsNamespace } from './interop.ts';
import type { ModuleRecord, ModuleRegistry } from './registry.ts';
import type { ResolvedModule, Resolver } from './resolver.ts';

type CjsImportJob =
  | { readonly kind: 'module'; readonly promise: Promise<Record<string, unknown>> }
  | {
      readonly kind: 'builtin';
      readonly outer: Record<string, unknown>;
      readonly promise: Promise<Record<string, unknown>>;
    };

interface StaticNameNode {
  readonly names: Set<string>;
  readonly reexports: StaticNameNode[];
  opaque: boolean;
}

export interface CjsInteropAuthority {
  staticImportNames(resolved: ResolvedModule): ReadonlySet<string> | null;
  importJob(id: string): Promise<Record<string, unknown>> | undefined;
  importBuiltin(id: string): Promise<Record<string, unknown>>;
  importCjs(resolved: ResolvedModule, execute: () => void): Promise<Record<string, unknown>>;
  loadSyncForImport(resolved: ResolvedModule, execute: () => void): Record<string, unknown>;
  primeSyncImport(resolved: ResolvedModule): Record<string, unknown>;
  invalidate(id?: string): void;
}

/** Owns the CJS import job, static surface, and primed namespace as one cache generation. */
export function createCjsInteropAuthority(options: {
  readonly registry: ModuleRegistry;
  readonly resolver: Resolver;
  readonly loadBuiltin: (id: string) => Record<string, unknown>;
}): CjsInteropAuthority {
  const { registry, resolver, loadBuiltin } = options;
  const importJobs = new Map<string, CjsImportJob>();
  const primedNamespaces = new Map<string, Record<string, unknown>>();
  const lexCache = new Map<
    string,
    { readonly source: string; readonly result: CjsStaticExports }
  >();

  function cachedStaticExports(resolved: ResolvedModule): CjsStaticExports {
    const hit = lexCache.get(resolved.id);
    if (hit?.source === resolved.source) return hit.result;
    const result = lexCjsStaticExports(resolved.source, resolved.id);
    lexCache.set(resolved.id, { source: resolved.source, result });
    return result;
  }

  function buildStaticNameNode(
    resolved: ResolvedModule,
    nodes: Map<string, StaticNameNode>,
  ): StaticNameNode {
    const key = `${resolved.kind}\0${resolved.id}`;
    const cached = nodes.get(key);
    if (cached) return cached;
    const node: StaticNameNode = { names: new Set(), reexports: [], opaque: false };
    nodes.set(key, node);

    if (resolved.kind === 'esm') {
      node.opaque = true;
      return node;
    }
    node.names.add('default');
    if (resolved.kind === 'builtin') {
      for (const name of Object.keys(loadBuiltin(resolved.id))) node.names.add(name);
      return node;
    }
    if (resolved.kind === 'json') {
      const outer = JSON.parse(resolved.source) as unknown;
      if (outer !== null && typeof outer === 'object') {
        for (const name of Object.keys(outer)) node.names.add(name);
      }
      return node;
    }
    if (resolved.kind === 'text') return node;

    node.names.add('module.exports');
    const lexed = cachedStaticExports(resolved);
    for (const name of lexed.names) node.names.add(name);
    for (const specifier of lexed.reexports) {
      const child = resolver.resolve(specifier, { fromFile: resolved.id, esm: false });
      if (child.kind !== 'cjs' && child.kind !== 'esm') continue;
      node.reexports.push(buildStaticNameNode(child, nodes));
    }
    return node;
  }

  function staticImportNames(resolved: ResolvedModule): ReadonlySet<string> | null {
    const nodes = new Map<string, StaticNameNode>();
    const root = buildStaticNameNode(resolved, nodes);
    let changed = true;
    while (changed) {
      changed = false;
      for (const node of nodes.values()) {
        for (const child of node.reexports) {
          if (child.opaque && !node.opaque) {
            node.opaque = true;
            changed = true;
          }
          for (const name of child.names) {
            if (name === 'default' || node.names.has(name)) continue;
            node.names.add(name);
            changed = true;
          }
        }
      }
    }
    return root.opaque ? null : root.names;
  }

  function knownNames(resolved: ResolvedModule): ReadonlySet<string> {
    return staticImportNames(resolved) ?? new Set();
  }

  function builtinRecord(id: string, outer: Record<string, unknown>): ModuleRecord {
    const cached = registry.get(id);
    if (cached?.kind === 'builtin' && cached.state === 'loaded' && cached.exports === outer) {
      return cached;
    }
    if (cached) registry.invalidate(id);
    const record = registry.getOrCreate(id, 'builtin');
    record.exports = outer;
    record.state = 'loaded';
    return record;
  }

  function importBuiltin(id: string): Promise<Record<string, unknown>> {
    const outer = loadBuiltin(id);
    const cached = importJobs.get(id);
    if (cached?.kind === 'builtin' && cached.outer === outer) return cached.promise;
    const resolved: ResolvedModule = { id, kind: 'builtin', source: '', packageRoot: null };
    const promise = Promise.resolve(
      cjsNamespaceFor(builtinRecord(id, outer), undefined, knownNames(resolved)),
    );
    importJobs.set(id, { kind: 'builtin', outer, promise });
    return promise;
  }

  function loadedNamespace(resolved: ResolvedModule, execute: () => void): Record<string, unknown> {
    execute();
    const record = registry.get(resolved.id);
    if (!record || record.state !== 'loaded' || record.kind === 'esm') {
      throw new Error(`CJS import did not produce a loaded record: ${resolved.id}`);
    }
    return cjsNamespaceFor(record, primedNamespaces.get(record.id), knownNames(resolved));
  }

  function importCjs(
    resolved: ResolvedModule,
    execute: () => void,
  ): Promise<Record<string, unknown>> {
    const cachedJob = importJobs.get(resolved.id);
    if (cachedJob) return cachedJob.promise;

    const captured = registry.get(resolved.id);
    const capturedPrimedNamespace = primedNamespaces.get(resolved.id);
    let resolveJob!: (namespace: Record<string, unknown>) => void;
    let rejectJob!: (error: unknown) => void;
    const promise = new Promise<Record<string, unknown>>((resolve, reject) => {
      resolveJob = resolve;
      rejectJob = reject;
    });
    importJobs.set(resolved.id, { kind: 'module', promise });

    if (captured?.state === 'loading' && captured.kind !== 'esm') {
      // One checkpoint observes that exact synchronous require generation.
      void Promise.resolve().then(() => {
        try {
          if (captured.state === 'loaded') {
            resolveJob(cjsNamespaceFor(captured, capturedPrimedNamespace, knownNames(resolved)));
            return;
          }
          if (captured.state === 'errored') {
            const currentJob = importJobs.get(resolved.id);
            if (currentJob?.promise !== promise) {
              rejectJob(
                captured.error ??
                  new Error(`Invalidated CJS generation failed without an error: ${resolved.id}`),
              );
              return;
            }
            // TODO(backlog: runtime-js/require-cache-module-record-surface)
            rejectJob(new NotImplementedError('module-loader.cjs-import-job-failed-require'));
            return;
          }
          rejectJob(new Error(`CJS record remained loading after evaluation: ${resolved.id}`));
        } catch (error) {
          rejectJob(error);
        }
      });
      return promise;
    }

    try {
      resolveJob(loadedNamespace(resolved, execute));
    } catch (error) {
      rejectJob(error);
    }
    return promise;
  }

  function loadSyncForImport(
    resolved: ResolvedModule,
    execute: () => void,
  ): Record<string, unknown> {
    if (resolved.kind === 'builtin') {
      const outer = loadBuiltin(resolved.id);
      return cjsNamespaceFor(builtinRecord(resolved.id, outer), undefined, knownNames(resolved));
    }
    if (resolved.kind === 'esm') {
      throw new Error(`ESM static edge bypassed the ESM job graph: ${resolved.id}`);
    }
    return loadedNamespace(resolved, execute);
  }

  function primeSyncImport(resolved: ResolvedModule): Record<string, unknown> {
    if (resolved.kind === 'builtin') {
      const outer = loadBuiltin(resolved.id);
      return cjsNamespaceFor(builtinRecord(resolved.id, outer), undefined, knownNames(resolved));
    }
    if (resolved.kind === 'esm') {
      throw new Error(`ESM static edge requested a non-ESM namespace: ${resolved.id}`);
    }
    const record = registry.get(resolved.id);
    if (record?.state === 'loaded' && record.kind !== 'esm') {
      return cjsNamespaceFor(record, primedNamespaces.get(resolved.id), knownNames(resolved));
    }
    let namespace = primedNamespaces.get(resolved.id);
    if (!namespace) {
      namespace = primeCjsNamespace(resolved.kind, knownNames(resolved));
      primedNamespaces.set(resolved.id, namespace);
    }
    return namespace;
  }

  return {
    staticImportNames,
    importJob: (id) => importJobs.get(id)?.promise,
    importBuiltin,
    importCjs,
    loadSyncForImport,
    primeSyncImport,
    invalidate(id) {
      if (id === undefined) {
        importJobs.clear();
        primedNamespaces.clear();
        lexCache.clear();
      } else {
        importJobs.delete(id);
        primedNamespaces.delete(id);
        lexCache.delete(id);
      }
    },
  };
}
