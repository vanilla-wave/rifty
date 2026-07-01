import { Shell } from '@riftydev/shell';
import { resetSyncMirror } from '@riftydev/vfs/internal';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OwnerToPageFrame } from '../glue/pty-protocol.ts';
import { createPtyServer } from './pty-server.ts';

function harness() {
  const out: OwnerToPageFrame[] = [];
  const server = createPtyServer({
    send: (f) => out.push(f),
    makeShell: () => new Shell({ cwd: '/', env: {} }),
  });
  return { server, out };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('pty-server', () => {
  beforeEach(() => {
    resetSyncMirror(); // fresh in-memory owner store per test
  });

  it('open → ready', () => {
    const { server, out } = harness();
    server.handleFrame({ type: 'pty:open', sid: 's1' });
    expect(out.some((f) => f.type === 'pty:ready' && f.sid === 's1')).toBe(true);
  });

  it('exec echo streams chunk(s) BEFORE exit (no reorder)', async () => {
    const { server, out } = harness();
    server.handleFrame({ type: 'pty:open', sid: 's1' });
    await server.handleFrame({
      type: 'pty:exec',
      sid: 's1',
      rid: 'r1',
      line: 'echo hi',
      cols: 80,
      rows: 24,
      isTTY: true,
    });
    const types = out.map((f) => f.type);
    const firstExit = types.indexOf('pty:exit');
    const lastChunk = types.lastIndexOf('pty:chunk');
    expect(firstExit).toBeGreaterThan(-1);
    expect(lastChunk).toBeLessThan(firstExit); // every chunk precedes exit
    const exit = out.find((f) => f.type === 'pty:exit');
    expect(exit && exit.type === 'pty:exit' && exit.code).toBe(0);
  });

  it('pty:exit carries cwd mutated by cd', async () => {
    const { server, out } = harness();
    server.handleFrame({ type: 'pty:open', sid: 's1' });
    await server.handleFrame({
      type: 'pty:exec',
      sid: 's1',
      rid: 'r1',
      line: 'mkdir -p /work && cd /work',
      cols: 80,
      rows: 24,
      isTTY: true,
    });
    const exit = out.find((f) => f.type === 'pty:exit' && f.rid === 'r1');
    expect(exit && exit.type === 'pty:exit' && exit.cwd).toBe('/work');
  });

  it('SIGINT aborts the run → exit 130', async () => {
    const { server, out } = harness();
    server.handleFrame({ type: 'pty:open', sid: 's1' });
    const run = server.handleFrame({
      type: 'pty:exec',
      sid: 's1',
      rid: 'r1',
      line: 'sleep 5',
      cols: 80,
      rows: 24,
      isTTY: true,
    });
    server.handleFrame({ type: 'pty:signal', sid: 's1', rid: 'r1', signal: 'SIGINT' });
    await run;
    const exit = out.find((f) => f.type === 'pty:exit' && f.rid === 'r1');
    expect(exit && exit.type === 'pty:exit' && exit.code).toBe(130);
  });

  it('pty:exit carries env mutated by an inline assignment run', async () => {
    const { server, out } = harness();
    server.handleFrame({ type: 'pty:open', sid: 's1' });
    await server.handleFrame({
      type: 'pty:exec',
      sid: 's1',
      rid: 'r1',
      line: 'FOO=bar',
      cols: 80,
      rows: 24,
      isTTY: true,
    });
    const exit = out.find((f) => f.type === 'pty:exit' && f.rid === 'r1');
    expect(exit && exit.type === 'pty:exit' && exit.env.FOO).toBe('bar');
  });

  it('pty:open seed makes the session shell start at the restored cwd/env (reload restore)', async () => {
    const out: OwnerToPageFrame[] = [];
    const server = createPtyServer({
      send: (f) => out.push(f),
      makeShell: (seed) => new Shell({ cwd: seed?.cwd ?? '/', env: seed?.env ?? {} }),
    });
    server.handleFrame({ type: 'pty:open', sid: 's1', cwd: '/work', env: { FOO: 'bar' } });
    await server.handleFrame({
      type: 'pty:exec',
      sid: 's1',
      rid: 'r1',
      line: 'echo seeded',
      cols: 80,
      rows: 24,
      isTTY: true,
    });
    const exit = out.find((f) => f.type === 'pty:exit' && f.rid === 'r1');
    expect(exit && exit.type === 'pty:exit' && exit.cwd).toBe('/work');
    expect(exit && exit.type === 'pty:exit' && exit.env.FOO).toBe('bar');
  });

  it('passes the pty session id to the shell factory', () => {
    const seen: string[] = [];
    const server = createPtyServer({
      send: () => {},
      makeShell: (_seed, sid) => {
        seen.push(sid);
        return new Shell({ cwd: '/', env: {} });
      },
    });
    server.handleFrame({ type: 'pty:open', sid: 'terminal-9' });
    expect(seen).toEqual(['terminal-9']);
  });

  it('strips internal pty env keys from persisted exit env', async () => {
    const out: OwnerToPageFrame[] = [];
    const server = createPtyServer({
      send: (f) => out.push(f),
      makeShell: () => new Shell({ cwd: '/', env: { RIFTY_INTERNAL_PTY_SID: 'terminal-1' } }),
    });
    server.handleFrame({ type: 'pty:open', sid: 'terminal-1' });
    await server.handleFrame({
      type: 'pty:exec',
      sid: 'terminal-1',
      rid: 'r1',
      line: 'echo hi',
      cols: 80,
      rows: 24,
      isTTY: true,
    });
    const exit = out.find((f) => f.type === 'pty:exit' && f.rid === 'r1');
    expect(exit && exit.type === 'pty:exit' && exit.env.RIFTY_INTERNAL_PTY_SID).toBeUndefined();
  });

  it('exec on an unknown session emits pty:exit{error} instead of silently hanging the page run', async () => {
    const { server, out } = harness();
    // No pty:open for this sid (protocol-order violation / owner restarted).
    await server.handleFrame({
      type: 'pty:exec',
      sid: 's-missing',
      rid: 'r1',
      line: 'echo hi',
      cols: 80,
      rows: 24,
      isTTY: true,
    });
    const exit = out.find((f) => f.type === 'pty:exit' && f.rid === 'r1');
    expect(exit && exit.type === 'pty:exit').toBeTruthy();
    expect(exit && exit.type === 'pty:exit' && exit.code).not.toBe(0);
    expect(exit && exit.type === 'pty:exit' && exit.error).toBeTruthy();
  });

  it('routes pty:dev-server-req to onDevServerReq (ADR-0148)', () => {
    let reqs = 0;
    const server = createPtyServer({
      send: () => {},
      makeShell: () => new Shell({ cwd: '/', env: {} }),
      onDevServerReq: () => {
        reqs++;
      },
    });
    server.handleFrame({ type: 'pty:dev-server-req' });
    expect(reqs).toBe(1);
  });

  it('forwards pty:preview-req to onPreviewReq', () => {
    const onPreviewReq = vi.fn();
    const server = createPtyServer({
      send: () => {},
      makeShell: () => new Shell({ cwd: '/', env: {} }),
      onPreviewReq,
    });
    server.handleFrame({ type: 'pty:preview-req' });
    expect(onPreviewReq).toHaveBeenCalledOnce();
  });

  it('routes pty:dev-config to onDevConfig (ADR-0148 owner-resident dev server preset switch)', () => {
    const configs: unknown[] = [];
    const server = createPtyServer({
      send: () => {},
      makeShell: () => new Shell({ cwd: '/', env: {} }),
      onDevConfig: (c) => {
        configs.push(c);
      },
    });
    server.handleFrame({
      type: 'pty:dev-config',
      id: 'dc1',
      templateId: 'express-sqlite',
      slug: 'fullstack',
      setup: 'from-scratch',
    });
    expect(configs).toEqual([
      { templateId: 'express-sqlite', slug: 'fullstack', setup: 'from-scratch' },
    ]);
  });

  it('acks pty:dev-config only after async dependency preparation settles', async () => {
    const ready = deferred();
    const out: OwnerToPageFrame[] = [];
    const server = createPtyServer({
      send: (f) => out.push(f),
      makeShell: () => new Shell({ cwd: '/', env: {} }),
      onDevConfig: () => ready.promise,
    });
    const run = server.handleFrame({
      type: 'pty:dev-config',
      id: 'dc1',
      templateId: 'typescript',
      slug: 'scratch',
      setup: 'instant',
    });
    expect(out).toEqual([]);
    ready.resolve();
    await run;
    expect(out).toEqual([{ type: 'pty:dev-config-ready', id: 'dc1' }]);
  });
});
