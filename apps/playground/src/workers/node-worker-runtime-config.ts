import { setKernelWorkerUrl } from '@riftydev/kernel';
import { configureNodeEntryWorker } from '@riftydev/runtime-js/builtins/node-entry-url';

export interface NodeWorkerRuntimeConfig {
  readonly kernelWorkerUrl: string;
  readonly nodeEntryWorkerUrl: string;
  readonly sqliteWasmUrl: string;
  readonly esbuildWasmUrl: string;
}

function required(
  env: Readonly<Record<string, string | undefined>>,
  key: string,
  owner: string,
): string {
  const value = env[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${owner}: missing required node worker runtime env ${key}`);
  }
  return value;
}

/** One serializer for every node-capable child realm. */
export function buildNodeWorkerRuntimeEnv(
  config: NodeWorkerRuntimeConfig,
): Readonly<Record<string, string>> {
  const env = {
    RIFTY_KERNEL_WORKER_URL: config.kernelWorkerUrl,
    RIFTY_NODE_ENTRY_WORKER_URL: config.nodeEntryWorkerUrl,
    RIFTY_SQLITE_WASM_URL: config.sqliteWasmUrl,
    RIFTY_ESBUILD_WASM_URL: config.esbuildWasmUrl,
  };
  readNodeWorkerRuntimeConfig(env, 'node-worker-runtime-config');
  return Object.freeze(env);
}

/** Parse the opaque host snapshot carried by a kernel process spec. */
export function readNodeWorkerRuntimeConfig(
  env: Readonly<Record<string, string | undefined>>,
  owner: string,
): NodeWorkerRuntimeConfig {
  return {
    kernelWorkerUrl: required(env, 'RIFTY_KERNEL_WORKER_URL', owner),
    nodeEntryWorkerUrl: required(env, 'RIFTY_NODE_ENTRY_WORKER_URL', owner),
    sqliteWasmUrl: required(env, 'RIFTY_SQLITE_WASM_URL', owner),
    esbuildWasmUrl: required(env, 'RIFTY_ESBUILD_WASM_URL', owner),
  };
}

/** Keep Vite from replacing a direct `globalThis.process.env` read with `{}`. */
export function readNodeWorkerRuntimeConfigFromProcess(
  proc: Pick<NodeJS.Process, 'env'>,
  owner: string,
): NodeWorkerRuntimeConfig {
  return readNodeWorkerRuntimeConfig(proc.env, owner);
}

/** Validate once, then atomically install both recursive-worker seams. */
export function installNodeWorkerRuntimeConfig(
  config: NodeWorkerRuntimeConfig,
): Readonly<Record<string, string>> {
  const runtimeEnv = buildNodeWorkerRuntimeEnv(config);
  setKernelWorkerUrl(config.kernelWorkerUrl);
  configureNodeEntryWorker(config.nodeEntryWorkerUrl, runtimeEnv);
  return runtimeEnv;
}
