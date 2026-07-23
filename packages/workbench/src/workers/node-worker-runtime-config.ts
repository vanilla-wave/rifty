import { setKernelWorkerUrl } from '@riftydev/kernel';
import { configureNodeEntryWorker } from '@riftydev/runtime-js/builtins/node-entry-url';

export interface NodeWorkerRuntimeConfig {
  readonly kernelWorkerUrl: string;
  readonly nodeEntryWorkerUrl: string;
  readonly sqliteWasmUrl: string;
  readonly esbuildWasmUrl: string;
}

function objectRecord(value: unknown, owner: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${owner} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactFields(
  value: Record<string, unknown>,
  expected: readonly string[],
  owner: string,
): void {
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== expected.length ||
    expected.some((key) => !Object.prototype.hasOwnProperty.call(value, key))
  ) {
    throw new TypeError(`${owner} must contain exactly ${expected.join(', ')}`);
  }
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${field} must be a non-empty string`);
  }
  return value;
}

/** Validate and detach an entry-scoped recursive-worker host snapshot. */
export function snapshotNodeWorkerRuntimeConfig(
  value: unknown,
  owner: string,
): NodeWorkerRuntimeConfig {
  const record = objectRecord(value, owner);
  exactFields(
    record,
    ['kernelWorkerUrl', 'nodeEntryWorkerUrl', 'sqliteWasmUrl', 'esbuildWasmUrl'],
    owner,
  );
  return Object.freeze({
    kernelWorkerUrl: nonEmptyString(record.kernelWorkerUrl, `${owner}.kernelWorkerUrl`),
    nodeEntryWorkerUrl: nonEmptyString(record.nodeEntryWorkerUrl, `${owner}.nodeEntryWorkerUrl`),
    sqliteWasmUrl: nonEmptyString(record.sqliteWasmUrl, `${owner}.sqliteWasmUrl`),
    esbuildWasmUrl: nonEmptyString(record.esbuildWasmUrl, `${owner}.esbuildWasmUrl`),
  });
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
  const snapshot = snapshotNodeWorkerRuntimeConfig(config, 'node-worker-runtime-config');
  const env = {
    RIFTY_KERNEL_WORKER_URL: snapshot.kernelWorkerUrl,
    RIFTY_NODE_ENTRY_WORKER_URL: snapshot.nodeEntryWorkerUrl,
    RIFTY_SQLITE_WASM_URL: snapshot.sqliteWasmUrl,
    RIFTY_ESBUILD_WASM_URL: snapshot.esbuildWasmUrl,
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
  const snapshot = snapshotNodeWorkerRuntimeConfig(config, 'node-worker-runtime-config');
  const runtimeEnv = buildNodeWorkerRuntimeEnv(snapshot);
  setKernelWorkerUrl(snapshot.kernelWorkerUrl);
  configureNodeEntryWorker(snapshot.nodeEntryWorkerUrl, runtimeEnv);
  return runtimeEnv;
}
