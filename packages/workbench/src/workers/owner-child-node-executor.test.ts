import { EventEmitter } from 'node:events';
import { type SpawnWorkerSpec, globalProcessManager } from '@riftydev/kernel';
import { SHADOW_ASSET_PORT_CAPABILITY } from '@riftydev/npm-client/internal';
import { NODE_ENTRY_BOOTSTRAP_PROTOCOL } from '@riftydev/runtime-js/builtins/node-entry-url';
import type { CommandContext } from '@riftydev/shell';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  OwnerChildAdmissionReservation,
  ReserveOwnerChildAdmission,
} from './owner-child-admission.ts';
import {
  type NodeChildHandle,
  buildNodeChildSpawnSpec,
  createOwnerChildNodeExecutor,
  createOwnerExecSyncRunner,
} from './owner-child-node-executor.ts';

const NODE_WORKER_RUNTIME_ENV = {
  RIFTY_KERNEL_WORKER_URL: 'blob:kernel-url',
  RIFTY_NODE_ENTRY_WORKER_URL: 'blob:node-entry-url',
  RIFTY_SQLITE_WASM_URL: 'blob:sqlite-wasm',
};
const REMOTE_FS_ROOT = '/.rifty/workbench/v1/projects/project-a/tree';

function emptyAdmission(): OwnerChildAdmissionReservation {
  return Object.freeze({
    snapshot: Object.freeze({
      capabilityPorts: Object.freeze({}),
      dispose() {},
    }),
    commit() {},
    abortBeforeSpawn() {},
    async abortAfterChildSettlement(_error: unknown, exited: Promise<unknown>) {
      await exited;
    },
  });
}

const reserveEmptyAdmission: ReserveOwnerChildAdmission = async () => emptyAdmission();

afterEach(() => vi.restoreAllMocks());

function fakeHandle() {
  const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
  const dataCbs: Record<'stdout' | 'stderr', ((c: unknown) => void)[]> = { stdout: [], stderr: [] };
  const h = {
    kind: 'worker',
    stdout: () => ({ on: (_: 'data', cb: (c: unknown) => void) => dataCbs.stdout.push(cb) }),
    stderr: () => ({ on: (_: 'data', cb: (c: unknown) => void) => dataCbs.stderr.push(cb) }),
    on: (ev: string, cb: (...args: unknown[]) => void) => {
      const list = listeners[ev] ?? [];
      listeners[ev] = list;
      list.push(cb);
    },
    off: (ev: string, cb: (...args: unknown[]) => void) => {
      listeners[ev] = (listeners[ev] ?? []).filter((listener) => listener !== cb);
    },
    onListeningControl: (cb: (...args: unknown[]) => void) => {
      const list = listeners['control:listening'] ?? [];
      listeners['control:listening'] = list;
      list.push(cb);
    },
    send: vi.fn(),
    // Real WorkerHandle.kill() emits 'exit' synchronously — mirror that so the
    // executor's pre-abort listener ordering is exercised.
    kill: vi.fn((_signal?: string) => {
      for (const cb of listeners.exit ?? []) cb(null, 'SIGTERM');
      return true;
    }),
  } as unknown as NodeChildHandle;
  return {
    h,
    emit: (ev: string, ...args: unknown[]) => {
      for (const cb of listeners[ev] ?? []) cb(...args);
    },
    out: (c: unknown) => {
      for (const cb of dataCbs.stdout) cb(c);
    },
  };
}

function makeCtx(over: Record<string, unknown> = {}): CommandContext {
  return {
    cwd: '/w',
    env: {},
    stdout: { write: vi.fn() },
    stderr: { write: vi.fn() },
    signal: undefined,
    ...over,
  } as unknown as CommandContext;
}

function fakeRecursiveChild() {
  const stdout = {
    onmessage: null as ((event: MessageEvent) => void) | null,
    start: vi.fn(),
  };
  const stderr = {
    onmessage: null as ((event: MessageEvent) => void) | null,
    start: vi.fn(),
  };
  const listeners: Partial<Record<'exit' | 'peererror', (...args: unknown[]) => void>> = {};
  return {
    child: {
      ports: { stdout, stderr },
      on(event: 'exit' | 'peererror', listener: (...args: unknown[]) => void) {
        listeners[event] = listener;
      },
      off(event: 'exit' | 'peererror', listener: (...args: unknown[]) => void) {
        if (listeners[event] === listener) delete listeners[event];
      },
      terminate: vi.fn(),
    },
    stdout: (data: Uint8Array) => stdout.onmessage?.({ data } as MessageEvent),
    stderr: (data: Uint8Array) => stderr.onmessage?.({ data } as MessageEvent),
    exit: (code: number) => listeners.exit?.(code, null),
  };
}

describe('owner-child-node-executor', () => {
  it('keeps guest env exact and carries node-program metadata beside the entry', () => {
    const env = {
      PATH: '/x',
      RIFTY_SQLITE_WASM_URL: 'user-poison',
      RIFTY_BIN: 'user-bin',
      RIFTY_REMOTE_FS: 'user-remote-fs',
      RIFTY_NODE_SERVE: 'user-serve',
      RIFTY_PREVIEW_SCOPE: 'user-preview',
    };
    const spec = buildNodeChildSpawnSpec(
      '/w/app.js',
      ['a'],
      env,
      '/w',
      'URL',
      NODE_WORKER_RUNTIME_ENV,
      true,
      120,
      40,
      'owner-preview',
    );
    expect(spec).toMatchObject({
      entry: {
        kind: 'url',
        url: 'URL',
        bootstrap: {
          protocol: NODE_ENTRY_BOOTSTRAP_PROTOCOL,
          payload: {
            hostRuntime: NODE_WORKER_RUNTIME_ENV,
            launch: {
              kind: 'program',
              bin: false,
              remoteFs: true,
              nodeServe: true,
              previewScope: 'owner-preview',
              terminal: {
                stdinIsTTY: false,
                stdoutIsTTY: true,
                stderrIsTTY: true,
                cols: 120,
                rows: 40,
              },
            },
          },
        },
      },
      argv: ['rifty', '/w/app.js', 'a'],
      env,
      cwd: '/w',
      serve: true,
    });
    expect(spec.env).toEqual(env);
  });

  it('carries a private FS root out of band while process argv/cwd stay public', () => {
    const spec = buildNodeChildSpawnSpec(
      '/src/server.js',
      ['--port', '3000'],
      { USER_VALUE: 'kept' },
      '/',
      'URL',
      NODE_WORKER_RUNTIME_ENV,
      false,
      80,
      24,
      undefined,
      REMOTE_FS_ROOT,
    );

    expect(spec.entry).toMatchObject({
      bootstrap: { payload: { launch: { remoteFsRoot: REMOTE_FS_ROOT } } },
    });
    expect(spec.argv).toEqual(['rifty', '/src/server.js', '--port', '3000']);
    expect(spec.cwd).toBe('/');
    expect(spec.env).toEqual({ USER_VALUE: 'kept' });
    expect(JSON.stringify({ argv: spec.argv, cwd: spec.cwd, env: spec.env })).not.toContain(
      REMOTE_FS_ROOT,
    );
  });

  it('roots an owner execSync child out of band and captures stdout/stderr byte-exact', async () => {
    const fake = fakeRecursiveChild();
    const capability = new MessageChannel();
    const spawn = vi.fn((_spec: SpawnWorkerSpec) => fake.child);
    const reserve = vi.fn<ReserveOwnerChildAdmission>(async () => ({
      ...emptyAdmission(),
      snapshot: {
        capabilityPorts: {
          [SHADOW_ASSET_PORT_CAPABILITY]: capability.port2,
        },
        dispose() {},
      },
    }));
    const run = createOwnerExecSyncRunner(
      'URL',
      NODE_WORKER_RUNTIME_ENV,
      () => REMOTE_FS_ROOT,
      reserve,
      spawn,
    );

    const result = run(
      {
        entryPath: '/packages/nested/child.mjs',
        argv: ['rifty', '/packages/nested/child.mjs', '--exact'],
        env: { USER_VALUE: 'kept' },
        cwd: '/',
      },
      { parentPid: 42 },
    );
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce());
    fake.stdout(new Uint8Array([0x00, 0xff]));
    fake.stdout(new Uint8Array([0x7f]));
    fake.stderr(new Uint8Array([0x80]));
    fake.exit(7);

    await expect(result).resolves.toEqual({
      stdout: new Uint8Array([0x00, 0xff, 0x7f]),
      stderr: new Uint8Array([0x80]),
      exitCode: 7,
    });
    expect(spawn).toHaveBeenCalledWith(
      expect.objectContaining({
        entry: expect.objectContaining({
          bootstrap: expect.objectContaining({
            protocol: NODE_ENTRY_BOOTSTRAP_PROTOCOL,
            payload: expect.objectContaining({
              hostRuntime: expect.objectContaining(NODE_WORKER_RUNTIME_ENV),
              launch: {
                kind: 'program',
                bin: false,
                remoteFs: true,
                remoteFsRoot: REMOTE_FS_ROOT,
                nodeServe: false,
              },
            }),
          }),
        }),
        argv: ['rifty', '/packages/nested/child.mjs', '--exact'],
        env: { USER_VALUE: 'kept' },
        cwd: '/',
      }),
      42,
    );
    expect(reserve).toHaveBeenCalledWith(`${REMOTE_FS_ROOT}/packages/nested/child.mjs`);
    expect(JSON.stringify(spawn.mock.calls[0]?.[0].env)).not.toContain(REMOTE_FS_ROOT);
    const spawnedEntry = spawn.mock.calls[0]?.[0].entry;
    if (spawnedEntry?.kind !== 'url') throw new Error('expected URL entry');
    expect(spawnedEntry.capabilityPorts).toBeDefined();
    expect(spawnedEntry.capabilityPorts?.[SHADOW_ASSET_PORT_CAPABILITY]).toBe(capability.port2);
    capability.port1.close();
    capability.port2.close();
  });

  it('rejects when the owner execSync worker peer dies instead of leaving its caller pending', async () => {
    const port = () => ({
      onmessage: null as ((event: MessageEvent) => void) | null,
      start: vi.fn(),
    });
    const child = Object.assign(new EventEmitter(), {
      kind: 'worker' as const,
      ports: { stdout: port(), stderr: port() },
      kill: vi.fn(),
    });
    vi.spyOn(globalProcessManager, 'spawnWorker').mockReturnValue(
      child as unknown as ReturnType<typeof globalProcessManager.spawnWorker>,
    );
    const run = createOwnerExecSyncRunner(
      'URL',
      NODE_WORKER_RUNTIME_ENV,
      () => REMOTE_FS_ROOT,
      reserveEmptyAdmission,
    );
    const result = run({
      entryPath: '/packages/nested/child.mjs',
      argv: ['rifty', '/packages/nested/child.mjs'],
      env: {},
      cwd: '/',
    });
    await vi.waitFor(() => expect(globalProcessManager.spawnWorker).toHaveBeenCalledOnce());
    const peerFailure = new Error('owner execSync worker peer died');
    let observed:
      | { readonly status: 'pending' }
      | { readonly status: 'resolved' }
      | { readonly status: 'rejected'; readonly reason: unknown } = { status: 'pending' };
    void result.then(
      () => {
        observed = { status: 'resolved' };
      },
      (reason: unknown) => {
        observed = { status: 'rejected', reason };
      },
    );

    child.emit('peererror', peerFailure);
    await vi.waitFor(() => expect(observed).toEqual({ status: 'rejected', reason: peerFailure }), {
      timeout: 100,
    });
  });

  it('fails before owner execSync spawn when the active project is gone', async () => {
    const spawn = vi.fn();
    const run = createOwnerExecSyncRunner(
      'URL',
      NODE_WORKER_RUNTIME_ENV,
      () => {
        throw new Error('Workbench owner execSync requires an active project');
      },
      reserveEmptyAdmission,
      spawn,
    );

    await expect(
      run({
        entryPath: '/stale.mjs',
        argv: ['rifty', '/stale.mjs'],
        env: {},
        cwd: '/',
      }),
    ).rejects.toThrow(/active project/i);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('threads the actor-minted preview scope into the node-entry launch', async () => {
    const fake = fakeHandle();
    const spawn = vi.fn((_spec: SpawnWorkerSpec) => fake.h);
    const exec = createOwnerChildNodeExecutor(
      'URL',
      NODE_WORKER_RUNTIME_ENV,
      reserveEmptyAdmission,
      spawn,
    );
    const p = exec('/w/server.js', [], makeCtx({ env: { USER_FLAG: 'kept' } }), {
      sid: 's1',
      previewScope: 'owner-preview',
      remoteFsRoot: REMOTE_FS_ROOT,
      onListening: () => {},
      onExit: () => {},
    });
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce());
    fake.emit('exit', 0, null);
    expect(await p).toEqual({ code: 0, signal: null });
    expect(spawn).toHaveBeenCalledWith(
      expect.objectContaining({
        env: { USER_FLAG: 'kept' },
        entry: expect.objectContaining({
          bootstrap: expect.objectContaining({
            payload: expect.objectContaining({
              launch: expect.objectContaining({
                previewScope: 'owner-preview',
                remoteFsRoot: REMOTE_FS_ROOT,
              }),
            }),
          }),
        }),
      }),
    );
  });

  it('keeps an empty admitted plan off the spawned entry and releases it on physical exit', async () => {
    const fake = fakeHandle();
    const dispose = vi.fn();
    const commit = vi.fn();
    const reserve = vi.fn<ReserveOwnerChildAdmission>(async () =>
      Object.freeze({
        snapshot: Object.freeze({
          capabilityPorts: Object.freeze({}),
          dispose,
        }),
        commit,
        abortBeforeSpawn: vi.fn(),
        abortAfterChildSettlement: vi.fn(async (_error: unknown, exited: Promise<unknown>) => {
          await exited;
        }),
      }),
    );
    const spawn = vi.fn((_spec: SpawnWorkerSpec) => fake.h);
    const exec = createOwnerChildNodeExecutor('URL', NODE_WORKER_RUNTIME_ENV, reserve, spawn);
    const running = exec('/w/server.js', [], makeCtx(), {
      sid: 'empty-plan',
      remoteFsRoot: REMOTE_FS_ROOT,
      onListening: () => {},
      onExit: () => {},
    });

    await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce());
    expect(reserve).toHaveBeenCalledWith('/w/server.js');
    const entry = spawn.mock.calls[0]![0].entry;
    expect(Object.hasOwn(entry, 'capabilityPorts')).toBe(false);
    expect(commit).toHaveBeenCalledOnce();
    expect(dispose).not.toHaveBeenCalled();

    fake.emit('exit', 0, null);
    await expect(running).resolves.toEqual({ code: 0, signal: null });
    await vi.waitFor(() => expect(dispose).toHaveBeenCalledOnce());
  });

  it('attaches an admitted capability to the URL entry before spawn', async () => {
    const fake = fakeHandle();
    const capability = new MessageChannel();
    const reserve: ReserveOwnerChildAdmission = async () => ({
      snapshot: {
        capabilityPorts: {
          [SHADOW_ASSET_PORT_CAPABILITY]: capability.port2,
        },
        dispose() {},
      },
      commit() {},
      abortBeforeSpawn() {},
      async abortAfterChildSettlement(_error: unknown, exited: Promise<unknown>) {
        await exited;
      },
    });
    const spawn = vi.fn((_spec: SpawnWorkerSpec) => fake.h);
    const exec = createOwnerChildNodeExecutor('URL', NODE_WORKER_RUNTIME_ENV, reserve, spawn);
    const running = exec('/w/server.js', [], makeCtx(), {
      sid: 'capability',
      onListening: () => {},
      onExit: () => {},
    });

    await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce());
    const entry = spawn.mock.calls[0]![0].entry;
    fake.emit('exit', 0, null);
    await expect(running).resolves.toEqual({ code: 0, signal: null });
    capability.port1.close();
    expect(entry.kind).toBe('url');
    if (entry.kind !== 'url') throw new Error('expected URL worker entry');
    expect(entry.capabilityPorts).toBeDefined();
    expect(entry.capabilityPorts?.[SHADOW_ASSET_PORT_CAPABILITY]).toBe(capability.port2);
    capability.port2.close();
  });

  it('aborts admission before spawn when a capability-bearing spawn throws', async () => {
    const capability = new MessageChannel();
    const spawnFailure = new Error('spawn rejected the capability entry');
    const dispose = vi.fn();
    const commit = vi.fn();
    const abortBeforeSpawn = vi.fn();
    const abortAfterChildSettlement = vi.fn(async (_error: unknown, exited: Promise<unknown>) => {
      await exited;
    });
    const reserve: ReserveOwnerChildAdmission = async () => ({
      snapshot: {
        capabilityPorts: {
          [SHADOW_ASSET_PORT_CAPABILITY]: capability.port2,
        },
        dispose,
      },
      commit,
      abortBeforeSpawn,
      abortAfterChildSettlement,
    });
    const exec = createOwnerChildNodeExecutor('URL', NODE_WORKER_RUNTIME_ENV, reserve, () => {
      throw spawnFailure;
    });

    await expect(
      exec('/w/server.js', [], makeCtx(), {
        sid: 'failed-transfer',
        onListening: () => {},
        onExit: () => {},
      }),
    ).rejects.toBe(spawnFailure);

    expect(dispose).toHaveBeenCalledOnce();
    expect(abortBeforeSpawn).toHaveBeenCalledWith(spawnFailure);
    expect(abortAfterChildSettlement).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();

    capability.port1.close();
    capability.port2.close();
  });

  it('streams stdout, reports listening, resolves on exit + removes', async () => {
    const fake = fakeHandle();
    const onListening = vi.fn();
    const onExit = vi.fn();
    const spawn = vi.fn(() => fake.h);
    const exec = createOwnerChildNodeExecutor(
      'URL',
      NODE_WORKER_RUNTIME_ENV,
      reserveEmptyAdmission,
      spawn,
    );
    const stdout: string[] = [];
    const ctx = makeCtx({ stdout: { write: (s: string) => stdout.push(s) } });
    const p = exec('/w/server.js', [], ctx, { sid: 's1', onListening, onExit });
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce());
    fake.out(new TextEncoder().encode('hi\n'));
    fake.emit('control:listening', { ports: [3000] });
    fake.emit('exit', 0, null);
    expect(await p).toEqual({ code: 0, signal: null });
    expect(stdout.join('')).toBe('hi\n');
    expect(onListening).toHaveBeenCalledWith('s1', [3000], undefined);
    expect(onExit).toHaveBeenCalledWith('s1');
  });

  it('threads the child preview scope with listened ports', async () => {
    const fake = fakeHandle();
    const onListening = vi.fn();
    const spawn = vi.fn(() => fake.h);
    const exec = createOwnerChildNodeExecutor(
      'URL',
      NODE_WORKER_RUNTIME_ENV,
      reserveEmptyAdmission,
      spawn,
    );
    const p = exec('/w/server.js', [], makeCtx(), {
      sid: 's1',
      onListening,
      onExit: () => {},
    });
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce());
    fake.emit('control:listening', {
      ports: [3000],
      previewScope: 'node-run-scope',
    });
    fake.emit('exit', 0, null);
    expect(await p).toEqual({ code: 0, signal: null });
    expect(onListening).toHaveBeenCalledWith('s1', [3000], 'node-run-scope');
  });

  it('Ctrl-C kills the child and mutes trailing output', async () => {
    const fake = fakeHandle();
    const ac = new AbortController();
    const spawn = vi.fn(() => fake.h);
    const exec = createOwnerChildNodeExecutor(
      'URL',
      NODE_WORKER_RUNTIME_ENV,
      reserveEmptyAdmission,
      spawn,
    );
    const stdout: string[] = [];
    const ctx = makeCtx({ stdout: { write: (s: string) => stdout.push(s) }, signal: ac.signal });
    const p = exec('/w/server.js', [], ctx, { sid: 's1', onListening: () => {}, onExit: () => {} });
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce());
    ac.abort();
    expect(fake.h.kill).toHaveBeenCalledWith('SIGTERM');
    fake.out(new TextEncoder().encode('late\n'));
    fake.emit('exit', null, 'SIGTERM');
    expect(await p).toEqual({ code: null, signal: 'SIGTERM' });
    expect(stdout.join('')).toBe('');
  });

  it('a pre-aborted signal still resolves + removes (exit listener registered before abort)', async () => {
    const fake = fakeHandle();
    const onExit = vi.fn();
    const ac = new AbortController();
    ac.abort();
    const spawn = vi.fn(() => fake.h);
    const exec = createOwnerChildNodeExecutor(
      'URL',
      NODE_WORKER_RUNTIME_ENV,
      reserveEmptyAdmission,
      spawn,
    );
    const ctx = makeCtx({ signal: ac.signal });
    // kill() fires synchronously on the already-aborted signal; without the
    // listener-before-abort ordering the 'exit' would be lost and this hangs.
    const exit = await exec('/w/server.js', [], ctx, {
      sid: 's1',
      onListening: () => {},
      onExit,
    });
    expect(fake.h.kill).toHaveBeenCalledWith('SIGTERM');
    expect(exit).toEqual({ code: null, signal: 'SIGTERM' });
    expect(onExit).toHaveBeenCalledWith('s1');
  });
});
