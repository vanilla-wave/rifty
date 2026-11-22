import type { ModuleLoader } from './loader.ts';
import type { CjsModule } from './registry.ts';

type NodeMainImport = (
  specifier: string,
  from: string,
  onMain: (module: CjsModule) => void,
) => Promise<Record<string, unknown>>;
export const nodeMainImports = new WeakMap<ModuleLoader, NodeMainImport>();

/**
 * Node `executeUserEntryPoint`: import `specifier` as the process's main. A
 * CommonJS entry becomes Node's main module (`require.main`, `id` '.', parent
 * null; `onMain` publishes `process.mainModule` before it runs).
 */
export function importNodeMain(
  loader: ModuleLoader,
  specifier: string,
  from: string,
  onMain: (module: CjsModule) => void,
): Promise<Record<string, unknown>> {
  const run = nodeMainImports.get(loader);
  if (run === undefined) throw new TypeError('importNodeMain needs a createModuleLoader loader');
  return run(specifier, from, onMain);
}
