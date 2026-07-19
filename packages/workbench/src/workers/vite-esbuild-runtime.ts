import { NotImplementedError } from '@riftydev/io';
import type { ShadowAssetRuntimeReader } from '@riftydev/npm-client';
import { type RuntimeEsbuildCjsOuter, publishRuntimeEsbuild } from '@riftydev/runtime-js';
import type { FsSync } from '@riftydev/vfs';
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
let wasmModuleLoad: Promise<WebAssembly.Module> | undefined;
const EXACT_ESBUILD_VITE_VERSION = '7.3.6';
const ESBUILD_WASM_ASSET_ID = 'esbuild-wasm@0.28.0/package/esbuild.wasm';

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

function compileEsbuildWasm(shadowAssets: ShadowAssetRuntimeReader): Promise<WebAssembly.Module> {
  wasmModuleLoad ??= shadowAssets.readVerified(ESBUILD_WASM_ASSET_ID).then((bytes) => {
    if (!(bytes.buffer instanceof ArrayBuffer)) {
      throw new TypeError('verified esbuild wasm bytes must have an owned ArrayBuffer');
    }
    return WebAssembly.compile(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  });
  return wasmModuleLoad;
}

/** Start once in this Worker; publish only the exact successful CJS outer. */
async function startAndPublishViteEsbuild(options: {
  readonly fs: FsSync;
  readonly cwd: string;
  readonly shadowAssets: ShadowAssetRuntimeReader;
}): Promise<void> {
  const wasm = await compileEsbuildWasm(options.shadowAssets);
  const outer = await generated.startEsbuildRuntime({ wasm, fs: options.fs, cwd: options.cwd });
  publishRuntimeEsbuild(outer);
}

/** Gate the resolved Vite package, then publish its exact runtime before import. */
export async function prepareViteEsbuildRuntime(options: {
  readonly fs: FsSync;
  readonly cwd: string;
  readonly decision: ViteEsbuildRuntimeDecision;
  readonly shadowAssets?: ShadowAssetRuntimeReader;
}): Promise<void> {
  if (options.decision === 'skip-rolldown') return;
  if (options.shadowAssets === undefined) {
    throw new NotImplementedError('vite.esbuild.shadowAssets');
  }
  await startAndPublishViteEsbuild({
    fs: options.fs,
    cwd: options.cwd,
    shadowAssets: options.shadowAssets,
  });
}
