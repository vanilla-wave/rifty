import { type RuntimeEsbuildCjsOuter, publishRuntimeEsbuild } from '@riftydev/runtime-js';
import type { FsSync } from '@riftydev/vfs';
import { fetchAssetBytesBounded } from '../glue/bounded-asset-fetch.ts';
// @ts-expect-error — hash-pinned generated JS has no hand-maintained declaration; narrowed below.
import * as generatedRuntime from './generated/esbuild-runtime.js';

interface GeneratedRuntimeModule {
  startEsbuildRuntime(options: {
    readonly wasm: WebAssembly.Module;
    readonly fs: FsSync;
    readonly cwd: string;
  }): Promise<RuntimeEsbuildCjsOuter>;
}

const generated = generatedRuntime as unknown as GeneratedRuntimeModule;
let wasmModuleLoad:
  | { readonly url: string; readonly promise: Promise<WebAssembly.Module> }
  | undefined;
const EXACT_ESBUILD_VITE_VERSION = '7.3.6';
// Pinned 0.28.0 asset is ~13.3 MiB; growth beyond 16 MiB needs provenance review.
const ESBUILD_WASM_MAX_BYTES = 16 * 1024 * 1024;

export type ViteEsbuildRuntimeDecision = 'start' | 'skip-rolldown';

/** One version gate for every Vite entry path that may consume esbuild. */
export function decideViteEsbuildRuntime(options: {
  readonly fs: FsSync;
  readonly packageRoot: string;
}): ViteEsbuildRuntimeDecision {
  const manifestPath = `${options.packageRoot}/package.json`;
  if (!options.fs.existsSync(manifestPath)) {
    throw new Error(`vite esbuild runtime cannot read executed package: ${manifestPath}`);
  }
  let manifest: { readonly name?: unknown; readonly version?: unknown };
  try {
    manifest = JSON.parse(new TextDecoder().decode(options.fs.readFileBytesSync(manifestPath))) as {
      readonly name?: unknown;
      readonly version?: unknown;
    };
  } catch (error) {
    throw new Error(`vite esbuild runtime found invalid package.json: ${manifestPath}`, {
      cause: error,
    });
  }
  if (manifest.name !== 'vite' || typeof manifest.version !== 'string') {
    throw new Error(`vite esbuild runtime found invalid package metadata: ${manifestPath}`);
  }
  if (manifest.version === EXACT_ESBUILD_VITE_VERSION) return 'start';
  if (/^8\./.test(manifest.version)) return 'skip-rolldown';
  throw new Error(
    `vite esbuild runtime supports exact Vite ${EXACT_ESBUILD_VITE_VERSION}; executed ${manifest.version}`,
  );
}

function compileEsbuildWasm(esbuildWasmUrl: string): Promise<WebAssembly.Module> {
  if (wasmModuleLoad !== undefined && wasmModuleLoad.url !== esbuildWasmUrl) {
    throw new Error(
      `vite esbuild runtime cannot replace inherited wasm URL ${wasmModuleLoad.url} with ${esbuildWasmUrl}`,
    );
  }
  wasmModuleLoad ??= {
    url: esbuildWasmUrl,
    promise: fetchAssetBytesBounded(esbuildWasmUrl, {
      label: 'esbuild-wasm asset',
      maxBytes: ESBUILD_WASM_MAX_BYTES,
    }).then((bytes) => WebAssembly.compile(bytes)),
  };
  return wasmModuleLoad.promise;
}

/** Start once in this Worker; publish only the exact successful CJS outer. */
async function startAndPublishViteEsbuild(options: {
  readonly fs: FsSync;
  readonly cwd: string;
  readonly esbuildWasmUrl: string;
}): Promise<void> {
  const wasm = await compileEsbuildWasm(options.esbuildWasmUrl);
  const outer = await generated.startEsbuildRuntime({ wasm, fs: options.fs, cwd: options.cwd });
  publishRuntimeEsbuild(outer);
}

/** Gate the resolved Vite package, then publish its exact runtime before import. */
export async function prepareViteEsbuildRuntime(options: {
  readonly fs: FsSync;
  readonly cwd: string;
  readonly packageRoot: string;
  readonly esbuildWasmUrl: string;
}): Promise<void> {
  if (decideViteEsbuildRuntime(options) === 'skip-rolldown') return;
  await startAndPublishViteEsbuild(options);
}
