import { describe, expect, it, vi } from 'vitest';
import { type NodeChildHandle, buildNodeChildSpawnSpec, createOwnerChildNodeExecutor } from './owner-child-node-executor.ts';

function fakeHandle() {
  const listeners: Record<string, ((arg?: unknown) => void)[]> = {};
  const dataCbs: Record<'stdout' | 'stderr', ((c: unknown) => void)[]> = { stdout: [], stderr: [] };
  const h = {
    kind: 'worker',
    stdout: () => ({ on: (_: 'data', cb: (c: unknown) => void) => dataCbs.stdout.push(cb) }),
    stderr: () => ({ on: (_: 'data', cb: (c: unknown) => void) => dataCbs.stderr.push(cb) }),
    on: (ev: string, cb: (arg?: unknown) => void) => {
      (listeners[ev] ??= []).push(cb);
    },
    send: vi.fn(),
    kill: vi.fn(() => true),
  } as unknown as NodeChildHandle;
  return {
    h,
    emit: (ev: string, arg?: unknown) => (listeners[ev] ?? []).forEach((cb) => cb(arg)),
    out: (c: unknown) => dataCbs.stdout.forEach((cb) => cb(c)),
  };
}

function makeCtx(over: Record<string, unknown> = {}) {
  return { cwd: '/w', env: {}, stdout: { write: vi.fn() }, stderr: { write: vi.fn() }, signal: undefined, ...over } as any;
}

describe('owner-child-node-executor', () => {
  it('builds a serve:true spec with RIFTY_BIN=0', () => {
    const spec = buildNodeChildSpawnSpec('/w/app.js', ['a'], { PATH: '/x' }, '/w', 'URL');
    expect(spec).toMatchObject({
      entry: { kind: 'url', url: 'URL' },
      argv: ['rifty', '/w/app.js', 'a'],
      env: { PATH: '/x', RIFTY_BIN: '0', RIFTY_REMOTE_FS: '1', RIFTY_NODE_SERVE: '1' },
      cwd: '/w',
      serve: true,
    });
  });

  it('streams stdout, reports listening, resolves on exit + removes', async () => {
    const fake = fakeHandle();
    const onListening = vi.fn();
    const onExit = vi.fn();
    const exec = createOwnerChildNodeExecutor('URL', () => fake.h);
    const stdout: string[] = [];
    const ctx = makeCtx({ stdout: { write: (s: string) => stdout.push(s) } });
    const p = exec('/w/server.js', [], ctx, { sid: 's1', onListening, onExit });
    fake.out(new TextEncoder().encode('hi\n'));
    fake.emit('message', { type: 'rifty:node-listening', ports: [3000] });
    fake.emit('exit', 0);
    expect(await p).toBe(0);
    expect(stdout.join('')).toBe('hi\n');
    expect(onListening).toHaveBeenCalledWith('s1', [3000]);
    expect(onExit).toHaveBeenCalledWith('s1');
  });

  it('Ctrl-C kills the child and mutes trailing output', async () => {
    const fake = fakeHandle();
    const ac = new AbortController();
    const exec = createOwnerChildNodeExecutor('URL', () => fake.h);
    const stdout: string[] = [];
    const ctx = makeCtx({ stdout: { write: (s: string) => stdout.push(s) }, signal: ac.signal });
    const p = exec('/w/server.js', [], ctx, { sid: 's1', onListening: () => {}, onExit: () => {} });
    ac.abort();
    expect(fake.h.kill).toHaveBeenCalledWith('SIGTERM');
    fake.out(new TextEncoder().encode('late\n'));
    fake.emit('exit', 130);
    expect(await p).toBe(130);
    expect(stdout.join('')).toBe('');
  });
});
