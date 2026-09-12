import { describe, expect, it } from 'vitest';
import {
  buildNodeWorkerRuntimeEnv,
  readNodeWorkerRuntimeConfig,
  snapshotNodeWorkerRuntimeConfig,
} from './node-worker-runtime-config.ts';

const host = {
  kernelWorkerUrl: 'https://consumer.test/kernel.js',
  nodeEntryWorkerUrl: 'https://consumer.test/node.js',
};

describe('optional SQLite host bootstrap', () => {
  it('roundtrips absence without fabricating a SQLite URL', () => {
    const snapshot = snapshotNodeWorkerRuntimeConfig(host, 'test');
    const serialized = buildNodeWorkerRuntimeEnv(snapshot);
    expect(serialized).toEqual({
      RIFTY_KERNEL_WORKER_URL: host.kernelWorkerUrl,
      RIFTY_NODE_ENTRY_WORKER_URL: host.nodeEntryWorkerUrl,
    });
    expect(readNodeWorkerRuntimeConfig(serialized, 'test')).toEqual(host);
  });

  it('roundtrips the exact supplied SQLite URL', () => {
    const config = { ...host, sqliteWasmUrl: 'blob:https://consumer.test/sqlite' };
    expect(readNodeWorkerRuntimeConfig(buildNodeWorkerRuntimeEnv(config), 'test')).toEqual(config);
  });

  it.each(['', ' ', null, 42])(
    'rejects supplied malformed SQLite metadata: %j',
    (sqliteWasmUrl) => {
      expect(() => snapshotNodeWorkerRuntimeConfig({ ...host, sqliteWasmUrl }, 'test')).toThrow(
        /sqliteWasmUrl/,
      );
    },
  );

  it('keeps required fields and unknown-field rejection', () => {
    expect(() =>
      snapshotNodeWorkerRuntimeConfig({ kernelWorkerUrl: host.kernelWorkerUrl }, 'test'),
    ).toThrow();
    expect(() => snapshotNodeWorkerRuntimeConfig({ ...host, unknown: 'value' }, 'test')).toThrow();
  });
});
