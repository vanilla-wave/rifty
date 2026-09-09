import type { FsSync } from '@riftydev/vfs';
/** Registry-owned exact CJS carrier shared by bundle copies in one realm. */
export type RuntimeEsbuildCjsOuter = object;
interface RuntimeEsbuildBinding {
  readonly fs: FsSync;
  readonly cwd: string;
}
interface RegistryRealm {
  esbuild?: RuntimeEsbuildCjsOuter;
  esbuildBinding?: RuntimeEsbuildBinding;
}
interface GlobalWithRegistry {
  __riftyShadowRegistry?: RegistryRealm;
}
export function publishRuntimeEsbuild(
  outer: RuntimeEsbuildCjsOuter,
  binding?: RuntimeEsbuildBinding,
): void {
  const global = globalThis as GlobalWithRegistry;
  if (global.__riftyShadowRegistry === undefined) {
    Object.defineProperty(globalThis, '__riftyShadowRegistry', {
      value: Object.create(null) as RegistryRealm,
      configurable: true,
      enumerable: false,
      writable: false,
    });
  }
  const realm = global.__riftyShadowRegistry;
  if (realm === undefined) throw new Error('registry realm publication failed');
  realm.esbuild = outer;
  realm.esbuildBinding = binding;
}
export function readRuntimeEsbuild(): RuntimeEsbuildCjsOuter | null {
  return (globalThis as GlobalWithRegistry).__riftyShadowRegistry?.esbuild ?? null;
}

/** Reinstall/open may reuse the already-bound service; no guest initialize semantics change. */
export function runtimeEsbuildBindingMatches(fs: FsSync, cwd: string): boolean {
  const realm = (globalThis as GlobalWithRegistry).__riftyShadowRegistry;
  return (
    realm?.esbuild !== undefined &&
    realm.esbuildBinding?.fs === fs &&
    realm.esbuildBinding.cwd === cwd
  );
}
