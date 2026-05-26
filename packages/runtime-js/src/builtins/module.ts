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
 * the time of the call (so net's `node:http` shows up once @rifty/net has
 * registered itself).
 */
import { NotImplementedError, listBuiltins } from '@rifty/io';
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
  const fromPath = typeof from === 'string' ? from : urlToPath(from);
  return impl(fromPath) as RequireFn;
}

function urlToPath(url: URL): string {
  if (url.protocol === 'file:') return decodeURIComponent(url.pathname);
  return url.href;
}

export function builtinModules(): string[] {
  return listBuiltins();
}

// Some tools read `Module.builtinModules` as a property; provide a frozen view.
const moduleClass: { builtinModules: string[]; createRequire: typeof createRequire } = {
  get builtinModules() {
    return listBuiltins();
  },
  createRequire,
};

const moduleModule = {
  createRequire,
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
