/**
 * Public surface of the module loader.
 *
 * One factory: `createModuleLoader(vfs, opts)`. The returned object exposes
 * synchronous CJS `require()` and asynchronous ESM `import()`. CJS and ESM
 * share the same resolver and module registry — see D-003.
 */
export { createModuleLoader } from './loader.ts';
export type { ModuleLoader, ModuleLoaderOptions } from './loader.ts';
export type { ResolvedModule, ModuleKind } from './resolver.ts';
export { ModuleLoadError } from './errors.ts';
export { MemorySyncVfs } from './memory-sync-vfs.ts';
export type { SyncVfs } from './vfs-sync.ts';
