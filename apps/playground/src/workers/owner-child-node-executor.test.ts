import { NODE_ENTRY_BOOTSTRAP_PROTOCOL } from '@riftydev/runtime-js/builtins/node-entry-url';
import type { CommandContext } from '@riftydev/shell';
import { describe, expect, it, vi } from 'vitest';
import {
  type NodeChildHandle,
  buildNodeChildSpawnSpec,
  createOwnerChildNodeExecutor,
} from './owner-child-node-executor.ts';

const NODE_WORKER_RUNTIME_ENV = {
  RIFTY_KERNEL_WORKER_URL: 'blob:kernel-url',
  RIFTY_NODE_ENTRY_WORKER_URL: 'blob:node-entry-url',
  RIFTY_SQLITE_WASM_URL: 'blob:sqlite-wasm',
  RIFTY_ESBUILD_WASM_URL: 'blob:esbuild-wasm',
};

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

  it('threads the actor-minted preview scope into the node-entry launch', async () => {
    const fake = fakeHandle();
    const spawn = vi.fn(() => fake.h);
    const exec = createOwnerChildNodeExecutor('URL', NODE_WORKER_RUNTIME_ENV, spawn);
    const p = exec('/w/server.js', [], makeCtx({ env: { USER_FLAG: 'kept' } }), {
      sid: 's1',
      previewScope: 'owner-preview',
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
              launch: expect.objectContaining({ previewScope: 'owner-preview' }),
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
