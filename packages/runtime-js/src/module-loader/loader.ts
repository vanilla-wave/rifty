import type { FsSync } from '@riftydev/vfs';
import { loadBuiltin } from '../builtins/index.ts';
import { executeCjs } from './cjs.ts';
import { ModuleLoadError } from './errors.ts';
import { type TransformResult, transformEsm } from './esm-ast.ts';
import { type TransformSourceHook, executeEsm } from './esm.ts';
import { wrapCjsAsEsmNamespace } from './interop.ts';
import { ModuleRegistry } from './registry.ts';
import type { PathAliases, ResolvedModule } from './resolver.ts';
import { type Resolver, createResolver } from './resolver.ts';

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
   * Targets are absolute VFS path patterns; the caller (not the resolver) reads
   * `compilerOptions.paths` and resolves them to absolute patterns.
   * Absent = Node-faithful resolution (bare `@/foo` is `MODULE_NOT_FOUND`).
   */
  readonly paths?: PathAliases;
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
  const resolver = createResolver(vfs, { paths: opts.paths });
  const cwd = opts.cwd ?? STUB_FROM_FILE_DEFAULT;
  const workspace = opts.workspace ?? opts.cwd ?? STUB_FROM_FILE_DEFAULT;

  // Id-keyed strip cache: WASI esbuild is a full process spawn per module, so
  // re-stripping the same `.ts` across the import graph (or repeated loads in
  // one loader) is wasted work. Key by absolute resolved id (installed sources
  // are immutable per package version in the VFS overlay). Wrapping
  // `opts.transformSource` keeps `esm.ts` cache-unaware. TODO(backlog: runtime-js/ts-strip-transform-cache).
  const transformCache = new Map<string, string>();
  const cachedTransform: TransformSourceHook | undefined =
    opts.transformSource &&
    (async (req) => {
      const hit = transformCache.get(req.id);
      if (hit !== undefined) return hit;
      const out = await opts.transformSource!(req);
      transformCache.set(req.id, out);
      return out;
    });

  // Id-keyed ESM AST cache: `transformEsm` (acorn parse + walk) is the heaviest
  // per-module CPU step, re-run for every byte-identical module on each
  // editor-save `invalidate()` loop. `transformEsm` is pure, so memoizing by
  // absolute resolved id is observationally transparent. Dropped in lockstep
  // with `transformCache`/registry (same lifecycle). TODO(backlog: perf/transformesm-result-cache).
  const esmAstCache = new Map<string, TransformResult>();
  const cachedTransformEsm = (source: string, id: string): TransformResult => {
    const hit = esmAstCache.get(id);
    if (hit !== undefined) return hit;
    const out = transformEsm(source, id);
    esmAstCache.set(id, out);
    return out;
  };

  const deps = {
    registry,
    resolver,
    workspace,
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
      const resolved = resolver.resolve(specifier, { fromFile: from, esm: true });
      return deps.loadAsyncResolved(resolved);
    },
    loadById(id, esm = false) {
      const resolved = resolver.resolve(id, { fromFile: id, esm });
      return deps.loadAsyncResolved(resolved);
    },
    invalidate(id) {
      registry.invalidate(id);
      // Keep the strip cache + ESM AST cache coherent with the executed-module
      // cache, dropping them in lockstep (TODO(backlog: runtime-js/ts-strip-transform-cache),
      // TODO(backlog: perf/transformesm-result-cache)).
      if (id === undefined) {
        transformCache.clear();
        esmAstCache.clear();
      } else {
        transformCache.delete(id);
        esmAstCache.delete(id);
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
