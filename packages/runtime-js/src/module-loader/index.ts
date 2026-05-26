/**
 * Public surface of the module loader.
 *
 * One factory: `createModuleLoader(vfs, opts)`. The returned object exposes
 * synchronous CJS `require()` and asynchronous ESM `import()`. CJS and ESM
 * share the same resolver and module registry — see D-003. The `vfs`
 * argument is `@rifty/vfs:FsSync` (ADR-0037) — the loader and `node:fs`
 * share one backing tree per Worker realm.
 */
export { createModuleLoader } from './loader.ts';
export type { ModuleLoader, ModuleLoaderOptions } from './loader.ts';
export type { ResolvedModule, ModuleKind } from './resolver.ts';
export { ModuleLoadError } from './errors.ts';
