import { publishKernelEntryBootstrap } from '@riftydev/kernel';
import { afterEach, describe, expect, it } from 'vitest';
import {
  NODE_ENTRY_BOOTSTRAP_PROTOCOL,
  buildNodeEntryWorkerEntry,
  readNodeEntryBootstrap,
} from './node-entry-runtime-config.ts';

const HOST_RUNTIME_V2 = Object.freeze({
  RIFTY_KERNEL_WORKER_URL: 'https://host.test/kernel.js',
  RIFTY_NODE_ENTRY_WORKER_URL: 'https://host.test/node-entry.js',
  RIFTY_SQLITE_WASM_URL: 'https://host.test/sqlite.wasm',
});

const PROGRAM_LAUNCH = Object.freeze({
  kind: 'program' as const,
  bin: false,
  remoteFs: true,
  nodeServe: false,
});

describe('node-entry bootstrap v2 exact host-runtime contract', () => {
  afterEach(() => publishKernelEntryBootstrap(null));

  it('emits only rifty.node-entry/v2 with the three host-runtime values', () => {
    expect(NODE_ENTRY_BOOTSTRAP_PROTOCOL).toBe('rifty.node-entry/v2');
    expect(
      buildNodeEntryWorkerEntry('https://host.test/node-entry.js', HOST_RUNTIME_V2, PROGRAM_LAUNCH),
    ).toMatchObject({
      bootstrap: {
        protocol: 'rifty.node-entry/v2',
        payload: { hostRuntime: HOST_RUNTIME_V2 },
      },
    });
  });

  it('rejects v1 before decoding its otherwise-valid payload', () => {
    publishKernelEntryBootstrap({
      protocol: 'rifty.node-entry/v1',
      payload: { hostRuntime: HOST_RUNTIME_V2, launch: PROGRAM_LAUNCH },
    });

    expect(() => readNodeEntryBootstrap()).toThrow(/protocol mismatch.*v2.*v1/i);
  });

  it('rejects the retired esbuild host field instead of ignoring it', () => {
    publishKernelEntryBootstrap({
      protocol: NODE_ENTRY_BOOTSTRAP_PROTOCOL,
      payload: {
        hostRuntime: {
          ...HOST_RUNTIME_V2,
          RIFTY_ESBUILD_WASM_URL: 'https://host.test/esbuild.wasm',
        },
        launch: PROGRAM_LAUNCH,
      },
    });

    expect(() => readNodeEntryBootstrap()).toThrow(/host runtime.*RIFTY_ESBUILD_WASM_URL/i);
  });
});
