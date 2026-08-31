import { EventEmitter } from 'node:events';
import type { SpawnWorkerSpec } from '@riftydev/kernel';
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
const RUNTIME_BINDINGS = [
  {
    adapterId: 'rifty.runtime-adapter.esbuild.v1',
    packagePath: `${REMOTE_FS_ROOT}/node_modules/esbuild-wasm`,
  },
] as const;
const PUBLIC_RUNTIME_BINDINGS = [
  {
    adapterId: 'rifty.runtime-adapter.esbuild.v1',
    packagePath: '/node_modules/esbuild-wasm',
  },
] as const;

function emptyAdmission(): OwnerChildAdmissionReservation {
  return Object.freeze({
    snapshot: Object.freeze({
      runtimeBindings: Object.freeze([]),
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

/**
 * `drainsBeforeExit` models the kernel path where the child still has admitted
 * output when the signal lands: `kill()` starts the terminal cut and `'exit'`
 * follows only once those bytes are delivered. The default mirrors the other
 * case — nothing in flight, so the exit is synchronous.
 */
function fakeHandle({ drainsBeforeExit = false } = {}) {
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
      if (drainsBeforeExit) return true;
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
  const dataListeners: Record<'stdout' | 'stderr', ((chunk: unknown) => void)[]> = {
    stdout: [],
    stderr: [],
  };
  const readable = (stream: 'stdout' | 'stderr') => ({
    on(event: 'data', listener: (chunk: unknown) => void) {
      if (event === 'data') dataListeners[stream].push(listener);
    },
  });
  const listeners: Partial<Record<'exit' | 'peererror', (...args: unknown[]) => void>> = {};
  return {
    child: {
      stdout: readable('stdout'),
      stderr: readable('stderr'),
      on(event: 'exit' | 'peererror', listener: (...args: unknown[]) => void) {
        listeners[event] = listener;
      },
      off(event: 'exit' | 'peererror', listener: (...args: unknown[]) => void) {
        if (listeners[event] === listener) delete listeners[event];
      },
      terminate: vi.fn(),
    },
    stdout: (data: Uint8Array) => {
      for (const listener of dataListeners.stdout) listener(data);
    },
    stderr: (data: Uint8Array) => {
      for (const listener of dataListeners.stderr) listener(data);
    },
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
    const spawn = vi.fn((_spec: SpawnWorkerSpec) => fake.child);
    const reserve = vi.fn<ReserveOwnerChildAdmission>(async () => ({
      ...emptyAdmission(),
      snapshot: {
        runtimeBindings: RUNTIME_BINDINGS,
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
                runtimeBindings: PUBLIC_RUNTIME_BINDINGS,
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
    const spawned = spawn.mock.calls[0]?.[0];
    expect(
      JSON.stringify({ argv: spawned?.argv, env: spawned?.env, cwd: spawned?.cwd }),
    ).not.toContain(REMOTE_FS_ROOT);
  });

  it('rejects when the owner execSync worker peer dies instead of leaving its caller pending', async () => {
    const readable = () => ({ on: vi.fn() });
    const child = Object.assign(new EventEmitter(), {
      kind: 'worker' as const,
      stdout: readable(),
      stderr: readable(),
      terminate: vi.fn(),
    });
    const spawn = vi.fn(() => child);
    const run = createOwnerExecSyncRunner(
      'URL',
      NODE_WORKER_RUNTIME_ENV,
      () => REMOTE_FS_ROOT,
      reserveEmptyAdmission,
      spawn,
    );
    const result = run({
      entryPath: '/packages/nested/child.mjs',
      argv: ['rifty', '/packages/nested/child.mjs'],
      env: {},
      cwd: '/',
    });
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce());
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

  it('aborts execSync admission before spawn when the reserved spawn throws', async () => {
    const spawnFailure = new Error('execSync spawn failed after package reservation');
    const commit = vi.fn();
    const abortBeforeSpawn = vi.fn();
    const abortAfterChildSettlement = vi.fn();
    const reserve = vi.fn<ReserveOwnerChildAdmission>(async () => ({
      snapshot: { runtimeBindings: RUNTIME_BINDINGS },
      commit,
      abortBeforeSpawn,
      abortAfterChildSettlement,
    }));
    const run = createOwnerExecSyncRunner(
      'URL',
      NODE_WORKER_RUNTIME_ENV,
      () => REMOTE_FS_ROOT,
      reserve,
      () => {
        throw spawnFailure;
      },
    );

    await expect(
      run(
        {
          entryPath: '/packages/nested/child.mjs',
          argv: ['rifty', '/packages/nested/child.mjs'],
          env: {},
          cwd: '/',
        },
        { parentPid: 42 },
      ),
    ).rejects.toBe(spawnFailure);

    expect(reserve).toHaveBeenCalledWith(`${REMOTE_FS_ROOT}/packages/nested/child.mjs`);
    expect(abortBeforeSpawn).toHaveBeenCalledWith(spawnFailure);
    expect(commit).not.toHaveBeenCalled();
    expect(abortAfterChildSettlement).not.toHaveBeenCalled();
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

  it('carries an empty admitted binding set and commits the reservation after spawn', async () => {
    const fake = fakeHandle();
    const commit = vi.fn();
    const reserve = vi.fn<ReserveOwnerChildAdmission>(async () =>
      Object.freeze({
        snapshot: Object.freeze({
          runtimeBindings: Object.freeze([]),
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
    expect(entry).toMatchObject({
      bootstrap: { payload: { launch: { runtimeBindings: [] } } },
    });
    expect(commit).toHaveBeenCalledOnce();

    fake.emit('exit', 0, null);
    await expect(running).resolves.toEqual({ code: 0, signal: null });
  });

  it('carries admitted runtime bindings in the URL entry before spawn', async () => {
    const fake = fakeHandle();
    const reserve: ReserveOwnerChildAdmission = async () => ({
      snapshot: {
        runtimeBindings: RUNTIME_BINDINGS,
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
      remoteFsRoot: REMOTE_FS_ROOT,
      onListening: () => {},
      onExit: () => {},
    });

    await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce());
    const entry = spawn.mock.calls[0]![0].entry;
    fake.emit('exit', 0, null);
    await expect(running).resolves.toEqual({ code: 0, signal: null });
    expect(entry).toMatchObject({
      bootstrap: { payload: { launch: { runtimeBindings: PUBLIC_RUNTIME_BINDINGS } } },
    });
  });

  it('aborts admission before spawn when a binding-bearing spawn throws', async () => {
    const spawnFailure = new Error('spawn rejected the binding entry');
    const commit = vi.fn();
    const abortBeforeSpawn = vi.fn();
    const abortAfterChildSettlement = vi.fn(async (_error: unknown, exited: Promise<unknown>) => {
      await exited;
    });
    const reserve: ReserveOwnerChildAdmission = async () => ({
      snapshot: {
        runtimeBindings: RUNTIME_BINDINGS,
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

    expect(abortBeforeSpawn).toHaveBeenCalledWith(spawnFailure);
    expect(abortAfterChildSettlement).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
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
    fake.emit('control:listening', { pid: 41, ports: [3000] });
    fake.emit('exit', 0, null);
    expect(await p).toEqual({ code: 0, signal: null });
    expect(stdout.join('')).toBe('hi\n');
    expect(onListening).toHaveBeenCalledWith('s1', 41, [3000], undefined);
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
      pid: 41,
      ports: [3000],
      previewScope: 'node-run-scope',
    });
    fake.emit('exit', 0, null);
    expect(await p).toEqual({ code: 0, signal: null });
    expect(onListening).toHaveBeenCalledWith('s1', 41, [3000], 'node-run-scope');
  });

  it('Ctrl-C kills the child and still shows what the kernel drained before exit', async () => {
    // The kernel holds `'exit'` until every byte admitted before the terminal
    // cut has been delivered (ADR-0332), so output arriving between the kill
    // and the exit is the child's real final say — a crash stack or shutdown
    // log, exactly when the developer needs it most. Muting at kill time threw
    // that away; the run is over at `'exit'`, and that is where output stops.
    const fake = fakeHandle({ drainsBeforeExit: true });
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
    fake.out(new TextEncoder().encode('shutting down\n'));
    fake.emit('exit', null, 'SIGTERM');
    expect(await p).toEqual({ code: null, signal: 'SIGTERM' });
    expect(stdout.join('')).toBe('shutting down\n');
  });

  it('drops output that arrives after the run has settled', async () => {
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
    fake.emit('exit', null, 'SIGTERM');
    expect(await p).toEqual({ code: null, signal: 'SIGTERM' });

    fake.out(new TextEncoder().encode('after the run\n'));

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
