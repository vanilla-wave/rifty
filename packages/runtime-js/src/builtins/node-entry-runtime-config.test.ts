import { afterEach, describe, expect, it } from 'vitest';
import { mergeNodeEntryWorkerEnv } from './node-entry-runtime-config.ts';
import { configureNodeEntryWorker, resetNodeEntryWorkerUrl } from './node-entry-url.ts';

describe('node-entry host runtime config', () => {
  afterEach(() => resetNodeEntryWorkerUrl());

  it('protects host-owned bootstrap keys from an explicit user env replacement', () => {
    const hostEnv = {
      RIFTY_KERNEL_WORKER_URL: 'https://host.test/kernel.js',
      RIFTY_SQLITE_WASM_URL: 'https://host.test/sqlite.wasm',
    };
    configureNodeEntryWorker('https://host.test/node.js', hostEnv);
    hostEnv.RIFTY_SQLITE_WASM_URL = 'https://mutated.test/sqlite.wasm';

    expect(
      mergeNodeEntryWorkerEnv({
        USER_VALUE: 'explicit',
        RIFTY_SQLITE_WASM_URL: 'https://user.test/sqlite.wasm',
      }),
    ).toEqual({
      USER_VALUE: 'explicit',
      RIFTY_KERNEL_WORKER_URL: 'https://host.test/kernel.js',
      RIFTY_SQLITE_WASM_URL: 'https://host.test/sqlite.wasm',
    });
  });

  it('clears bootstrap env together with the worker URL', () => {
    configureNodeEntryWorker('https://host.test/node.js', { HOST_ONLY: '1' });
    resetNodeEntryWorkerUrl();

    expect(mergeNodeEntryWorkerEnv({ USER_ONLY: '1' })).toEqual({ USER_ONLY: '1' });
  });
});
