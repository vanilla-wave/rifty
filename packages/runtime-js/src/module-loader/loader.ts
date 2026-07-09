import type { FsSync } from '@riftydev/vfs';
import { loadBuiltin } from '../builtins/index.ts';
import { __setCreateRequireImpl } from '../builtins/module.ts';
import { setSameRealmWorkerModuleImporter } from '../builtins/worker_threads.ts';
import { ref as keepaliveRef, unref as keepaliveUnref } from '../internal/event-loop-keepalive.ts';
import { executeCjs } from './cjs.ts';
import { ModuleLoadError } from './errors.ts';
import { type TransformResult, transformEsm } from './esm-ast.ts';
import { type TransformSourceHook, executeEsm } from './esm.ts';
import { wrapCjsAsEsmNamespace } from './interop.ts';
import { ModuleRegistry } from './registry.ts';
import type { PathAliases, ResolvedModule } from './resolver.ts';
import { type Resolver, createResolver } from './resolver.ts';
import { SourceMapRegistry, extractInlineSourceMap } from './source-maps.ts';

export type { TransformSourceHook } from './esm.ts';
export type { PathAliases } from './resolver.ts';

export interface ModuleLoaderOptions {
  /** Working directory used when the caller passes a relative `entry` to `import`/`require`. */
  readonly cwd?: string;
  /**
   * esbuild guest cwd/preopen, `workspace` of every {@link TransformSourceHook}
   * call. Defaults to {@link ModuleLoaderOptions.cwd} (or the internal entry stub).
   * A single root suffices: a type-strip transform doesn't resolve relative
   * imports through esbuild — rifty's resolver does (ADR-0052 D5).
   */
  readonly workspace?: string;
  /**
   * Per-file source transform for `.ts`/`.tsx`/`.jsx` (see {@link TransformSourceHook}).
   * When absent these still resolve (ADR-0053) but their TS syntax reaches the
   * AST rewriter unstripped; the transform-not-configured throw is feature-02 T3.
   */
  readonly transformSource?: TransformSourceHook;
  /**
   * tsconfig-style path aliases (ADR-0066), e.g. `{ "@/*": "/workspace/src/*" }`.
   * Targets are absolute VFS path patterns; when supplied, this explicit map wins
   * over auto-discovery.
   * Absent = Node-faithful resolution (bare `@/foo` is `MODULE_NOT_FOUND`).
   */
  readonly paths?: PathAliases;
  /**
   * Locate the nearest `tsconfig.json` and derive `compilerOptions.paths` via
   * TypeScript's parser (`extends`, JSONC, `baseUrl` included). Off by default
   * so vanilla Node-style resolution stays byte-stable.
   */
  readonly autoDiscoverTsconfigPaths?: boolean;
}

export interface ModuleLoader {
  /** Synchronous CJS require — only works for CJS/JSON modules. */
  require(specifier: string, from?: string): unknown;
  /** Asynchronous import — works for both CJS and ESM. */
  import(specifier: string, from?: string): Promise<Record<string, unknown>>;
  /** Direct id-based loader (used by REPL and tests). */
  loadById(id: string, esm?: boolean): Promise<Record<string, unknown>>;
  /**
   * The coherent invalidation seam. Drops the module record AND the id-keyed
   * transform/AST caches AND the resolver caches in lockstep, so a re-load
   * re-resolves + re-transforms cleanly. No `id` wipes everything (the
   * `load-fixture` hot path uses this so loader + resolver survive editor saves);
   * an absolute `id` removes only that entry — the hook for HMR / per-file
   * updates. See {@link ModuleRegistry.invalidate} for the
   * single-entry-vs-dependency-graph contract (HMR callers MUST call THIS, not
   * `registry.invalidate`).
   */
  invalidate(id?: string): void;
  /**
   * WARNING: do NOT call `registry.invalidate(id)` for HMR — it drops only the
   * executed-module record, leaving transform/AST/resolver caches stale. Use
   * {@link ModuleLoader.invalidate} instead. Exposed for read access (e.g. tests
   * inspecting cached records).
   */
  readonly registry: ModuleRegistry;
  readonly resolver: Resolver;
}

const STUB_FROM_FILE_DEFAULT = '/__entry__';

setSameRealmWorkerModuleImporter(async (vfs, script, cwd) => {
  const loader = createModuleLoader(vfs, { cwd });
  return loader.import(script, script);
});

type LoaderRequire = ((specifier: string) => unknown) & {
  resolve: (specifier: string) => string;
  cache: Record<string, unknown>;
  extensions: Record<string, never>;
  main: undefined;
};

/**
 * Load a `node:`-prefixed builtin or throw `MODULE_NOT_FOUND`. Shared by sync
 * and async paths; deliberately returns raw CJS-shaped exports — the async path
 * wraps via {@link wrapCjsAsEsmNamespace} at the call site.
 */
function loadBuiltinOrThrow(id: string): Record<string, unknown> {
  const builtin = loadBuiltin(id);
  if (!builtin) throw new ModuleLoadError('MODULE_NOT_FOUND', id, `Built-in '${id}' not found`);
  return builtin;
}

export function createModuleLoader(vfs: FsSync, opts: ModuleLoaderOptions = {}): ModuleLoader {
  const registry = new ModuleRegistry();
  const resolver = createResolver(vfs, {
    paths: opts.paths,
    autoDiscoverTsconfigPaths: opts.autoDiscoverTsconfigPaths,
  });
  const cwd = opts.cwd ?? STUB_FROM_FILE_DEFAULT;
  const workspace = opts.workspace ?? opts.cwd ?? STUB_FROM_FILE_DEFAULT;

  // Strip cache: WASI esbuild is a full process spawn per module, so re-stripping
  // byte-identical `.ts` across repeated loads is wasted work. Keep the cache
  // under the absolute id but validate against the current source text so an
  // in-place edit at the same path cannot serve a stale transform.
  const transformCache = new Map<string, { readonly source: string; readonly code: string }>();
  const sourceMaps = new SourceMapRegistry();
  const cachedTransform: TransformSourceHook | undefined =
    opts.transformSource &&
    (async (req) => {
      const hit = transformCache.get(req.id);
      if (hit?.source === req.source) return hit.code;
      const out = await opts.transformSource!(req);
      const extracted = extractInlineSourceMap(out);
      if (extracted.map) sourceMaps.set(req.id, extracted.map);
      else sourceMaps.delete(req.id);
      transformCache.set(req.id, { source: req.source, code: extracted.code });
      return extracted.code;
    });

  // ESM AST cache: `transformEsm` (acorn parse + walk) is the heaviest
  // per-module CPU step. Cache by id but validate the transformed JS text, so a
  // changed TS source at the same path cannot reuse a stale AST.
  const esmAstCache = new Map<
    string,
    { readonly source: string; readonly result: TransformResult }
  >();
  const cachedTransformEsm = (source: string, id: string): TransformResult => {
    const hit = esmAstCache.get(id);
    if (hit?.source === source) return hit.result;
    const out = transformEsm(source, id);
    esmAstCache.set(id, { source, result: out });
    return out;
  };

  // ONE ESM namespace per non-ESM module id (Node parity): every importer —
  // first load, registry cache hit, require()-then-import — must see the SAME
  // wrapped namespace with its `default` binding. Wrapping per call leaked the
  // RAW CJS exports on cache hits (`default` === undefined for the second
  // importer; broke vite7's tinyglobby→picomatch after fdir require()d it).
  // The entry is validated against the CURRENT exports object identity: a
  // builtin re-registration (builtin-registry contract: "discards its cached
  // namespace so the next loadBuiltin invokes the new factory") yields a NEW
  // exports object and must get a fresh wrapper — a blind id-keyed memo served
  // the stale namespace forever. Also dropped in lockstep with the registry in
  // `invalidate`.
  const esmNamespaces = new Map<
    string,
    { readonly source: Record<string, unknown>; readonly ns: Record<string, unknown> }
  >();
  function esmNamespaceFor(id: string, exportsObj: Record<string, unknown>) {
    const hit = esmNamespaces.get(id);
    if (hit && hit.source === exportsObj) return hit.ns;
    const ns = wrapCjsAsEsmNamespace(exportsObj);
    esmNamespaces.set(id, { source: exportsObj, ns });
    return ns;
  }

  const deps = {
    registry,
    resolver,
    workspace,
    sourceMaps,
    transformSource: cachedTransform,
    transformEsm: cachedTransformEsm,
    resolve(specifier: string, fromFile: string, esm: boolean): ResolvedModule {
      return resolver.resolve(specifier, { fromFile, esm });
    },
    loadSync(id: string): Record<string, unknown> {
      if (id.startsWith('node:')) {
        return loadBuiltinOrThrow(id);
      }
      const cached = registry.get(id);
      if (cached && cached.state === 'loaded') return cached.exports;
      if (cached && cached.state === 'loading' && cached.kind !== 'esm') {
        return cached.cjsModule?.exports ?? cached.exports;
      }
      const resolved = readResolvedById(id);
      if (resolved.kind === 'esm') {
        throw new ModuleLoadError(
          'UNSUPPORTED_PROTOCOL',
          id,
          'Synchronous require() of ESM is not supported.',
        );
      }
      return executeCjs(resolved, {
        ...deps,
      });
    },
    async loadAsync(id: string): Promise<Record<string, unknown>> {
      if (id.startsWith('node:')) {
        return esmNamespaceFor(id, loadBuiltinOrThrow(id));
      }
      const cached = registry.get(id);
      if (cached && cached.state === 'loaded') {
        return cached.kind === 'esm' ? cached.exports : esmNamespaceFor(id, cached.exports);
      }
      if (cached && cached.state === 'loading') {
        // In-cycle CJS exports are partial: wrap WITHOUT memoizing (the wrap
        // snapshots named keys, so the post-load importer must re-wrap the
        // complete exports via the memoized path above).
        return cached.kind === 'esm' ? cached.exports : wrapCjsAsEsmNamespace(cached.exports);
      }
      // Drop the SECOND resolve+read+scope-walk: carry the already-resolved
      // module (perf #14). The id-only path stays for direct id callers
      // (cjs/interop), which never hold a ResolvedModule.
      return deps.loadAsyncResolved(readResolvedById(id));
    },
    // Async load of an ALREADY-RESOLVED module — skips re-resolving (perf #14).
    // The registry short-circuit is replicated here (not only in the id path) so
    // direct callers (import/loadById/esm preload) keep dedup + cycle handling.
    async loadAsyncResolved(resolved: ResolvedModule): Promise<Record<string, unknown>> {
      // A `node:` builtin reaches here when an ESM module statically imports it
      // (the preload carries the resolved `{kind:'builtin'}` record). Mirror the
      // id-path's `node:` short-circuit — builtins have no source to execute.
      if (resolved.kind === 'builtin') {
        return esmNamespaceFor(resolved.id, loadBuiltinOrThrow(resolved.id));
      }
      const cached = registry.get(resolved.id);
      if (cached && cached.state === 'loaded') {
        return cached.kind === 'esm'
          ? cached.exports
          : esmNamespaceFor(resolved.id, cached.exports);
      }
      if (cached && cached.state === 'loading') {
        // In-cycle CJS exports are partial: wrap WITHOUT memoizing (see loadAsync).
        return cached.kind === 'esm' ? cached.exports : wrapCjsAsEsmNamespace(cached.exports);
      }
      if (resolved.kind === 'esm') {
        return executeEsm(resolved, { ...deps });
      }
      // CJS/JSON imported from ESM — the shared per-id ESM-shaped namespace.
      const cjsExports = executeCjs(resolved, { ...deps });
      return esmNamespaceFor(resolved.id, cjsExports);
    },
  };

  function readResolvedById(id: string): ResolvedModule {
    if (id.startsWith('node:')) {
      return { id, kind: 'builtin', source: '', packageRoot: null };
    }
    // Re-resolve via the id itself as both specifier and fromFile so the
    // absolute path matches.
    return resolver.resolve(id, { fromFile: id, esm: false });
  }

  __setCreateRequireImpl((from: string): LoaderRequire => {
    const req = ((specifier: string): unknown => {
      const resolved = resolver.resolve(specifier, { fromFile: from, esm: false });
      if (resolved.kind === 'esm') {
        throw new ModuleLoadError(
          'UNSUPPORTED_PROTOCOL',
          specifier,
          `require() of ES Module ${resolved.id} from ${from} is not supported. Use dynamic import() instead.`,
          from,
        );
      }
      return deps.loadSync(resolved.id);
    }) as LoaderRequire;
    req.resolve = (specifier: string): string =>
      resolver.resolve(specifier, { fromFile: from, esm: false }).id;
    req.cache = Object.create(null) as Record<string, unknown>;
    req.extensions = Object.create(null) as Record<string, never>;
    req.main = undefined;
    return req;
  });

  return {
    require(specifier, from = cwd) {
      const resolved = resolver.resolve(specifier, { fromFile: from, esm: false });
      if (resolved.kind === 'builtin') {
        const builtin = loadBuiltin(resolved.id);
        if (!builtin)
          throw new ModuleLoadError(
            'MODULE_NOT_FOUND',
            specifier,
            `Built-in '${specifier}' not found`,
          );
        return builtin;
      }
      if (resolved.kind === 'esm') {
        throw new ModuleLoadError(
          'UNSUPPORTED_PROTOCOL',
          specifier,
          `require() of ES Module ${resolved.id} is not supported. Use import() instead.`,
        );
      }
      return executeCjs(resolved, { ...deps });
    },
    async import(specifier, from = cwd) {
      keepaliveRef();
      try {
        const resolved = resolver.resolve(specifier, { fromFile: from, esm: true });
        return await deps.loadAsyncResolved(resolved);
      } finally {
        keepaliveUnref();
      }
    },
    loadById(id, esm = false) {
      const resolved = resolver.resolve(id, { fromFile: id, esm });
      return deps.loadAsyncResolved(resolved);
    },
    invalidate(id) {
      registry.invalidate(id);
      // Keep the strip cache + ESM AST cache + memoized CJS namespaces coherent
      // with the executed-module cache, dropping them in lockstep.
      if (id === undefined) {
        transformCache.clear();
        esmAstCache.clear();
        sourceMaps.clear();
        esmNamespaces.clear();
      } else {
        transformCache.delete(id);
        esmAstCache.delete(id);
        sourceMaps.delete(id);
        esmNamespaces.delete(id);
      }
      // Resolver caches (package.json parses #5 + resolution memo #15) are
      // input-keyed and cannot be pruned by module id, so ANY invalidate —
      // full OR targeted — clears them whole. A stale package.json (load-fixture
      // reload) or a stale resolution would silently mis-classify / mis-route a
      // module. TODO(backlog: perf/loader-packagejson-parse-cache),
      // TODO(backlog: perf/resolver-resolution-cache).
      resolver.clearCaches();
    },
    registry,
    resolver,
  };
}
