import { Shell } from '@riftydev/shell';
import { resetSyncMirror } from '@riftydev/vfs/internal';
import { beforeEach, describe, expect, it } from 'vitest';
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
});
