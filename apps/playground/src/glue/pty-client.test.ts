import { describe, expect, it } from 'vitest';
import { createPtyClient } from './pty-client.ts';
import type { PageToOwnerFrame } from './pty-protocol.ts';

function harness() {
  const sent: PageToOwnerFrame[] = [];
  const client = createPtyClient({ send: (f) => sent.push(f) });
  return { client, sent };
}

describe('pty-client', () => {
  it('open posts pty:open and resolves on ready', async () => {
    const { client, sent } = harness();
    const ready = client.openSession('s1');
    expect(sent[0]).toEqual({ type: 'pty:open', sid: 's1' });
    client.onFrame({ type: 'pty:ready', sid: 's1' });
    await expect(ready).resolves.toBeUndefined();
  });

  it('exec streams chunks to onChunk then resolves exitCode', async () => {
    const { client, sent } = harness();
    const chunks: string[] = [];
    const p = client.exec('s1', 'echo hi', {
      cols: 80,
      rows: 24,
      isTTY: true,
      onChunk: (c) => chunks.push(c),
    });
    const exec = sent.find((f) => f.type === 'pty:exec');
    expect(exec && exec.type === 'pty:exec').toBeTruthy();
    const rid = (exec as Extract<PageToOwnerFrame, { type: 'pty:exec' }>).rid;
    client.onFrame({
      type: 'pty:chunk',
      sid: 's1',
      rid,
      stream: 'stdout',
      seq: 0,
      data: new TextEncoder().encode('hi\n'),
    });
    client.onFrame({ type: 'pty:exit', sid: 's1', rid, code: 0, cwd: '/x', env: { A: '1' } });
    await expect(p).resolves.toBe(0);
    expect(chunks.join('')).toBe('hi\n');
    expect(client.snapshot('s1')).toMatchObject({ cwd: '/x', env: { A: '1' } });
  });

  it('routes chunk to the matching run only (rid correlation)', async () => {
    const { client, sent } = harness();
    const aChunks: string[] = [];
    const bChunks: string[] = [];
    const a = client.exec('s1', 'cmd-a', {
      cols: 80,
      rows: 24,
      isTTY: true,
      onChunk: (c) => aChunks.push(c),
    });
    const b = client.exec('s1', 'cmd-b', {
      cols: 80,
      rows: 24,
      isTTY: true,
      onChunk: (c) => bChunks.push(c),
    });
    const execs = sent.filter(
      (f): f is Extract<PageToOwnerFrame, { type: 'pty:exec' }> => f.type === 'pty:exec',
    );
    const ridA = execs[0]!.rid;
    const ridB = execs[1]!.rid;
    expect(ridA).not.toBe(ridB);
    client.onFrame({
      type: 'pty:chunk',
      sid: 's1',
      rid: ridB,
      stream: 'stdout',
      seq: 0,
      data: new TextEncoder().encode('B'),
    });
    client.onFrame({
      type: 'pty:chunk',
      sid: 's1',
      rid: ridA,
      stream: 'stdout',
      seq: 0,
      data: new TextEncoder().encode('A'),
    });
    client.onFrame({ type: 'pty:exit', sid: 's1', rid: ridA, code: 0, cwd: '/', env: {} });
    client.onFrame({ type: 'pty:exit', sid: 's1', rid: ridB, code: 0, cwd: '/', env: {} });
    await Promise.all([a, b]);
    expect(aChunks.join('')).toBe('A');
    expect(bChunks.join('')).toBe('B');
  });

  it('caches cwd/env from pty:exit (snapshot reflects last exit)', async () => {
    const { client, sent } = harness();
    const p = client.exec('s1', 'cd /work', { cols: 80, rows: 24, isTTY: true, onChunk: () => {} });
    const rid = (
      sent.find((f) => f.type === 'pty:exec') as Extract<PageToOwnerFrame, { type: 'pty:exec' }>
    ).rid;
    client.onFrame({
      type: 'pty:exit',
      sid: 's1',
      rid,
      code: 0,
      cwd: '/work',
      env: { PATH: '/bin' },
    });
    await p;
    expect(client.snapshot('s1')).toEqual({ cwd: '/work', env: { PATH: '/bin' } });
  });

  it('openSession seed caches cwd/env immediately + carries them on pty:open (reload restore)', () => {
    const { client, sent } = harness();
    void client.openSession('s1', { cwd: '/restored', env: { TERM: 'xterm' } });
    expect(sent[0]).toEqual({
      type: 'pty:open',
      sid: 's1',
      cwd: '/restored',
      env: { TERM: 'xterm' },
    });
    // snapshot reflects the seed BEFORE any command runs (no pty:exit yet)
    expect(client.snapshot('s1')).toEqual({ cwd: '/restored', env: { TERM: 'xterm' } });
  });

  it('synthetic disconnect resolves a hung exec so onInput never hangs', async () => {
    const { client } = harness();
    const p = client.exec('s1', 'sleep 9', { cols: 80, rows: 24, isTTY: true, onChunk: () => {} });
    client.disconnect(); // owner died
    await expect(p).resolves.toBeGreaterThan(0); // nonzero exit, not a hang
  });

  it('routes pty:dev-server to onDevServer (ADR-0148)', () => {
    const seen: unknown[] = [];
    const client = createPtyClient({ send: () => {}, onDevServer: (f) => seen.push(f) });
    client.onFrame({
      type: 'pty:dev-server',
      status: 'running',
      port: 5174,
      url: '/preview/5174/',
    });
    expect(seen).toEqual([
      { type: 'pty:dev-server', status: 'running', port: 5174, url: '/preview/5174/' },
    ]);
  });

  it('requestDevServer sends a pty:dev-server-req (P3 handshake)', () => {
    const { client, sent } = harness();
    client.requestDevServer();
    expect(sent).toEqual([{ type: 'pty:dev-server-req' }]);
  });

  it('setDevConfig sends the current preset dev config (ADR-0148 P4)', () => {
    const { client, sent } = harness();
    client.setDevConfig({ templateId: 'express-sqlite', slug: 'fullstack', setup: 'from-scratch' });
    expect(sent).toEqual([
      {
        type: 'pty:dev-config',
        templateId: 'express-sqlite',
        slug: 'fullstack',
        setup: 'from-scratch',
      },
    ]);
  });
});
