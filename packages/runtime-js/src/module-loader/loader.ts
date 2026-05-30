import type { FsSync } from '@rifty/vfs';
import { loadBuiltin } from '../builtins/index.ts';
import { executeCjs } from './cjs.ts';
import { ModuleLoadError } from './errors.ts';
import { type TransformSourceHook, executeEsm } from './esm.ts';
import { wrapCjsAsEsmNamespace } from './interop.ts';
import { ModuleRegistry } from './registry.ts';
import type { ResolvedModule } from './resolver.ts';
import { type Resolver, createResolver } from './resolver.ts';

export type { TransformSourceHook } from './esm.ts';

export interface ModuleLoaderOptions {
  /** Working directory used when the caller passes a relative `entry` to `import`/`require`. */
  readonly cwd?: string;
  /**
   * esbuild guest cwd/preopen used as the `workspace` of every
   * {@link TransformSourceHook} call. Defaults to {@link ModuleLoaderOptions.cwd}
   * (or the loader's internal entry stub when neither is set). A single root is
   * sufficient because a type-strip transform does not resolve relative imports
   * through esbuild — rifty's resolver does that (ADR-0052 D5).
   */
  readonly workspace?: string;
  /**
   * Injected per-file source transform for `.ts`/`.tsx`/`.jsx` modules
   * (see {@link TransformSourceHook}). When absent, `.ts`/`.tsx`/`.jsx` still
   * resolve (ADR-0053) but their TS syntax reaches the AST rewriter unstripped;
   * the directed transform-not-configured throw is owned by feature-02 T3.
   */
  readonly transformSource?: TransformSourceHook;
}

export interface ModuleLoader {
  /** Synchronous CJS require — only works for CJS/JSON modules. */
  require(specifier: string, from?: string): unknown;
  /** Asynchronous import — works for both CJS and ESM. */
  import(specifier: string, from?: string): Promise<Record<string, unknown>>;
  /** Direct id-based loader (used by REPL and tests). */
  loadById(id: string, esm?: boolean): Promise<Record<string, unknown>>;
  /**
   * Drop module records. With no `id` wipes the whole cache (the `load-fixture`
   * hot path uses this so the loader instance and its resolver stay alive
   * across editor saves). With an absolute `id` removes only that entry —
   * future hook for HMR / per-file editor updates. Thin delegate to
   * {@link ModuleRegistry.invalidate}; see the longer note there for the
   * single-entry-vs-dependency-graph contract.
   */
  invalidate(id?: string): void;
  readonly registry: ModuleRegistry;
  readonly resolver: Resolver;
}

const STUB_FROM_FILE_DEFAULT = '/__entry__';

/**
 * Load a `node:`-prefixed builtin or throw `MODULE_NOT_FOUND`. Shared by the
 * sync and async loader paths; the async path wraps the result via
 * {@link wrapCjsAsEsmNamespace} at the call site, so this helper deliberately
 * returns the raw CJS-shaped exports.
 */
function loadBuiltinOrThrow(id: string): Record<string, unknown> {
  const builtin = loadBuiltin(id);
  if (!builtin) throw new ModuleLoadError('MODULE_NOT_FOUND', id, `Built-in '${id}' not found`);
  return builtin;
}

export function createModuleLoader(vfs: FsSync, opts: ModuleLoaderOptions = {}): ModuleLoader {
  const registry = new ModuleRegistry();
  const resolver = createResolver(vfs);
  const cwd = opts.cwd ?? STUB_FROM_FILE_DEFAULT;
  const workspace = opts.workspace ?? opts.cwd ?? STUB_FROM_FILE_DEFAULT;

  const deps = {
    registry,
    resolver,
    workspace,
    transformSource: opts.transformSource,
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
      const resolved = readResolvedById(id);
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
    // We re-use the resolver by passing the id back through `resolve`, with the
    // file itself as both specifier and fromFile (so absolute path matches).
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
      return deps.loadAsync(resolved.id);
    },
    loadById(id, esm = false) {
      const resolved = resolver.resolve(id, { fromFile: id, esm });
      return deps.loadAsync(resolved.id);
    },
    invalidate(id) {
      registry.invalidate(id);
    },
    registry,
    resolver,
  };
}
