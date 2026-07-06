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

export interface PersistentEsmTransformCacheEntry {
  readonly source: string;
  readonly result: TransformResult;
}

/**
 * Cross-boot store for `transformEsm` results (ADR-0200, Q-2026-05-30-202).
 * Sync — it sits on the synchronous load path. The LOADER validates every hit
 * by exact source equality at its own boundary, so an implementation can
 * degrade, lose entries, or vanish, but never poison execution; `put` fires
 * only on recompute, so store content is always loader-produced.
 */
export interface PersistentEsmTransformCache {
  get(id: string): PersistentEsmTransformCacheEntry | undefined;
  put(id: string, entry: PersistentEsmTransformCacheEntry): void;
}

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
  /**
   * Cross-boot `transformEsm` result store (ADR-0200): a fresh loader per
   * dev-server child boot re-parses an unchanged vite dist otherwise. Consulted
   * on an in-memory miss; hits are source-validated by the loader itself.
   */
  readonly persistentEsmTransformCache?: PersistentEsmTransformCache;
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
  const persistent = opts.persistentEsmTransformCache;
  const cachedTransformEsm = (source: string, id: string): TransformResult => {
    const hit = esmAstCache.get(id);
    if (hit?.source === source) return hit.result;
    // Persistent fallback (ADR-0200): exact source match HERE — the one
    // validation boundary; a stale entry (file changed under the same id)
    // recomputes below and overwrites, so the store self-heals.
    const stored = persistent?.get(id);
    if (stored && stored.source === source) {
      esmAstCache.set(id, stored);
      return stored.result;
    }
    const out = transformEsm(source, id);
    esmAstCache.set(id, { source, result: out });
    persistent?.put(id, { source, result: out });
    return out;
  };

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
        return wrapCjsAsEsmNamespace(loadBuiltinOrThrow(id));
      }
      const cached = registry.get(id);
      if (cached && cached.state === 'loaded') return cached.exports;
      if (cached && cached.state === 'loading') {
        return cached.exports;
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
        return wrapCjsAsEsmNamespace(loadBuiltinOrThrow(resolved.id));
      }
      const cached = registry.get(resolved.id);
      if (cached && cached.state === 'loaded') return cached.exports;
      if (cached && cached.state === 'loading') {
        return cached.exports;
      }
      if (resolved.kind === 'esm') {
        return executeEsm(resolved, { ...deps });
      }
      if (resolved.kind === 'json') {
        const cjsExports = executeCjs(resolved, { ...deps });
        return wrapCjsAsEsmNamespace(cjsExports);
      }
      // CJS imported from ESM — wrap exports as an ESM-shaped namespace.
      const cjsExports = executeCjs(resolved, { ...deps });
      return wrapCjsAsEsmNamespace(cjsExports);
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
      // Keep the strip cache + ESM AST cache coherent with the executed-module
      // cache, dropping them in lockstep.
      if (id === undefined) {
        transformCache.clear();
        esmAstCache.clear();
        sourceMaps.clear();
      } else {
        transformCache.delete(id);
        esmAstCache.delete(id);
        sourceMaps.delete(id);
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
