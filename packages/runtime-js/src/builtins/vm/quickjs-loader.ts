/**
 * QuickJS-WASM engine loader for the `vm.*` sandbox membrane.
 *
 * Two concerns:
 *  1. {@link getQuickjsWasmUrl} — env-config of the `.wasm` location (D-004 /
 *     ADR-0005): URL from bootstrap global / build env / Node env, never
 *     hardcoded elsewhere.
 *  2. The one-time async preload singleton ({@link ensureVmEngineReady}) so the
 *     rest of the membrane can run fully synchronously via
 *     {@link getQuickJsModuleSync} — mirrors the WASI worker-boot preload.
 *
 * Verified API contract: `packages/runtime-js/src/builtins/vm/QUICKJS_API.md`.
 */

import variant from '@jitl/quickjs-wasmfile-release-sync';
import {
  type QuickJSWASMModule,
  newQuickJSWASMModuleFromVariant,
  newVariant,
} from 'quickjs-emscripten-core';
import {
  publishRuntimeGlobal,
  readRuntimeGlobal,
  unpublishRuntimeGlobal,
} from '../../internal/worker-globals.ts';

/** Bootstrap-global key carrying the QuickJS `.wasm` URL (playground/host). */
export const QUICKJS_WASM_URL_ENV = '__RIFTY_QUICKJS_WASM_URL' as const;

/**
 * QuickJS `.wasm` URL, in priority order:
 *   1. `globalThis.__RIFTY_QUICKJS_WASM_URL` (host/playground bootstrap),
 *   2. `globalThis.import.meta.env.RIFTY_QUICKJS_WASM_URL` (Vite-style build env),
 *   3. `process.env.RIFTY_QUICKJS_WASM_URL` (Node-side test harness),
 *   4. `/quickjs.wasm` (default — host serves the vendored artifact here).
 *
 * Never hardcode a QuickJS wasm URL elsewhere (D-004 / ADR-0005). Mirrors
 * {@link @riftydev/npm-client!getRegistryBaseUrl} and the `WASI_WASM_URL_ENV`
 * precedent in runtime-wasi.
 *
 * In native Node the release-sync variant resolves its `.wasm` from
 * `node_modules`. Browser workers instead need the host/bundler-published URL:
 * Emscripten's relative guess points beside transformed JS chunks and can fetch
 * the host's HTML fallback. `ensureVmEngineReady()` therefore supplies the
 * configured URL and owner-fetched bytes to upstream.
 */
export function getQuickjsWasmUrl(): string {
  return getConfiguredQuickjsWasmUrl() ?? '/quickjs.wasm';
}

function getConfiguredQuickjsWasmUrl(): string | undefined {
  const g = globalThis as Record<string, unknown>;
  const fromBootstrap = g[QUICKJS_WASM_URL_ENV];
  if (typeof fromBootstrap === 'string' && fromBootstrap.length > 0) return fromBootstrap;

  // Vite-style: globalThis.import?.meta?.env?.RIFTY_QUICKJS_WASM_URL
  const importObj = g.import;
  if (importObj && typeof importObj === 'object') {
    const meta = (importObj as { meta?: unknown }).meta;
    if (meta && typeof meta === 'object') {
      const env = (meta as { env?: unknown }).env;
      if (env && typeof env === 'object') {
        const value = (env as Record<string, unknown>).RIFTY_QUICKJS_WASM_URL;
        if (typeof value === 'string' && value.length > 0) return value;
      }
    }
  }

  // Node-side (vitest, harness).
  if (typeof process !== 'undefined' && process.env) {
    const fromEnv = process.env.RIFTY_QUICKJS_WASM_URL;
    if (typeof fromEnv === 'string' && fromEnv.length > 0) return fromEnv;
  }

  return undefined;
}

function isNativeNodeRuntime(): boolean {
  const g = globalThis as {
    readonly window?: unknown;
    readonly WorkerGlobalScope?: unknown;
    readonly importScripts?: unknown;
  };
  if (
    typeof g.window !== 'undefined' ||
    typeof g.WorkerGlobalScope !== 'undefined' ||
    typeof g.importScripts === 'function'
  ) {
    return false;
  }
  if (typeof process === 'undefined') return false;
  const versions = (process as { versions?: Record<string, string | undefined> }).versions;
  return typeof versions?.node === 'string';
}

// Host artifact provenance is fixed before installNodeRuntime replaces `process`
// and parity Workers publish browser-compatible globals.
const nativeNodeArtifactResolution = isNativeNodeRuntime();

function quickjsVariantWithLocation(): typeof variant {
  const configured = getConfiguredQuickjsWasmUrl();
  if (nativeNodeArtifactResolution) {
    return configured === undefined ? variant : newVariant(variant, { wasmLocation: configured });
  }
  const wasmLocation = configured ?? getQuickjsWasmUrl();
  return newVariant(variant, {
    wasmLocation,
    wasmBinary: () => fetchQuickjsWasm(wasmLocation),
  });
}

async function fetchQuickjsWasm(wasmLocation: string): Promise<ArrayBuffer> {
  const response = await globalThis.fetch(wasmLocation);
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new Error(
      `runtime-js/quickjs-loader: fetch(${wasmLocation}) → ${response.status} ${response.statusText}`,
    );
  }
  return response.arrayBuffer();
}

/** True once {@link ensureVmEngineReady} has resolved — sync engine available. */
export function isVmEngineReady(): boolean {
  return readRuntimeGlobal('quickjsModuleSync') !== null;
}

/**
 * One-time async preload of the QuickJS WASM module. Idempotent: concurrent and
 * repeat calls share a single in-flight promise and resolve to the SAME
 * {@link QuickJSWASMModule} singleton. Join this to the worker boot promise so
 * every synchronous `vm.*` sandbox call afterwards can use
 * {@link getQuickJsModuleSync} without awaiting.
 */
export async function ensureVmEngineReady(): Promise<QuickJSWASMModule> {
  const existing = readRuntimeGlobal('quickjsModulePromise');
  if (existing !== null) return existing;
  const modulePromise = newQuickJSWASMModuleFromVariant(quickjsVariantWithLocation()).then((m) => {
    publishRuntimeGlobal('quickjsModuleSync', m);
    return m;
  });
  publishRuntimeGlobal('quickjsModulePromise', modulePromise);
  try {
    return await modulePromise;
  } catch (error) {
    if (readRuntimeGlobal('quickjsModulePromise') === modulePromise) {
      unpublishRuntimeGlobal('quickjsModulePromise');
    }
    throw error;
  }
}

/**
 * The preloaded {@link QuickJSWASMModule}, synchronously. Throws if
 * {@link ensureVmEngineReady} has not yet resolved — the membrane must preload
 * at boot, not lazily inside a sync sandbox call.
 */
export function getQuickJsModuleSync(): QuickJSWASMModule {
  const moduleSync = readRuntimeGlobal('quickjsModuleSync');
  if (moduleSync === null) {
    throw new Error(
      'QuickJS vm engine not preloaded. Call await ensureVmEngineReady() at boot ' +
        '(joined to the worker boot promise) before any synchronous vm.* sandbox call.',
    );
  }
  return moduleSync;
}
