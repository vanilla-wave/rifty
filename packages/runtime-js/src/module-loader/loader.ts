import { NotImplementedError } from '@riftydev/io';
import type { FsSync } from '@riftydev/vfs';
import { loadBuiltin } from '../builtins/index.ts';
import { __setCreateRequireImpl } from '../builtins/module.ts';
import { setSameRealmWorkerModuleImporter } from '../builtins/worker_threads.ts';
import { ref as keepaliveRef, unref as keepaliveUnref } from '../internal/event-loop-keepalive.ts';
import { type CjsExtensionHook, type CjsExtensions, type CjsRequire, executeCjs } from './cjs.ts';
import { ModuleLoadError } from './errors.ts';
import { type TransformResult, transformEsm } from './esm-ast.ts';
import { type TransformSourceHook, executeEsm } from './esm.ts';
import { cjsNamespaceFor } from './interop.ts';
import { type CjsModule, type ModuleRecord, ModuleRegistry } from './registry.ts';
import type { PathAliases, ResolvedModule } from './resolver.ts';
import { type Resolver, createResolver } from './resolver.ts';
import { SourceMapRegistry, extractInlineSourceMap } from './source-maps.ts';

export type { TransformSourceHook } from './esm.ts';
export type { PathAliases } from './resolver.ts';

export interface ModuleLoaderOptions {
  /** Working directory used when the caller passes a relative `entry` to `import`/`require`. */
  readonly cwd?: string;
  /**
   * Caller-defined transform root, passed as `workspace` to every
   * {@link TransformSourceHook} call. Defaults to {@link ModuleLoaderOptions.cwd}
   * (or the internal entry stub). A single root suffices: per-file transforms
   * do not resolve imports — rifty's resolver does (ADR-0052 D5).
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
   * The coherent invalidation seam. Drops the module record, CJS import job,
   * id-keyed transform/AST caches, and resolver caches in lockstep, so a reload
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
   * execution record, leaving import-job/transform/AST/resolver caches stale.
   * Use {@link ModuleLoader.invalidate} instead. Exposed for read access (e.g.
   * tests inspecting cached records).
   */
  readonly registry: ModuleRegistry;
  readonly resolver: Resolver;
}

const STUB_FROM_FILE_DEFAULT = '/__entry__';

setSameRealmWorkerModuleImporter(async (vfs, script, cwd) => {
  const loader = createModuleLoader(vfs, { cwd });
  return loader.import(script, script);
});

type CjsImportJob =
  | {
      readonly kind: 'module';
      readonly promise: Promise<Record<string, unknown>>;
    }
  | {
      readonly kind: 'builtin';
      readonly outer: Record<string, unknown>;
      readonly promise: Promise<Record<string, unknown>>;
    };

/**
 * Load a `node:`-prefixed builtin or throw `MODULE_NOT_FOUND`. Shared by sync
 * and async paths; deliberately returns raw CJS-shaped exports — the async path
 * materialises the record-owned namespace at the call site.
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
  const cjsExtensions = Object.create(null) as CjsExtensions;
  const defaultJsExtension: CjsExtensionHook = (module, filename) => {
    module._compile(readResolvedById(filename).source, filename);
  };
  cjsExtensions['.js'] = defaultJsExtension;
  cjsExtensions['.json'] = (module, filename) => {
    module.exports = JSON.parse(readResolvedById(filename).source) as Record<string, unknown>;
  };
  cjsExtensions['.node'] = (_module, filename) => {
    throw new NotImplementedError(
      'module-loader.native-addon',
      `cannot load native addon ${filename} in the browser runtime`,
    );
  };
  const cwd = opts.cwd ?? STUB_FROM_FILE_DEFAULT;
  const workspace = opts.workspace ?? opts.cwd ?? STUB_FROM_FILE_DEFAULT;
  // Node keeps CJS execution records (`require.cache`) and ESM ModuleJobs as
  // separate state. This job cache owns import concurrency + cached rejection;
  // the final namespace itself stays on the execution record. Exactly one job
  // exists per id until coherent invalidation.
  const cjsImportJobs = new Map<string, CjsImportJob>();

  // Strip cache: real transform providers can be expensive, so re-stripping
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

  function executeCjsImport(resolved: ResolvedModule): Record<string, unknown> {
    executeCjs(resolved, { ...deps });
    const record = registry.get(resolved.id);
    if (!record || record.state !== 'loaded' || record.kind === 'esm') {
      throw new Error(`CJS import did not produce a loaded record: ${resolved.id}`);
    }
    return cjsNamespaceFor(record);
  }

  function importCjs(resolved: ResolvedModule): Promise<Record<string, unknown>> {
    const cachedJob = cjsImportJobs.get(resolved.id);
    if (cachedJob) return cachedJob.promise;

    const captured = registry.get(resolved.id);
    let resolveJob!: (namespace: Record<string, unknown>) => void;
    let rejectJob!: (error: unknown) => void;
    const promise = new Promise<Record<string, unknown>>((resolve, reject) => {
      resolveJob = resolve;
      rejectJob = reject;
    });
    cjsImportJobs.set(resolved.id, { kind: 'module', promise });

    const settle = (): void => {
      try {
        resolveJob(executeCjsImport(resolved));
      } catch (error) {
        rejectJob(error);
      }
    };

    if (captured?.state === 'loading' && captured.kind !== 'esm') {
      // require() is synchronous. One checkpoint lets that exact generation
      // finish; no polling/spin. Success publishes that record; failure never
      // re-executes or crosses into a later generation.
      void Promise.resolve().then(() => {
        try {
          if (captured.state === 'loaded') {
            resolveJob(cjsNamespaceFor(captured));
            return;
          }
          if (captured.state === 'errored') {
            const currentJob = cjsImportJobs.get(resolved.id);
            if (currentJob?.promise !== promise) {
              rejectJob(
                captured.error ??
                  new Error(`Invalidated CJS generation failed without an error: ${resolved.id}`),
              );
              return;
            }
            // TODO(backlog: runtime-js/require-cache-module-record-surface):
            // Node 24's file translator rejects a self-import from a failed
            // require with an internal assertion. Never retry the source or
            // attach this job to a later require generation.
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

    settle();
    return promise;
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
    const outer = loadBuiltinOrThrow(id);
    const cached = cjsImportJobs.get(id);
    if (cached?.kind === 'builtin' && cached.outer === outer) return cached.promise;

    const promise = Promise.resolve(cjsNamespaceFor(builtinRecord(id, outer)));
    cjsImportJobs.set(id, { kind: 'builtin', outer, promise });
    return promise;
  }

  const deps = {
    registry,
    resolver,
    extensions: cjsExtensions,
    defaultJsExtension,
    makeRequire,
    workspace,
    sourceMaps,
    transformSource: cachedTransform,
    transformEsm: cachedTransformEsm,
    resolve(specifier: string, fromFile: string, esm: boolean): ResolvedModule {
      return resolver.resolve(specifier, { fromFile, esm });
    },
    loadSync(resolved: ResolvedModule, parent?: CjsModule): Record<string, unknown> {
      if (resolved.kind === 'builtin') {
        return loadBuiltinOrThrow(resolved.id);
      }
      if (resolved.kind === 'esm') {
        throw new ModuleLoadError(
          'UNSUPPORTED_PROTOCOL',
          resolved.id,
          'Synchronous require() of ESM is not supported.',
        );
      }
      return executeCjs(
        resolved,
        {
          ...deps,
        },
        parent,
      );
    },
    async loadAsync(id: string): Promise<Record<string, unknown>> {
      if (id.startsWith('node:')) {
        return importBuiltin(id);
      }
      const job = cjsImportJobs.get(id);
      if (job) return job.promise;
      const cached = registry.get(id);
      if (cached?.kind === 'esm' && (cached.state === 'loaded' || cached.state === 'loading')) {
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
        return importBuiltin(resolved.id);
      }
      if (resolved.kind === 'esm') {
        const cached = registry.get(resolved.id);
        if (cached && (cached.state === 'loaded' || cached.state === 'loading')) {
          return cached.exports;
        }
        return executeEsm(resolved, { ...deps });
      }
      return importCjs(resolved);
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

  function makeRequire(from: string, parent?: CjsModule): CjsRequire {
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
      return deps.loadSync(resolved, parent);
    }) as CjsRequire;
    req.resolve = (specifier: string): string =>
      resolver.resolve(specifier, { fromFile: from, esm: false }).id;
    // TODO(backlog: runtime-js/require-cache-module-record-surface): this is
    // intentionally not claimed as Node-compatible until backed by registry.
    req.cache = Object.create(null) as Record<string, unknown>;
    req.extensions = cjsExtensions;
    req.main = undefined;
    return req;
  }

  __setCreateRequireImpl(makeRequire);

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
      return deps.loadSync(resolved);
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
      // Keep derived caches + future import-job lookup coherent with records.
      // Already-returned job promises retain their captured generation.
      if (id === undefined) {
        transformCache.clear();
        esmAstCache.clear();
        sourceMaps.clear();
        cjsImportJobs.clear();
      } else {
        transformCache.delete(id);
        esmAstCache.delete(id);
        sourceMaps.delete(id);
        cjsImportJobs.delete(id);
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
