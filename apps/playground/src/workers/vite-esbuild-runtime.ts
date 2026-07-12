import { type RuntimeEsbuildCjsOuter, publishRuntimeEsbuild } from '@riftydev/runtime-js';
import type { FsSync } from '@riftydev/vfs';
import esbuildWasmUrl from 'esbuild-wasm/esbuild.wasm?url';
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
let wasmModulePromise: Promise<WebAssembly.Module> | undefined;

function compileEsbuildWasm(): Promise<WebAssembly.Module> {
  wasmModulePromise ??= fetch(esbuildWasmUrl).then(async (response) => {
    if (!response.ok) {
      throw new Error(`esbuild-wasm fetch failed: HTTP ${response.status}`);
    }
    return WebAssembly.compile(await response.arrayBuffer());
  });
  return wasmModulePromise;
}

/** Start once in this Worker; publish only the exact successful CJS outer. */
export async function startAndPublishViteEsbuild(options: {
  readonly fs: FsSync;
  readonly cwd: string;
}): Promise<void> {
  const wasm = await compileEsbuildWasm();
  const outer = await generated.startEsbuildRuntime({ wasm, fs: options.fs, cwd: options.cwd });
  publishRuntimeEsbuild(outer);
}
