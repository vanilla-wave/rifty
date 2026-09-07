/** Registry-owned exact CJS carrier shared by bundle copies in one realm. */
export type RuntimeEsbuildCjsOuter = object;
interface RegistryRealm {
  esbuild?: RuntimeEsbuildCjsOuter;
}
interface GlobalWithRegistry {
  __riftyShadowRegistry?: RegistryRealm;
}
export function publishRuntimeEsbuild(outer: RuntimeEsbuildCjsOuter): void {
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
}
export function readRuntimeEsbuild(): RuntimeEsbuildCjsOuter | null {
  return (globalThis as GlobalWithRegistry).__riftyShadowRegistry?.esbuild ?? null;
}
