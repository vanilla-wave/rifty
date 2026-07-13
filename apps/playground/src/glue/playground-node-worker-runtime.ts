import esbuildWasmUrl from 'esbuild-wasm/esbuild.wasm?url';
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import kernelWorkerUrl from '../workers/kernel-worker-entry.ts?worker&url';
import nodeEntryWorkerUrl from '../workers/node-entry-bootstrap.ts?worker&url';
import {
  type NodeWorkerRuntimeConfig,
  buildNodeWorkerRuntimeEnv,
  installNodeWorkerRuntimeConfig,
} from '../workers/node-worker-runtime-config.ts';

/** Vite-owned deployment assets; runtime-js only receives the opaque snapshot. */
export const PLAYGROUND_NODE_WORKER_RUNTIME_CONFIG: NodeWorkerRuntimeConfig = Object.freeze({
  kernelWorkerUrl,
  nodeEntryWorkerUrl,
  sqliteWasmUrl: sqlWasmUrl,
  esbuildWasmUrl,
});

export const PLAYGROUND_NODE_WORKER_RUNTIME_ENV = buildNodeWorkerRuntimeEnv(
  PLAYGROUND_NODE_WORKER_RUNTIME_CONFIG,
);

export function installPlaygroundNodeWorkerRuntime(): void {
  installNodeWorkerRuntimeConfig(PLAYGROUND_NODE_WORKER_RUNTIME_CONFIG);
}
