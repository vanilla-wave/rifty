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

const EVAL_LAUNCH = {
  kind: 'eval' as const,
  source: "require('./package.json').name",
  print: true,
  execArgv: ['--print', "require('./package.json').name"],
  remoteFs: true,
  previewScope: 'preview-eval',
  terminal: {
    stdinIsTTY: false,
    stdoutIsTTY: true,
    stderrIsTTY: true,
    cols: 100,
    rows: 30,
  },
};

const HOST_RUNTIME = { RIFTY_KERNEL_WORKER_URL: 'https://host.test/kernel.js' };
const REMOTE_FS_ROOT = '/.rifty/workbench/v1/projects/project-a/tree';

function evalLaunch(overrides: Readonly<Record<string, unknown>> = {}): NodeEntryLaunch {
  return { ...EVAL_LAUNCH, ...overrides } as unknown as NodeEntryLaunch;
}

describe('node-entry host bootstrap config', () => {
  afterEach(() => {
    publishKernelEntryBootstrap(null);
    resetNodeEntryWorkerUrl();
  });

  it('uses the one atomic node-entry v3 wire contract', () => {
    expect(NODE_ENTRY_BOOTSTRAP_PROTOCOL).toBe('rifty.node-entry/v3');
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
        { RIFTY_TEST_VALUE: 'host-snapshot' },
        { kind: 'program', bin: false, remoteFs: true, nodeServe: false },
      ),
    ).toMatchObject({
      kind: 'url',
      url: 'https://host.test/node.js',
      bootstrap: {
        protocol: NODE_ENTRY_BOOTSTRAP_PROTOCOL,
        payload: {
          hostRuntime: { RIFTY_TEST_VALUE: 'host-snapshot' },
          launch: { kind: 'program', bin: false, remoteFs: true, nodeServe: false },
        },
      },
    });
  });

  it('builds one exact eval launch and snapshots original execArgv', () => {
    const execArgv = ['--print', "require('./package.json').name"];
    const entry = buildNodeEntryWorkerEntry(
      'https://host.test/node.js',
      HOST_RUNTIME,
      evalLaunch({ execArgv }),
    );
    execArgv.push('--mutated-after-build');

    expect(entry).toMatchObject({
      kind: 'url',
      bootstrap: {
        protocol: 'rifty.node-entry/v3',
        payload: {
          launch: {
            kind: 'eval',
            source: "require('./package.json').name",
            print: true,
            execArgv: ['--print', "require('./package.json').name"],
            remoteFs: true,
            previewScope: 'preview-eval',
            terminal: EVAL_LAUNCH.terminal,
          },
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
      kind: 'eval',
      launch: evalLaunch({ remoteFsRoot: REMOTE_FS_ROOT }),
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
      evalLaunch({ previewScope: undefined, terminal: undefined }),
      { kind: 'worker-thread', remoteFs: true, threadId: 11 },
    ];
    for (const nestedLaunch of nestedLaunches) {
      expect(buildConfiguredNodeEntryWorkerEntry(nestedLaunch)).toMatchObject({
        bootstrap: { payload: { launch: { remoteFsRoot: REMOTE_FS_ROOT } } },
      });
    }
  });

  it('inherits the private preview scope into recursively configured foreground launches', () => {
    publishKernelEntryBootstrap({
      protocol: NODE_ENTRY_BOOTSTRAP_PROTOCOL,
      payload: {
        hostRuntime: HOST_RUNTIME,
        launch: {
          kind: 'program',
          bin: true,
          remoteFs: true,
          remoteFsRoot: REMOTE_FS_ROOT,
          nodeServe: true,
          previewScope: 'owner-preview',
        },
      },
    });
    configureNodeEntryWorker('https://host.test/node.js', HOST_RUNTIME);

    const nestedLaunches: NodeEntryLaunch[] = [
      {
        kind: 'program',
        bin: false,
        remoteFs: true,
        nodeServe: true,
      },
      evalLaunch({ previewScope: undefined, terminal: undefined }),
    ];
    for (const nestedLaunch of nestedLaunches) {
      expect(buildConfiguredNodeEntryWorkerEntry(nestedLaunch)).toMatchObject({
        bootstrap: {
          payload: {
            launch: {
              previewScope: 'owner-preview',
              remoteFsRoot: REMOTE_FS_ROOT,
            },
          },
        },
      });
    }
  });

  it('inherits eval ownership into recursively configured entries', () => {
    publishKernelEntryBootstrap({
      protocol: NODE_ENTRY_BOOTSTRAP_PROTOCOL,
      payload: {
        hostRuntime: HOST_RUNTIME,
        launch: evalLaunch({
          remoteFsRoot: REMOTE_FS_ROOT,
          previewScope: 'eval-owner-preview',
        }),
      },
    });
    configureNodeEntryWorker('https://host.test/node.js', HOST_RUNTIME);

    expect(
      buildConfiguredNodeEntryWorkerEntry({
        kind: 'program',
        bin: false,
        remoteFs: true,
        nodeServe: true,
      }),
    ).toMatchObject({
      bootstrap: {
        payload: {
          launch: {
            previewScope: 'eval-owner-preview',
            remoteFsRoot: REMOTE_FS_ROOT,
          },
        },
      },
    });
  });

  it('rejects recursive remote FS before spawn when the parent has no owner-root proof', () => {
    publishKernelEntryBootstrap({
      protocol: NODE_ENTRY_BOOTSTRAP_PROTOCOL,
      payload: {
        hostRuntime: HOST_RUNTIME,
        launch: {
          kind: 'program',
          bin: false,
          remoteFs: true,
          nodeServe: true,
        },
      },
    });
    configureNodeEntryWorker('https://host.test/node.js', HOST_RUNTIME);

    expect(() =>
      buildConfiguredNodeEntryWorkerEntry({
        kind: 'program',
        bin: false,
        remoteFs: true,
        nodeServe: false,
      }),
    ).toThrow(/remote[- ]?FS.*root|remoteFsRoot/i);
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

  it('does not read or fall back to the retired node-entry v2 protocol', () => {
    publishKernelEntryBootstrap({
      protocol: 'rifty.node-entry/v2',
      payload: {
        hostRuntime: HOST_RUNTIME,
        launch: { kind: 'program', bin: false, remoteFs: true, nodeServe: false },
      },
    });

    expect(readNodeEntryBootstrapIfPresent()).toBeNull();
    expect(() => readNodeEntryBootstrap()).toThrow(/protocol.*v3.*v2/i);
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
      owner: 'eval launch',
      extra: 'bin',
      payload: {
        hostRuntime: HOST_RUNTIME,
        launch: { ...EVAL_LAUNCH, bin: false },
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

  it.each(['source', 'print', 'execArgv', 'remoteFs'])(
    'rejects an eval launch with missing required %s',
    (field) => {
      const launch: Record<string, unknown> = { ...EVAL_LAUNCH };
      Reflect.deleteProperty(launch, field);

      expect(() =>
        buildNodeEntryWorkerEntry(
          'https://host.test/node.js',
          HOST_RUNTIME,
          launch as unknown as NodeEntryLaunch,
        ),
      ).toThrow(new RegExp(`launch.*missing field.*${field}`, 'i'));
    },
  );

  it.each([
    ['non-string source', { source: 42 }, /launch.*source.*string/i],
    ['non-boolean print', { print: 'yes' }, /launch.*print.*boolean/i],
    ['non-boolean remoteFs', { remoteFs: 'yes' }, /launch.*remoteFs.*boolean/i],
    ['non-array execArgv', { execArgv: '--print' }, /launch.*execArgv.*array/i],
    [
      'non-string first execArgv entry',
      { execArgv: [42, '--print', 'source'] },
      /launch.*execArgv.*string/i,
    ],
    [
      'non-string middle execArgv entry',
      { execArgv: ['--trace-warnings', 42, '--print'] },
      /launch.*execArgv.*string/i,
    ],
    [
      'non-string last execArgv entry',
      { execArgv: ['--trace-warnings', '--print', 42] },
      /launch.*execArgv.*string/i,
    ],
    ['extra exact-own eval field', { futureEvalField: true }, /unexpected field.*futureEvalField/i],
    ['program-only bin', { bin: false }, /unexpected field.*bin/i],
    ['program-only nodeServe', { nodeServe: false }, /unexpected field.*nodeServe/i],
    ['program-only ipc', { ipc: 'none' }, /unexpected field.*ipc/i],
  ])('rejects corrupt eval launch: %s', (_label, override, error) => {
    expect(() =>
      buildNodeEntryWorkerEntry('https://host.test/node.js', HOST_RUNTIME, evalLaunch(override)),
    ).toThrow(error);
  });

  it.each([0, 1, 2])('rejects a sparse eval execArgv hole at index %i', (hole) => {
    const execArgv = ['--trace-warnings', '--print', 'source'];
    Reflect.deleteProperty(execArgv, hole);

    expect(() =>
      buildNodeEntryWorkerEntry(
        'https://host.test/node.js',
        HOST_RUNTIME,
        evalLaunch({ execArgv }),
      ),
    ).toThrow(/launch.*execArgv.*string/i);
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

  it('rejects inherited terminal fields at the shared exact-own boundary', () => {
    const inherited = Object.create({
      stdinIsTTY: false,
      stdoutIsTTY: true,
      stderrIsTTY: true,
      cols: 80,
      rows: 24,
    }) as NodeEntryTerminalBootstrap;

    expect(() =>
      buildNodeEntryWorkerEntry(
        'https://host.test/node.js',
        { RIFTY_KERNEL_WORKER_URL: 'https://host.test/kernel.js' },
        { ...PROGRAM_LAUNCH, terminal: inherited },
      ),
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
    ['eval', EVAL_LAUNCH],
    ['worker-thread', { kind: 'worker-thread' as const, remoteFs: true, threadId: 7 }],
  ])('rejects inherited required %s launch fields', (_kind, launch) => {
    const inherited = Object.create(launch) as typeof launch;

    expect(() =>
      buildNodeEntryWorkerEntry(
        'https://host.test/node.js',
        { RIFTY_KERNEL_WORKER_URL: 'https://host.test/kernel.js' },
        inherited as unknown as NodeEntryLaunch,
      ),
    ).toThrow(/launch.*missing field/i);
  });
});
