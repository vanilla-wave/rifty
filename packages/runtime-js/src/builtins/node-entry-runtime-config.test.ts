import { publishKernelEntryBootstrap } from '@riftydev/kernel';
import { afterEach, describe, expect, it } from 'vitest';
import {
  NODE_ENTRY_BOOTSTRAP_PROTOCOL,
  type NodeEntryLaunch,
  type NodeEntryTerminalBootstrap,
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

const HOST_RUNTIME = {
  RIFTY_KERNEL_WORKER_URL: 'https://host.test/kernel.js',
  RIFTY_NODE_ENTRY_WORKER_URL: 'https://host.test/node.js',
  RIFTY_SQLITE_WASM_URL: 'https://host.test/sqlite.wasm',
};
const REMOTE_FS_ROOT = '/.rifty/workbench/v1/projects/project-a/tree';

describe('node-entry host bootstrap config', () => {
  afterEach(() => {
    publishKernelEntryBootstrap(null);
    resetNodeEntryWorkerUrl();
  });

  it('snapshots host runtime values out of band from the guest environment', () => {
    const hostRuntime = { ...HOST_RUNTIME };
    configureNodeEntryWorker('https://host.test/node.js', hostRuntime);
    hostRuntime.RIFTY_SQLITE_WASM_URL = 'https://mutated.test/sqlite.wasm';

    expect(buildConfiguredNodeEntryWorkerEntry(PROGRAM_LAUNCH)).toEqual({
      kind: 'url',
      url: 'https://host.test/node.js',
      bootstrap: {
        protocol: NODE_ENTRY_BOOTSTRAP_PROTOCOL,
        payload: {
          hostRuntime: HOST_RUNTIME,
          launch: PROGRAM_LAUNCH,
        },
      },
    });
  });

  it('builds an explicit URL + host snapshot + fresh launch without global configuration', () => {
    expect(
      buildNodeEntryWorkerEntry('https://host.test/node.js', HOST_RUNTIME, {
        kind: 'program',
        bin: false,
        remoteFs: true,
        nodeServe: false,
      }),
    ).toMatchObject({
      kind: 'url',
      url: 'https://host.test/node.js',
      bootstrap: {
        protocol: NODE_ENTRY_BOOTSTRAP_PROTOCOL,
        payload: {
          hostRuntime: HOST_RUNTIME,
          launch: { kind: 'program', bin: false, remoteFs: true, nodeServe: false },
        },
      },
    });
  });

  it.each([
    {
      kind: 'program',
      launch: {
        kind: 'program',
        bin: false,
        remoteFs: true,
        nodeServe: false,
        remoteFsRoot: REMOTE_FS_ROOT,
      } satisfies NodeEntryLaunch,
    },
    {
      kind: 'worker-thread',
      launch: {
        kind: 'worker-thread',
        remoteFs: true,
        remoteFsRoot: REMOTE_FS_ROOT,
        threadId: 7,
      } satisfies NodeEntryLaunch,
    },
  ])('carries a validated private remote-FS root on a $kind launch', ({ launch }) => {
    const entry = buildNodeEntryWorkerEntry('https://host.test/node.js', HOST_RUNTIME, launch);

    expect(entry.bootstrap?.payload).toMatchObject({
      launch: { remoteFsRoot: REMOTE_FS_ROOT },
    });
  });

  it('inherits the private remote-FS root into recursively configured entries', () => {
    publishKernelEntryBootstrap({
      protocol: NODE_ENTRY_BOOTSTRAP_PROTOCOL,
      payload: {
        hostRuntime: HOST_RUNTIME,
        launch: {
          kind: 'program',
          bin: false,
          remoteFs: true,
          remoteFsRoot: REMOTE_FS_ROOT,
          nodeServe: true,
        },
      },
    });
    configureNodeEntryWorker('https://host.test/node.js', HOST_RUNTIME);

    const nestedLaunches: NodeEntryLaunch[] = [
      { kind: 'program', bin: false, remoteFs: true, nodeServe: false },
      { kind: 'worker-thread', remoteFs: true, threadId: 11 },
    ];
    for (const nestedLaunch of nestedLaunches) {
      expect(buildConfiguredNodeEntryWorkerEntry(nestedLaunch)).toMatchObject({
        bootstrap: { payload: { launch: { remoteFsRoot: REMOTE_FS_ROOT } } },
      });
    }
  });

  it.each(['relative/root', '/not/normalized/../root', '/', ''])(
    'rejects invalid private remote-FS root %j',
    (remoteFsRoot) => {
      expect(() =>
        buildNodeEntryWorkerEntry('https://host.test/node.js', HOST_RUNTIME, {
          ...PROGRAM_LAUNCH,
          remoteFsRoot,
        }),
      ).toThrow(/remoteFsRoot.*absolute normalized.*non-root/i);
    },
  );

  it('rejects a private root on a launch that did not request remote FS', () => {
    expect(() =>
      buildNodeEntryWorkerEntry('https://host.test/node.js', HOST_RUNTIME, {
        kind: 'program',
        bin: false,
        remoteFs: false,
        remoteFsRoot: REMOTE_FS_ROOT,
        nodeServe: false,
      }),
    ).toThrow(/remoteFsRoot.*requires.*remoteFs.*true/i);
  });

  it('rejects a nested launch that tries to replace the inherited private root', () => {
    publishKernelEntryBootstrap({
      protocol: NODE_ENTRY_BOOTSTRAP_PROTOCOL,
      payload: {
        hostRuntime: HOST_RUNTIME,
        launch: {
          kind: 'program',
          bin: false,
          remoteFs: true,
          remoteFsRoot: REMOTE_FS_ROOT,
          nodeServe: true,
        },
      },
    });
    configureNodeEntryWorker('https://host.test/node.js', HOST_RUNTIME);

    expect(() =>
      buildConfiguredNodeEntryWorkerEntry({
        kind: 'worker-thread',
        remoteFs: true,
        remoteFsRoot: '/.rifty/workbench/v1/projects/project-b/tree',
        threadId: 12,
      }),
    ).toThrow(/cannot replace.*remoteFsRoot/i);
  });

  it('keeps the previous URL and host snapshot paired when replacement validation fails', () => {
    const runtimeA = {
      ...HOST_RUNTIME,
      RIFTY_NODE_ENTRY_WORKER_URL: 'https://host.test/node-a.js',
      RIFTY_SQLITE_WASM_URL: 'https://host.test/sqlite-a.wasm',
    };
    configureNodeEntryWorker('https://host.test/node-a.js', runtimeA);

    expect(() =>
      configureNodeEntryWorker('https://host.test/node-b.js', {
        ...HOST_RUNTIME,
        RIFTY_NODE_ENTRY_WORKER_URL: 'https://host.test/node-b.js',
        RIFTY_SQLITE_WASM_URL: '',
      }),
    ).toThrow(/host runtime/i);

    expect(getNodeEntryWorkerUrl()).toBe('https://host.test/node-a.js');
    expect(buildConfiguredNodeEntryWorkerEntry(PROGRAM_LAUNCH)).toMatchObject({
      url: 'https://host.test/node-a.js',
      bootstrap: {
        payload: {
          hostRuntime: runtimeA,
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
      ...HOST_RUNTIME,
      RIFTY_NODE_ENTRY_WORKER_URL: 'https://host.test/node-a.js',
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
        hostRuntime: HOST_RUNTIME,
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
      buildNodeEntryWorkerEntry('https://host.test/node.js', HOST_RUNTIME, {
        ...PROGRAM_LAUNCH,
        terminal: { ...PROGRAM_LAUNCH.terminal, cols: 0 },
      }),
    ).toThrow(/terminal.*cols.*positive/i);
  });

  it('rejects inherited terminal fields at the shared exact-own boundary', () => {
    const inherited = Object.create({
      stdinIsTTY: false,
      stdoutIsTTY: true,
      stderrIsTTY: true,
      cols: 80,
      rows: 24,
    }) as NodeEntryTerminalBootstrap;

    expect(() =>
      buildNodeEntryWorkerEntry('https://host.test/node.js', HOST_RUNTIME, {
        ...PROGRAM_LAUNCH,
        terminal: inherited,
      }),
    ).toThrow(/terminal.*missing field/i);
  });

  it('rejects inherited required payload fields at the exact-own boundary', () => {
    const payload = Object.create({
      hostRuntime: HOST_RUNTIME,
      launch: PROGRAM_LAUNCH,
    });
    publishKernelEntryBootstrap({ protocol: NODE_ENTRY_BOOTSTRAP_PROTOCOL, payload });

    expect(() => readNodeEntryBootstrap()).toThrow(/payload.*missing field/i);
  });

  it.each([
    ['program', PROGRAM_LAUNCH],
    ['worker-thread', { kind: 'worker-thread' as const, remoteFs: true, threadId: 7 }],
  ])('rejects inherited required %s launch fields', (_kind, launch) => {
    const inherited = Object.create(launch) as typeof launch;

    expect(() =>
      buildNodeEntryWorkerEntry('https://host.test/node.js', HOST_RUNTIME, inherited),
    ).toThrow(/launch.*missing field/i);
  });
});
