import { describe, expect, it } from 'vitest';
import {
  buildNodeWorkerRuntimeEnv,
  snapshotNodeWorkerRuntimeConfig,
} from './node-worker-runtime-config.ts';

const RUNTIME_V2 = Object.freeze({
  kernelWorkerUrl: 'blob:kernel',
  nodeEntryWorkerUrl: 'blob:node-entry',
  sqliteWasmUrl: 'blob:sqlite',
});

describe('Node worker runtime v2 host seal', () => {
  it('serializes exactly kernel, node-entry, and SQLite host values', () => {
    expect(buildNodeWorkerRuntimeEnv(RUNTIME_V2 as never)).toEqual({
      RIFTY_KERNEL_WORKER_URL: 'blob:kernel',
      RIFTY_NODE_ENTRY_WORKER_URL: 'blob:node-entry',
      RIFTY_SQLITE_WASM_URL: 'blob:sqlite',
    });
  });

  it('rejects the retired esbuild field at the shared config boundary', () => {
    expect(() =>
      snapshotNodeWorkerRuntimeConfig(
        { ...RUNTIME_V2, esbuildWasmUrl: 'blob:retired-esbuild' },
        'contract',
      ),
    ).toThrow(/exactly.*kernelWorkerUrl.*nodeEntryWorkerUrl.*sqliteWasmUrl/i);
  });
});
