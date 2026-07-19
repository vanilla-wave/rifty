import { setKernelWorkerUrl } from '@riftydev/kernel';
import { configureNodeEntryWorker } from '@riftydev/runtime-js/builtins/node-entry-url';
import esbuildWasmUrl from 'esbuild-wasm/esbuild.wasm?url';
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import kernelWorkerUrl from '../workers/kernel-worker-entry.ts?worker&url';
import nodeEntryWorkerUrl from '../workers/node-entry-bootstrap.ts?worker&url';

export interface PlaygroundNodeWorkerRuntimeConfig {
  readonly kernelWorkerUrl: string;
  readonly nodeEntryWorkerUrl: string;
  readonly sqliteWasmUrl: string;
  readonly esbuildWasmUrl: string;
}

/** Vite-owned deployment assets; runtime-js only receives the opaque snapshot. */
export const PLAYGROUND_NODE_WORKER_RUNTIME_CONFIG: PlaygroundNodeWorkerRuntimeConfig =
  Object.freeze({
    kernelWorkerUrl,
    nodeEntryWorkerUrl,
    sqliteWasmUrl: sqlWasmUrl,
    esbuildWasmUrl,
  });

export const PLAYGROUND_NODE_WORKER_RUNTIME_ENV = Object.freeze({
  RIFTY_KERNEL_WORKER_URL: PLAYGROUND_NODE_WORKER_RUNTIME_CONFIG.kernelWorkerUrl,
  RIFTY_NODE_ENTRY_WORKER_URL: PLAYGROUND_NODE_WORKER_RUNTIME_CONFIG.nodeEntryWorkerUrl,
  RIFTY_SQLITE_WASM_URL: PLAYGROUND_NODE_WORKER_RUNTIME_CONFIG.sqliteWasmUrl,
  RIFTY_ESBUILD_WASM_URL: PLAYGROUND_NODE_WORKER_RUNTIME_CONFIG.esbuildWasmUrl,
});

export function installPlaygroundNodeWorkerRuntime(): void {
  setKernelWorkerUrl(PLAYGROUND_NODE_WORKER_RUNTIME_CONFIG.kernelWorkerUrl);
  configureNodeEntryWorker(
    PLAYGROUND_NODE_WORKER_RUNTIME_CONFIG.nodeEntryWorkerUrl,
    PLAYGROUND_NODE_WORKER_RUNTIME_ENV,
  );
}
