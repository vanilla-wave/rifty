import { setKernelWorkerUrl } from '@riftydev/kernel';
import { configureNodeEntryWorker } from '@riftydev/runtime-js/builtins/node-entry-url';
import kernelWorkerUrl from '@riftydev/workbench/kernel-worker?worker&url';
import nodeEntryWorkerUrl from '@riftydev/workbench/node-worker?worker&url';
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url';

export interface PlaygroundNodeWorkerRuntimeConfig {
  readonly kernelWorkerUrl: string;
  readonly nodeEntryWorkerUrl: string;
  readonly sqliteWasmUrl: string;
}

/** Vite-owned deployment assets; runtime-js only receives the opaque snapshot. */
export const PLAYGROUND_NODE_WORKER_RUNTIME_CONFIG: PlaygroundNodeWorkerRuntimeConfig =
  Object.freeze({
    kernelWorkerUrl,
    nodeEntryWorkerUrl,
    sqliteWasmUrl: sqlWasmUrl,
  });

export const PLAYGROUND_NODE_WORKER_RUNTIME_ENV = Object.freeze({
  RIFTY_KERNEL_WORKER_URL: PLAYGROUND_NODE_WORKER_RUNTIME_CONFIG.kernelWorkerUrl,
  RIFTY_NODE_ENTRY_WORKER_URL: PLAYGROUND_NODE_WORKER_RUNTIME_CONFIG.nodeEntryWorkerUrl,
  RIFTY_SQLITE_WASM_URL: PLAYGROUND_NODE_WORKER_RUNTIME_CONFIG.sqliteWasmUrl,
});

export function installPlaygroundNodeWorkerRuntime(): void {
  setKernelWorkerUrl(PLAYGROUND_NODE_WORKER_RUNTIME_CONFIG.kernelWorkerUrl);
  configureNodeEntryWorker(
    PLAYGROUND_NODE_WORKER_RUNTIME_CONFIG.nodeEntryWorkerUrl,
    PLAYGROUND_NODE_WORKER_RUNTIME_ENV,
  );
}
