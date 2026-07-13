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
  it('builds a serve:true spec with RIFTY_BIN=0', () => {
    const spec = buildNodeChildSpawnSpec(
      '/w/app.js',
      ['a'],
      { PATH: '/x', RIFTY_SQLITE_WASM_URL: 'user-poison' },
      '/w',
      'URL',
      NODE_WORKER_RUNTIME_ENV,
      true,
      120,
      40,
    );
    expect(spec).toMatchObject({
      entry: { kind: 'url', url: 'URL' },
      argv: ['rifty', '/w/app.js', 'a'],
      env: {
        PATH: '/x',
        RIFTY_SQLITE_WASM_URL: 'blob:sqlite-wasm',
        RIFTY_BIN: '0',
        RIFTY_REMOTE_FS: '1',
        RIFTY_NODE_SERVE: '1',
        RIFTY_STDIN_IS_TTY: '0',
        RIFTY_STDOUT_IS_TTY: '1',
        RIFTY_STDERR_IS_TTY: '1',
        RIFTY_TTY_COLS: '120',
        RIFTY_TTY_ROWS: '40',
      },
      cwd: '/w',
      serve: true,
    });
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
