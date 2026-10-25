import { DEFAULT_VITE8_VERSION } from './project-defaults.ts';
const RUNTIME_NAME = '@napi-rs/wasm-runtime';
const RUNTIME_OVERRIDE = 'npm:@napi-rs/wasm-runtime@1.1.6';
export function preparePackageManifest(manifest: Record<string, unknown>, version: string): void {
  if (version !== DEFAULT_VITE8_VERSION) return;
  const supplied = manifest.overrides;
  if (
    supplied !== undefined &&
    (typeof supplied !== 'object' || supplied === null || Array.isArray(supplied))
  ) {
    throw new TypeError('package.json overrides must be an object');
  }
  const overrides = { ...(supplied as Record<string, unknown> | undefined) };
  if (!Object.prototype.hasOwnProperty.call(overrides, RUNTIME_NAME)) {
    Object.defineProperty(overrides, RUNTIME_NAME, {
      value: RUNTIME_OVERRIDE,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }
  manifest.overrides = overrides;
}
