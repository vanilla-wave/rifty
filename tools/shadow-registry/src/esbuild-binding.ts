/**
 * Node-side convenience wrapper for the browser-safe esbuild transform adapter.
 * Runtime browser workers import `esbuild-transform` and provide wasm bytes
 * through a bundled asset URL; tests/tools can read the vendored wasm here.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export {
  type EsbuildLoader,
  type EsbuildTransformOptions,
  type EsbuildTransformResult,
  type RunWasi,
  transformWithEsbuild,
} from './esbuild-transform.ts';

export const ESBUILD_WASM_VENDOR_PATH: string = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'vendor',
  'esbuild-wasi-preview1',
  'esbuild.wasm',
);

export function loadVendoredEsbuildWasm(): Uint8Array {
  try {
    return readFileSync(ESBUILD_WASM_VENDOR_PATH);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `esbuild WASI binary not vendored at ${ESBUILD_WASM_VENDOR_PATH}. Run: node tools/shadow-registry/scripts/fetch-esbuild-wasi.mjs (underlying: ${detail})`,
    );
  }
}
