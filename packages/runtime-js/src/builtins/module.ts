/**
 * Node-compatible `node:module` (subset).
 *
 * `createRequire` is what most tooling actually needs: it gives back a
 * require() function bound to a base URL/path. The runtime-js loader hands
 * out the require closure via the typed owner table
 * ({@link publishRuntimeGlobal} / {@link readRuntimeGlobal} under the
 * `__rifty` root); this module reads from that.
 *
 * `builtinModules` reflects whatever has been registered with the loader at
 * the time of the call (so net's `node:http` shows up once @riftydev/net has
 * registered itself).
 */
import { NotImplementedError, isBuiltinSpecifier, listBuiltins } from '@riftydev/io';
import { createRequirePath } from '../internal/create-require-path.ts';
import { publishRuntimeGlobal, readRuntimeGlobal } from '../internal/worker-globals.ts';

interface RequireFn {
  (id: string): unknown;
  resolve?(id: string): string;
  cache?: Record<string, unknown>;
}

/**
 * Wired up by the worker bootstrap (and the playground's `realVite.ts`
 * adapter) so this module can delegate. The implementation lives under
 * `__rifty.createRequireImpl` in the owner table — see
 * `internal/worker-globals.ts` for the owner-table rationale (Tier 2 #10
 * of the 2026-05-26 architecture review).
 */
export function __setCreateRequireImpl(impl: (from: string) => RequireFn): void {
  publishRuntimeGlobal('createRequireImpl', impl);
}

export function createRequire(from: string | URL): RequireFn {
  const impl = readRuntimeGlobal('createRequireImpl');
  if (!impl) {
    throw new NotImplementedError(
      'module.createRequire',
      'no loader registered — runtime-js worker bootstrap missing',
    );
  }
  const fromPath = createRequirePath(from);
  return impl(fromPath) as RequireFn;
}

export function builtinModules(): string[] {
  return listBuiltins();
}

export const constants = {
  compileCacheStatus: {
    FAILED: 0,
    ENABLED: 1,
    ALREADY_ENABLED: 2,
    DISABLED: 3,
  },
} as const;

export interface EnableCompileCacheResult {
  status: number;
  message?: string;
  directory?: string;
}

export function enableCompileCache(_cacheDir?: string): EnableCompileCacheResult {
  return {
    status: constants.compileCacheStatus.FAILED,
    message:
      'module compile cache is unavailable in rifty: browser V8 does not expose Node module code-cache persistence',
  };
}

export function flushCompileCache(): void {
  // Node makes compile-cache flush failures quiet; rifty has no enabled cache.
}

export function getCompileCacheDir(): string | undefined {
  return undefined;
}

export function isBuiltin(specifier: string): boolean {
  const name = specifier.startsWith('node:') ? specifier.slice(5) : specifier;
  return isBuiltinSpecifier(name);
}

// Some tools read `Module.builtinModules` as a property; provide a frozen view.
const moduleClass: {
  builtinModules: string[];
  createRequire: typeof createRequire;
  constants: typeof constants;
  enableCompileCache: typeof enableCompileCache;
  flushCompileCache: typeof flushCompileCache;
  getCompileCacheDir: typeof getCompileCacheDir;
  isBuiltin: typeof isBuiltin;
} = {
  get builtinModules() {
    return listBuiltins();
  },
  createRequire,
  constants,
  enableCompileCache,
  flushCompileCache,
  getCompileCacheDir,
  isBuiltin,
};

const moduleModule = {
  createRequire,
  constants,
  enableCompileCache,
  flushCompileCache,
  getCompileCacheDir,
  isBuiltin,
  builtinModules: new Proxy([] as string[], {
    get(_target, prop) {
      const arr = listBuiltins();
      const value = (arr as unknown as Record<string | symbol, unknown>)[prop];
      return value;
    },
    has(_target, prop) {
      return prop in listBuiltins();
    },
  }),
  Module: moduleClass,
  default: moduleClass,
  // syncBuiltinESMExports is a Node hook used by deep-tooling. Best-effort no-op.
  syncBuiltinESMExports(): void {
    // no-op
  },
};

export default moduleModule;
