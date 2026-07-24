import { NotImplementedError } from '@riftydev/io';
import { type RuntimeEsbuildCjsOuter, publishRuntimeEsbuild } from '@riftydev/runtime-js';
import type { FsSync } from '@riftydev/vfs';
// @ts-expect-error hash-pinned generated JS has no hand-maintained declaration.
import * as generatedRuntime from './generated/esbuild-runtime.js';

export const ESBUILD_RUNTIME_ADAPTER_ID = 'rifty.runtime-adapter.esbuild.v1';
const ESBUILD_RUNTIME_ASSET_ID = 'esbuild-wasm@0.28.0/package/esbuild.wasm';

export interface WorkbenchRuntimeBinding {
  readonly adapterId: string;
  readonly assets: readonly string[];
}

export interface WorkbenchRuntimeAssetClient {
  readonly ready: Promise<{
    readonly bindings: readonly WorkbenchRuntimeBinding[];
  }>;
  read(assetId: string): Promise<Uint8Array>;
  dispose(): void;
}

interface EsbuildRuntimeOptions {
  readonly bytes: Uint8Array;
  readonly fs: FsSync;
  readonly cwd: string;
}

interface GeneratedRuntimeModule {
  startEsbuildRuntime(options: {
    readonly wasm: WebAssembly.Module;
    readonly fs: FsSync;
    readonly cwd: string;
  }): Promise<RuntimeEsbuildCjsOuter>;
}

const generated = generatedRuntime as unknown as GeneratedRuntimeModule;

async function startGeneratedEsbuildRuntime(
  options: EsbuildRuntimeOptions,
): Promise<RuntimeEsbuildCjsOuter> {
  const ownedBytes = new Uint8Array(options.bytes.byteLength);
  ownedBytes.set(options.bytes);
  const wasm = await WebAssembly.compile(ownedBytes);
  return generated.startEsbuildRuntime({ wasm, fs: options.fs, cwd: options.cwd });
}

async function activateEsbuild(
  binding: WorkbenchRuntimeBinding,
  client: WorkbenchRuntimeAssetClient,
  fs: FsSync,
  cwd: string,
): Promise<void> {
  if (binding.assets.length !== 1 || binding.assets[0] !== ESBUILD_RUNTIME_ASSET_ID) {
    throw new NotImplementedError('runtime-adapter.esbuild.assets');
  }
  const bytes = await client.read(ESBUILD_RUNTIME_ASSET_ID);
  const outer = await startGeneratedEsbuildRuntime({ bytes, fs, cwd });
  publishRuntimeEsbuild(outer);
}

export async function activateWorkbenchRuntimeAdapters(options: {
  readonly assets: WorkbenchRuntimeAssetClient;
  readonly fs: FsSync;
  readonly cwd: string;
}): Promise<void> {
  let activationFailure: unknown;
  try {
    const descriptor = await options.assets.ready;
    const activated = new Set<string>();
    for (const binding of descriptor.bindings) {
      if (activated.has(binding.adapterId)) {
        throw new TypeError(`duplicate admitted runtime adapter: ${binding.adapterId}`);
      }
      activated.add(binding.adapterId);
      if (binding.adapterId === ESBUILD_RUNTIME_ADAPTER_ID) {
        await activateEsbuild(binding, options.assets, options.fs, options.cwd);
        continue;
      }
      throw new NotImplementedError(`runtime-adapter.${binding.adapterId}`);
    }
  } catch (error) {
    activationFailure = error;
  }

  let disposalFailure: unknown;
  try {
    options.assets.dispose();
  } catch (error) {
    disposalFailure = error;
  }
  if (activationFailure !== undefined && disposalFailure !== undefined) {
    throw new AggregateError(
      [activationFailure, disposalFailure],
      'runtime adapter activation and asset client disposal failed',
    );
  }
  if (activationFailure !== undefined) throw activationFailure;
  if (disposalFailure !== undefined) throw disposalFailure;
}
