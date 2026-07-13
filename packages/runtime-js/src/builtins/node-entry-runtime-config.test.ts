import { afterEach, describe, expect, it } from 'vitest';
import { mergeNodeEntryWorkerEnv } from './node-entry-runtime-config.ts';
import {
  configureNodeEntryWorker,
  getNodeEntryWorkerUrl,
  resetNodeEntryWorkerUrl,
  setNodeEntryWorkerUrl,
} from './node-entry-url.ts';

describe('node-entry host runtime config', () => {
  afterEach(() => resetNodeEntryWorkerUrl());

  it('snapshots host bootstrap values and applies them after user env', () => {
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

  it('keeps the previous URL and env paired when replacement validation fails', () => {
    configureNodeEntryWorker('https://host.test/node-a.js', {
      RIFTY_SQLITE_WASM_URL: 'https://host.test/sqlite-a.wasm',
    });

    expect(() =>
      configureNodeEntryWorker('https://host.test/node-b.js', {
        RIFTY_SQLITE_WASM_URL: '',
      }),
    ).toThrow(/runtime env/i);

    expect(getNodeEntryWorkerUrl()).toBe('https://host.test/node-a.js');
    expect(mergeNodeEntryWorkerEnv({})).toEqual({
      RIFTY_SQLITE_WASM_URL: 'https://host.test/sqlite-a.wasm',
    });
  });

  it('fails loud when no host bootstrap config was installed', () => {
    resetNodeEntryWorkerUrl();

    expect(() => mergeNodeEntryWorkerEnv({ USER_VALUE: '1' })).toThrow(
      /node-entry.*runtime config.*not configured/i,
    );
  });

  it('invalidates bootstrap env when the URL-only compatibility seam is used', () => {
    configureNodeEntryWorker('https://host.test/node-a.js', {
      RIFTY_SQLITE_WASM_URL: 'https://host.test/sqlite-a.wasm',
    });
    setNodeEntryWorkerUrl('https://host.test/node-b.js');

    expect(getNodeEntryWorkerUrl()).toBe('https://host.test/node-b.js');
    expect(() => mergeNodeEntryWorkerEnv({})).toThrow(
      /node-entry.*runtime config.*not configured/i,
    );
  });
});
