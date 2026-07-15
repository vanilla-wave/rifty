import { publishKernelEntryBootstrap } from '@riftydev/kernel';
import { afterEach, describe, expect, it } from 'vitest';
import {
  NODE_ENTRY_BOOTSTRAP_PROTOCOL,
  buildConfiguredNodeEntryWorkerEntry,
  buildNodeEntryWorkerEntry,
  readNodeEntryBootstrap,
  readNodeEntryBootstrapIfPresent,
} from './node-entry-runtime-config.ts';
import {
  configureNodeEntryWorker,
  getNodeEntryWorkerUrl,
  resetNodeEntryWorkerUrl,
  setNodeEntryWorkerUrl,
} from './node-entry-url.ts';

const PROGRAM_LAUNCH = {
  kind: 'program' as const,
  bin: true,
  remoteFs: true,
  nodeServe: true,
  previewScope: 'preview-a',
  terminal: {
    stdinIsTTY: false,
    stdoutIsTTY: true,
    stderrIsTTY: true,
    cols: 120,
    rows: 40,
  },
};

const HOST_RUNTIME = { RIFTY_KERNEL_WORKER_URL: 'https://host.test/kernel.js' };

describe('node-entry host bootstrap config', () => {
  afterEach(() => {
    publishKernelEntryBootstrap(null);
    resetNodeEntryWorkerUrl();
  });

  it('snapshots host runtime values out of band from the guest environment', () => {
    const hostRuntime = {
      RIFTY_KERNEL_WORKER_URL: 'https://host.test/kernel.js',
      RIFTY_SQLITE_WASM_URL: 'https://host.test/sqlite.wasm',
    };
    configureNodeEntryWorker('https://host.test/node.js', hostRuntime);
    hostRuntime.RIFTY_SQLITE_WASM_URL = 'https://mutated.test/sqlite.wasm';

    expect(buildConfiguredNodeEntryWorkerEntry(PROGRAM_LAUNCH)).toEqual({
      kind: 'url',
      url: 'https://host.test/node.js',
      bootstrap: {
        protocol: NODE_ENTRY_BOOTSTRAP_PROTOCOL,
        payload: {
          hostRuntime: {
            RIFTY_KERNEL_WORKER_URL: 'https://host.test/kernel.js',
            RIFTY_SQLITE_WASM_URL: 'https://host.test/sqlite.wasm',
          },
          launch: PROGRAM_LAUNCH,
        },
      },
    });
  });

  it('builds an explicit URL + host snapshot + fresh launch without global configuration', () => {
    expect(
      buildNodeEntryWorkerEntry(
        'https://host.test/node.js',
        { RIFTY_ESBUILD_WASM_URL: 'https://host.test/esbuild.wasm' },
        { kind: 'program', bin: false, remoteFs: true, nodeServe: false },
      ),
    ).toMatchObject({
      kind: 'url',
      url: 'https://host.test/node.js',
      bootstrap: {
        protocol: NODE_ENTRY_BOOTSTRAP_PROTOCOL,
        payload: {
          hostRuntime: { RIFTY_ESBUILD_WASM_URL: 'https://host.test/esbuild.wasm' },
          launch: { kind: 'program', bin: false, remoteFs: true, nodeServe: false },
        },
      },
    });
  });

  it('keeps the previous URL and host snapshot paired when replacement validation fails', () => {
    configureNodeEntryWorker('https://host.test/node-a.js', {
      RIFTY_SQLITE_WASM_URL: 'https://host.test/sqlite-a.wasm',
    });

    expect(() =>
      configureNodeEntryWorker('https://host.test/node-b.js', {
        RIFTY_SQLITE_WASM_URL: '',
      }),
    ).toThrow(/host runtime/i);

    expect(getNodeEntryWorkerUrl()).toBe('https://host.test/node-a.js');
    expect(buildConfiguredNodeEntryWorkerEntry(PROGRAM_LAUNCH)).toMatchObject({
      url: 'https://host.test/node-a.js',
      bootstrap: {
        payload: {
          hostRuntime: { RIFTY_SQLITE_WASM_URL: 'https://host.test/sqlite-a.wasm' },
        },
      },
    });
  });

  it('fails loud when no configured URL + host snapshot was installed', () => {
    resetNodeEntryWorkerUrl();
    expect(() => buildConfiguredNodeEntryWorkerEntry(PROGRAM_LAUNCH)).toThrow(
      /node-entry.*bootstrap config.*not configured/i,
    );
  });

  it('invalidates the host snapshot when the URL-only compatibility seam is used', () => {
    configureNodeEntryWorker('https://host.test/node-a.js', {
      RIFTY_SQLITE_WASM_URL: 'https://host.test/sqlite-a.wasm',
    });
    setNodeEntryWorkerUrl('https://host.test/node-b.js');

    expect(getNodeEntryWorkerUrl()).toBe('https://host.test/node-b.js');
    expect(() => buildConfiguredNodeEntryWorkerEntry(PROGRAM_LAUNCH)).toThrow(
      /node-entry.*bootstrap config.*not configured/i,
    );
  });

  it('strictly reads the matching kernel envelope and rejects missing or malformed payloads', () => {
    expect(() => readNodeEntryBootstrap()).toThrow(/missing node-entry bootstrap/i);

    publishKernelEntryBootstrap({
      protocol: NODE_ENTRY_BOOTSTRAP_PROTOCOL,
      payload: {
        hostRuntime: { RIFTY_KERNEL_WORKER_URL: 'kernel.js' },
        launch: { kind: 'program', bin: 'yes' },
      },
    });
    expect(() => readNodeEntryBootstrap()).toThrow(/node-entry bootstrap.*bin/i);

    publishKernelEntryBootstrap({
      protocol: 'other-runtime/v1',
      payload: {},
    });
    expect(readNodeEntryBootstrapIfPresent()).toBeNull();
    expect(() => readNodeEntryBootstrap()).toThrow(/protocol/i);
  });

  it.each([
    {
      owner: 'payload',
      extra: 'futurePayloadField',
      payload: {
        hostRuntime: HOST_RUNTIME,
        launch: { kind: 'program', bin: false, remoteFs: true, nodeServe: false },
        futurePayloadField: true,
      },
    },
    {
      owner: 'program launch',
      extra: 'futureProgramField',
      payload: {
        hostRuntime: HOST_RUNTIME,
        launch: {
          kind: 'program',
          bin: false,
          remoteFs: true,
          nodeServe: false,
          futureProgramField: true,
        },
      },
    },
    {
      owner: 'worker-thread launch',
      extra: 'futureWorkerField',
      payload: {
        hostRuntime: HOST_RUNTIME,
        launch: {
          kind: 'worker-thread',
          remoteFs: true,
          threadId: 1,
          futureWorkerField: true,
        },
      },
    },
    {
      owner: 'terminal',
      extra: 'futureTerminalField',
      payload: {
        hostRuntime: HOST_RUNTIME,
        launch: {
          kind: 'program',
          bin: false,
          remoteFs: true,
          nodeServe: false,
          terminal: {
            stdinIsTTY: false,
            stdoutIsTTY: true,
            stderrIsTTY: true,
            cols: 80,
            rows: 24,
            futureTerminalField: true,
          },
        },
      },
    },
  ])('rejects an extra $extra field on the $owner record', ({ extra, payload }) => {
    publishKernelEntryBootstrap({ protocol: NODE_ENTRY_BOOTSTRAP_PROTOCOL, payload });

    expect(() => readNodeEntryBootstrap()).toThrow(
      new RegExp(`node-entry bootstrap.*unexpected field.*${extra}`, 'i'),
    );
  });

  it('rejects invalid terminal metadata before a worker is spawned', () => {
    expect(() =>
      buildNodeEntryWorkerEntry(
        'https://host.test/node.js',
        { RIFTY_KERNEL_WORKER_URL: 'https://host.test/kernel.js' },
        {
          ...PROGRAM_LAUNCH,
          terminal: { ...PROGRAM_LAUNCH.terminal, cols: 0 },
        },
      ),
    ).toThrow(/terminal.*cols.*positive/i);
  });
});
