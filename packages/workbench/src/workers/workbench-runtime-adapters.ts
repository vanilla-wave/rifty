import { NotImplementedError } from '@riftydev/io';
import { type RuntimeEsbuildCjsOuter, publishRuntimeEsbuild } from '@riftydev/runtime-js';
import { type FsSync, isAbsolute, normalizePath } from '@riftydev/vfs';
import { sha256Hex } from '../glue/install-stamp.ts';
// @ts-expect-error hash-pinned generated JS has no hand-maintained declaration.
import * as generatedRuntime from './generated/esbuild-runtime.js';

export const ESBUILD_RUNTIME_ADAPTER_ID = 'rifty.runtime-adapter.esbuild.v1';
const ESBUILD_RUNTIME_PACKAGE_SUFFIX = '/node_modules/esbuild-wasm';
const ESBUILD_WASM_BYTES = 13_918_738;
const ESBUILD_WASM_SHA256 = '9d99d51a13469befdcfca172855f62724b87bdfc0c87a6a0729ddbb455d0fa3b';

export interface WorkbenchRuntimeBinding {
  readonly adapterId: string;
  readonly packagePath: string;
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

function isOnCwdAncestry(root: string, cwd: string): boolean {
  return root === '/' || root === cwd || cwd.startsWith(`${root}/`);
}

function isNestedPackageRootOnCwdAncestry(packageRoot: string, cwd: string): boolean {
  const marker = '/node_modules/';
  const markerIndex = packageRoot.indexOf(marker);
  if (markerIndex < 0) return false;
  const treeRoot = markerIndex === 0 ? '/' : packageRoot.slice(0, markerIndex);
  if (!isOnCwdAncestry(treeRoot, cwd)) return false;
  const parts = packageRoot.slice(markerIndex + 1).split('/');
  let index = 0;
  while (index < parts.length) {
    if (parts[index] !== 'node_modules') return false;
    const scopeOrName = parts[index + 1];
    if (!scopeOrName || scopeOrName === 'node_modules') return false;
    index += scopeOrName.startsWith('@') ? 3 : 2;
    if (scopeOrName.startsWith('@')) {
      const name = parts[index - 1];
      if (!name || name === 'node_modules') return false;
    }
  }
  return index === parts.length;
}

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
  fs: FsSync,
  cwd: string,
): Promise<void> {
  const packagePath = binding.packagePath;
  const normalizedCwd = normalizePath(cwd);
  const packageRoot = packagePath.endsWith(ESBUILD_RUNTIME_PACKAGE_SUFFIX)
    ? packagePath.slice(0, -ESBUILD_RUNTIME_PACKAGE_SUFFIX.length) || '/'
    : '';
  const onCwdAncestry = isOnCwdAncestry(packageRoot, normalizedCwd);
  const inCwdPackageTree = isNestedPackageRootOnCwdAncestry(packageRoot, normalizedCwd);
  if (
    !isAbsolute(packagePath) ||
    normalizePath(packagePath) !== packagePath ||
    (!onCwdAncestry && !inCwdPackageTree) ||
    !packagePath.endsWith(ESBUILD_RUNTIME_PACKAGE_SUFFIX)
  ) {
    throw new TypeError(`runtime-adapter.esbuild packagePath is not admitted: ${packagePath}`);
  }
  const wasmPath = `${packagePath}/esbuild.wasm`;
  const bytes = fs.readFileBytesSync(wasmPath);
  if (bytes.byteLength !== ESBUILD_WASM_BYTES) {
    throw new TypeError(
      `runtime-adapter.esbuild wasm size is ${String(bytes.byteLength)}, expected ${String(ESBUILD_WASM_BYTES)}`,
    );
  }
  const digest = sha256Hex(bytes);
  if (digest !== ESBUILD_WASM_SHA256) {
    throw new TypeError(
      `runtime-adapter.esbuild wasm sha256 is ${digest}, expected ${ESBUILD_WASM_SHA256}`,
    );
  }
  const outer = await startGeneratedEsbuildRuntime({ bytes, fs, cwd });
  publishRuntimeEsbuild(outer);
}

export async function activateWorkbenchRuntimeAdapters(options: {
  readonly bindings: readonly WorkbenchRuntimeBinding[];
  readonly fs: FsSync;
  readonly cwd: string;
}): Promise<void> {
  const activated = new Set<string>();
  for (const binding of options.bindings) {
    if (activated.has(binding.adapterId)) {
      throw new TypeError(`duplicate admitted runtime adapter: ${binding.adapterId}`);
    }
    activated.add(binding.adapterId);
    if (binding.adapterId !== ESBUILD_RUNTIME_ADAPTER_ID) {
      throw new NotImplementedError(`runtime-adapter.${binding.adapterId}`);
    }
  }
  for (const binding of options.bindings) {
    await activateEsbuild(binding, options.fs, options.cwd);
  }
}
