import { NODE_ENTRY_BOOTSTRAP_PROTOCOL } from '@riftydev/runtime-js/builtins/node-entry-url';
import type { CommandContext } from '@riftydev/shell';
import { describe, expect, it, vi } from 'vitest';
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
  RIFTY_ESBUILD_WASM_URL: 'blob:esbuild-wasm',
};
const REMOTE_FS_ROOT = '/.rifty/workbench/v1/projects/project-a/tree';

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
  let exit: ((code: number) => void) | null = null;
  return {
    child: {
      ports: { stdout, stderr },
      onExit(listener: (code: number) => void) {
        exit = listener;
        return () => {
          if (exit === listener) exit = null;
        };
      },
    },
    stdout: (data: Uint8Array) => stdout.onmessage?.({ data } as MessageEvent),
    stderr: (data: Uint8Array) => stderr.onmessage?.({ data } as MessageEvent),
    exit: (code: number) => exit?.(code),
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
    const spawn = vi.fn(() => fake.child);
    const run = createOwnerExecSyncRunner(
      'URL',
      NODE_WORKER_RUNTIME_ENV,
      () => REMOTE_FS_ROOT,
      spawn,
    );

    const result = run({
      entryPath: '/child.mjs',
      argv: ['rifty', '/child.mjs', '--exact'],
      env: { USER_VALUE: 'kept' },
      cwd: '/',
    });
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
              hostRuntime: NODE_WORKER_RUNTIME_ENV,
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
        argv: ['rifty', '/child.mjs', '--exact'],
        env: { USER_VALUE: 'kept' },
        cwd: '/',
      }),
      expect.objectContaining({ ppid: 1 }),
    );
    expect(JSON.stringify(spawn.mock.calls[0]?.[0].env)).not.toContain(REMOTE_FS_ROOT);
  });

  it('fails before owner execSync spawn when the active project is gone', () => {
    const spawn = vi.fn();
    const run = createOwnerExecSyncRunner(
      'URL',
      NODE_WORKER_RUNTIME_ENV,
      () => {
        throw new Error('Workbench owner execSync requires an active project');
      },
      spawn,
    );

    expect(() =>
      run({
        entryPath: '/stale.mjs',
        argv: ['rifty', '/stale.mjs'],
        env: {},
        cwd: '/',
      }),
    ).toThrow(/active project/i);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('threads the actor-minted preview scope into the node-entry launch', async () => {
    const fake = fakeHandle();
    const spawn = vi.fn(() => fake.h);
    const exec = createOwnerChildNodeExecutor('URL', NODE_WORKER_RUNTIME_ENV, spawn);
    const p = exec('/w/server.js', [], makeCtx({ env: { USER_FLAG: 'kept' } }), {
      sid: 's1',
      previewScope: 'owner-preview',
      remoteFsRoot: REMOTE_FS_ROOT,
      onListening: () => {},
      onExit: () => {},
    });
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

  it('streams stdout, reports listening, resolves on exit + removes', async () => {
    const fake = fakeHandle();
    const onListening = vi.fn();
    const onExit = vi.fn();
    const exec = createOwnerChildNodeExecutor('URL', NODE_WORKER_RUNTIME_ENV, () => fake.h);
    const stdout: string[] = [];
    const ctx = makeCtx({ stdout: { write: (s: string) => stdout.push(s) } });
    const p = exec('/w/server.js', [], ctx, { sid: 's1', onListening, onExit });
    fake.out(new TextEncoder().encode('hi\n'));
    fake.emit('message', { type: 'rifty:node-listening', ports: [3000] });
    fake.emit('exit', 0, null);
    expect(await p).toEqual({ code: 0, signal: null });
    expect(stdout.join('')).toBe('hi\n');
    expect(onListening).toHaveBeenCalledWith('s1', [3000], undefined);
    expect(onExit).toHaveBeenCalledWith('s1');
  });

  it('threads the child preview scope with listened ports', async () => {
    const fake = fakeHandle();
    const onListening = vi.fn();
    const exec = createOwnerChildNodeExecutor('URL', NODE_WORKER_RUNTIME_ENV, () => fake.h);
    const p = exec('/w/server.js', [], makeCtx(), {
      sid: 's1',
      onListening,
      onExit: () => {},
    });
    fake.emit('message', {
      type: 'rifty:node-listening',
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
    const exec = createOwnerChildNodeExecutor('URL', NODE_WORKER_RUNTIME_ENV, () => fake.h);
    const stdout: string[] = [];
    const ctx = makeCtx({ stdout: { write: (s: string) => stdout.push(s) }, signal: ac.signal });
    const p = exec('/w/server.js', [], ctx, { sid: 's1', onListening: () => {}, onExit: () => {} });
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
    const exec = createOwnerChildNodeExecutor('URL', NODE_WORKER_RUNTIME_ENV, () => fake.h);
    const ctx = makeCtx({ signal: ac.signal });
    // kill() fires synchronously on the already-aborted signal; without the
    // listener-before-abort ordering the 'exit' would be lost and this hangs.
    const exit = await exec('/w/server.js', [], ctx, { sid: 's1', onListening: () => {}, onExit });
    expect(fake.h.kill).toHaveBeenCalledWith('SIGTERM');
    expect(exit).toEqual({ code: null, signal: 'SIGTERM' });
    expect(onExit).toHaveBeenCalledWith('s1');
  });
});
