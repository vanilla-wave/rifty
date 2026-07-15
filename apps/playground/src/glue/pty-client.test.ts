import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPtyClient } from './pty-client.ts';
import type { PageToOwnerFrame } from './pty-protocol.ts';

function harness() {
  const sent: PageToOwnerFrame[] = [];
  const client = createPtyClient({ send: (f) => sent.push(f) });
  return { client, sent };
}

afterEach(() => {
  vi.useRealTimers();
});

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
    client.onFrame({
      type: 'pty:exit',
      sid: 's1',
      rid,
      code: 0,
      exit: { code: 0, signal: null },
      cwd: '/x',
      env: { A: '1' },
    });
    await expect(p).resolves.toBe(0);
    expect(chunks.join('')).toBe('hi\n');
    expect(client.snapshot('s1')).toMatchObject({ cwd: '/x', env: { A: '1' } });
  });

  it('exposes the exact physical exit independently from the shell status', async () => {
    const { client, sent } = harness();
    const result = client.execResult('s1', 'node server.js', {
      cols: 80,
      rows: 24,
      isTTY: true,
      onChunk: () => {},
    });
    const exec = sent.find(
      (frame): frame is Extract<PageToOwnerFrame, { type: 'pty:exec' }> =>
        frame.type === 'pty:exec',
    );
    client.onFrame({
      type: 'pty:exit',
      sid: 's1',
      rid: exec?.rid ?? 'missing',
      code: 130,
      exit: { code: null, signal: 'SIGTERM' },
      cwd: '/',
      env: {},
    });

    await expect(result).resolves.toEqual({
      exitCode: 130,
      exit: { code: null, signal: 'SIGTERM' },
    });
  });

  it('rejects an invalid exact exit frame and releases the session claim', async () => {
    const { client, sent } = harness();
    const result = client.execResult('s1', 'node broken.js', {
      cols: 80,
      rows: 24,
      isTTY: true,
      onChunk: () => {},
    });
    const exec = sent.find(
      (frame): frame is Extract<PageToOwnerFrame, { type: 'pty:exec' }> =>
        frame.type === 'pty:exec',
    );
    client.onFrame({
      type: 'pty:exit',
      sid: 's1',
      rid: exec?.rid ?? 'missing',
      code: 1,
      exit: { code: 0, signal: 'SIGTERM' },
      cwd: '/',
      env: {},
    } as never);

    await expect(result).rejects.toThrow(/exactly one supported code or signal/i);
    const next = client.exec('s1', 'true', {
      cols: 80,
      rows: 24,
      isTTY: true,
      onChunk: () => {},
    });
    const nextExec = sent.filter(
      (frame): frame is Extract<PageToOwnerFrame, { type: 'pty:exec' }> =>
        frame.type === 'pty:exec',
    )[1];
    client.onFrame({
      type: 'pty:exit',
      sid: 's1',
      rid: nextExec?.rid ?? 'missing',
      code: 0,
      exit: { code: 0, signal: null },
      cwd: '/',
      env: {},
    });
    await expect(next).resolves.toBe(0);
  });

  it('routes chunks to matching runs in different sessions (rid correlation)', async () => {
    const { client, sent } = harness();
    const aChunks: string[] = [];
    const bChunks: string[] = [];
    const a = client.exec('s1', 'cmd-a', {
      cols: 80,
      rows: 24,
      isTTY: true,
      onChunk: (c) => aChunks.push(c),
    });
    const b = client.exec('s2', 'cmd-b', {
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
      sid: 's2',
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
    client.onFrame({
      type: 'pty:exit',
      sid: 's1',
      rid: ridA,
      code: 0,
      exit: { code: 0, signal: null },
      cwd: '/',
      env: {},
    });
    client.onFrame({
      type: 'pty:exit',
      sid: 's2',
      rid: ridB,
      code: 0,
      exit: { code: 0, signal: null },
      cwd: '/',
      env: {},
    });
    await Promise.all([a, b]);
    expect(aChunks.join('')).toBe('A');
    expect(bChunks.join('')).toBe('B');
  });

  // Regression (CI dev-server-ready marker flake): the owner emits the
  // "[vite] dev server ready" line from an async listen() message that can land
  // AFTER the run's pty:exit when a restart aborted the run. The run is gone, so
  // rid correlation finds nothing — but the marker is real output for the
  // session's terminal and must NOT be silently dropped (it was: the e2e read an
  // empty/short buffer and timed out). It lands via the session's trailing sink.
  it('delivers a chunk arriving after pty:exit to the session terminal (marker race)', async () => {
    const { client, sent } = harness();
    const chunks: string[] = [];
    const p = client.exec('s1', 'vite', {
      cols: 80,
      rows: 24,
      isTTY: true,
      onChunk: (c) => chunks.push(c),
    });
    const rid = (
      sent.find((f) => f.type === 'pty:exec') as Extract<PageToOwnerFrame, { type: 'pty:exec' }>
    ).rid;
    // Run exits first (Ctrl-C / restart abort, code 130) ...
    client.onFrame({
      type: 'pty:exit',
      sid: 's1',
      rid,
      code: 130,
      exit: { code: null, signal: 'SIGINT' },
      cwd: '/',
      env: {},
    });
    await expect(p).resolves.toBe(130);
    // ... then the readiness marker arrives late for the now-gone run.
    client.onFrame({
      type: 'pty:chunk',
      sid: 's1',
      rid,
      stream: 'stdout',
      seq: 1,
      data: new TextEncoder().encode('[vite] dev server ready on port 5174\n'),
    });
    expect(chunks.join('')).toContain('[vite] dev server ready on port 5174');
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
      exit: { code: 0, signal: null },
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

  it('disconnect rejects a hung exec loudly instead of inventing a process exit', async () => {
    const { client } = harness();
    const p = client.exec('s1', 'sleep 9', { cols: 80, rows: 24, isTTY: true, onChunk: () => {} });
    client.disconnect(); // owner died
    await expect(p).rejects.toThrow(/ClosedHandleError.*owner died/i);
  });

  // Race a promise against a 50ms sentinel so a hang fails fast + deterministically.
  const settledOr = <T>(p: Promise<T>, pending: T): Promise<T> =>
    Promise.race([p, new Promise<T>((r) => setTimeout(() => r(pending), 50))]);

  it('claims one run per session synchronously', async () => {
    const { client, sent } = harness();
    const first = client.exec('s1', 'first', {
      cols: 80,
      rows: 24,
      isTTY: true,
      onChunk: () => {},
    });

    expect(() =>
      client.exec('s1', 'second', {
        cols: 80,
        rows: 24,
        isTTY: true,
        onChunk: () => {},
      }),
    ).toThrow(/busy|already running/i);
    const execs = sent.filter((frame) => frame.type === 'pty:exec');
    expect(execs).toHaveLength(1);

    const rid = (execs[0] as Extract<PageToOwnerFrame, { type: 'pty:exec' }>).rid;
    client.onFrame({
      type: 'pty:exit',
      sid: 's1',
      rid,
      code: 0,
      exit: { code: 0, signal: null },
      cwd: '/',
      env: {},
    });
    await first;
  });

  it('publishes onStart only after the matching owner admission and fences sibling/duplicate frames', async () => {
    const { client, sent } = harness();
    const starts: string[] = [];
    const first = client.exec('s1', 'first', {
      cols: 80,
      rows: 24,
      isTTY: true,
      onChunk: () => {},
      onStart: (rid) => starts.push(`s1/${rid}`),
    });
    const sibling = client.exec('s2', 'sibling', {
      cols: 80,
      rows: 24,
      isTTY: true,
      onChunk: () => {},
      onStart: (rid) => starts.push(`s2/${rid}`),
    });
    const execs = sent.filter(
      (frame): frame is Extract<PageToOwnerFrame, { type: 'pty:exec' }> =>
        frame.type === 'pty:exec',
    );
    const firstExec = execs[0]!;
    const siblingExec = execs[1]!;

    expect(starts).toEqual([]);
    client.onFrame({
      type: 'pty:run-ready',
      sid: 's2',
      rid: firstExec.rid,
    });
    expect(starts).toEqual([]);

    client.onFrame({ type: 'pty:run-ready', sid: 's2', rid: siblingExec.rid });
    client.onFrame({ type: 'pty:run-ready', sid: 's2', rid: siblingExec.rid });
    client.onFrame({ type: 'pty:run-ready', sid: 's1', rid: firstExec.rid });
    expect(starts).toEqual([`s2/${siblingExec.rid}`, `s1/${firstExec.rid}`]);

    for (const frame of execs) {
      client.onFrame({
        type: 'pty:exit',
        sid: frame.sid,
        rid: frame.rid,
        code: 0,
        exit: { code: 0, signal: null },
        cwd: '/',
        env: {},
      });
    }
    await Promise.all([first, sibling]);
  });

  it.each(['stop', 'close', 'owner death'] as const)(
    'never publishes onStart when %s settles before owner admission',
    async (settlement) => {
      const { client, sent } = harness();
      const starts: string[] = [];
      const run = client.exec('s1', 'node pending.mjs', {
        cols: 80,
        rows: 24,
        isTTY: true,
        onChunk: () => {},
        onStart: (rid) => starts.push(rid),
      });
      const exec = sent.find(
        (frame): frame is Extract<PageToOwnerFrame, { type: 'pty:exec' }> =>
          frame.type === 'pty:exec',
      )!;

      if (settlement === 'owner death') {
        client.disconnect();
        await expect(run).rejects.toThrow(/ClosedHandleError.*owner died/i);
      } else {
        let close: Promise<void> | undefined;
        if (settlement === 'stop') client.signal('s1', exec.rid);
        if (settlement === 'close') {
          close = client.closeSession('s1');
          client.onFrame({ type: 'pty:run-ready', sid: 's1', rid: exec.rid });
          expect(starts).toEqual([]);
        }
        client.onFrame({
          type: 'pty:exit',
          sid: 's1',
          rid: exec.rid,
          code: 130,
          exit: { code: null, signal: 'SIGINT' },
          cwd: '/',
          env: {},
        });
        await expect(run).resolves.toBe(130);
        if (close) {
          const closeFrame = sent.find(
            (frame): frame is Extract<PageToOwnerFrame, { type: 'pty:close' }> =>
              frame.type === 'pty:close',
          )!;
          client.onFrame({
            type: 'pty:close-ack',
            sid: 's1',
            opId: closeFrame.opId,
            ok: true,
          });
          await close;
        }
      }

      client.onFrame({ type: 'pty:run-ready', sid: 's1', rid: exec.rid });
      expect(starts).toEqual([]);
    },
  );

  it('validates resize before transport and resolves only after matching owner ack', async () => {
    const { client, sent } = harness();
    const run = client.exec('s1', 'watch-size', {
      cols: 80,
      rows: 24,
      isTTY: true,
      onChunk: () => {},
    });
    const exec = sent.find(
      (frame): frame is Extract<PageToOwnerFrame, { type: 'pty:exec' }> =>
        frame.type === 'pty:exec',
    )!;
    const control = client as unknown as {
      resize(sid: string, rid: string, cols: number, rows: number): Promise<void>;
    };

    expect(() => control.resize('s1', exec.rid, 0, 40)).toThrow(RangeError);
    expect(sent).toHaveLength(1);

    const resized = control.resize('s1', exec.rid, 120, 40);
    const frame = sent.at(-1) as unknown as {
      type: string;
      sid: string;
      rid: string;
      opId: string;
      cols: number;
      rows: number;
    };
    expect(frame).toMatchObject({
      type: 'pty:resize',
      sid: 's1',
      rid: exec.rid,
      cols: 120,
      rows: 40,
    });
    await expect(
      settledOr(
        resized.then(() => 'resolved'),
        'pending',
      ),
    ).resolves.toBe('pending');

    client.onFrame({
      type: 'pty:resize-ack',
      sid: 's1',
      rid: exec.rid,
      opId: frame.opId,
      ok: true,
    } as never);
    await expect(resized).resolves.toBeUndefined();
    client.onFrame({
      type: 'pty:exit',
      sid: 's1',
      rid: exec.rid,
      code: 0,
      exit: { code: 0, signal: null },
      cwd: '/',
      env: {},
    });
    await run;
  });

  it('validates idle resize before transport and settles only the matching session ACK', async () => {
    const { client, sent } = harness();

    expect(() => client.resizeSession('s1', 0, 30)).toThrow(RangeError);
    expect(sent).toEqual([]);

    const rejected = client.resizeSession('s1', 100, 30);
    const first = sent.find(
      (frame): frame is Extract<PageToOwnerFrame, { type: 'pty:session-resize' }> =>
        frame.type === 'pty:session-resize',
    )!;
    expect(first).toMatchObject({
      type: 'pty:session-resize',
      sid: 's1',
      cols: 100,
      rows: 30,
    });
    client.onFrame({
      type: 'pty:session-resize-ack',
      sid: 'sibling',
      opId: first.opId,
      ok: true,
    });
    client.onFrame({
      type: 'pty:session-resize-ack',
      sid: 's1',
      opId: 'wrong-op',
      ok: true,
    });
    await expect(
      settledOr(
        rejected.then(() => 'resolved'),
        'pending',
      ),
    ).resolves.toBe('pending');
    client.onFrame({
      type: 'pty:session-resize-ack',
      sid: 's1',
      opId: first.opId,
      ok: false,
      error: 'RangeError: owner rejected exact idle size',
    });
    await expect(rejected).rejects.toThrow('owner rejected exact idle size');

    const accepted = client.resizeSession('s1', 120, 40);
    const second = sent.filter(
      (frame): frame is Extract<PageToOwnerFrame, { type: 'pty:session-resize' }> =>
        frame.type === 'pty:session-resize',
    )[1]!;
    client.onFrame({
      type: 'pty:session-resize-ack',
      sid: 's1',
      opId: second.opId,
      ok: true,
    });
    await expect(accepted).resolves.toBeUndefined();
  });

  it.each(['close', 'owner death'] as const)(
    'rejects pending idle resize on %s and ignores its late ACK',
    async (settlement) => {
      const { client, sent } = harness();
      const resized = client.resizeSession('s1', 100, 30);
      const frame = sent.find(
        (candidate): candidate is Extract<PageToOwnerFrame, { type: 'pty:session-resize' }> =>
          candidate.type === 'pty:session-resize',
      )!;

      let close: Promise<void> | undefined;
      if (settlement === 'close') close = client.closeSession('s1');
      else client.disconnect();
      await expect(resized).rejects.toThrow(/ClosedHandleError.*(?:closing|owner died)/i);

      client.onFrame({
        type: 'pty:session-resize-ack',
        sid: 's1',
        opId: frame.opId,
        ok: true,
      });
      if (close) {
        const closeFrame = sent.find(
          (candidate): candidate is Extract<PageToOwnerFrame, { type: 'pty:close' }> =>
            candidate.type === 'pty:close',
        )!;
        client.onFrame({
          type: 'pty:close-ack',
          sid: 's1',
          opId: closeFrame.opId,
          ok: true,
        });
        await close;
      }
    },
  );

  it('uses the caller cancellation identity when close rejects a pending open waiter', async () => {
    const { client, sent } = harness();
    const opening = client.openSession('s1');
    void opening.catch(() => {});
    const cancellation = new Error('project terminal close started');

    const closing = client.closeSession('s1', cancellation);
    await expect(opening).rejects.toBe(cancellation);
    const closeFrame = sent.find(
      (frame): frame is Extract<PageToOwnerFrame, { type: 'pty:close' }> =>
        frame.type === 'pty:close',
    )!;
    client.onFrame({
      type: 'pty:close-ack',
      sid: 's1',
      opId: closeFrame.opId,
      ok: true,
    });
    await expect(closing).resolves.toBeUndefined();
  });

  it('serializes acknowledged stdin writes, makes EOF idempotent, and rejects writes after EOF', async () => {
    const { client, sent } = harness();
    const run = client.exec('s1', 'cat', {
      cols: 80,
      rows: 24,
      isTTY: true,
      onChunk: () => {},
    });
    const exec = sent.find(
      (frame): frame is Extract<PageToOwnerFrame, { type: 'pty:exec' }> =>
        frame.type === 'pty:exec',
    )!;
    const writer = client as unknown as {
      writeStdin(sid: string, rid: string, data: Uint8Array): Promise<void>;
      endStdin(sid: string, rid: string): Promise<void>;
    };

    const first = writer.writeStdin('s1', exec.rid, new Uint8Array([1]));
    const second = writer.writeStdin('s1', exec.rid, new Uint8Array([2]));
    const eof = writer.endStdin('s1', exec.rid);
    const duplicateEof = writer.endStdin('s1', exec.rid);
    expect(duplicateEof).toBe(eof);
    expect(sent.filter((frame) => frame.type === 'pty:stdin')).toHaveLength(1);
    expect(sent.some((frame) => frame.type === 'pty:stdin-eof')).toBe(false);

    const firstFrame = sent.at(-1) as unknown as { opId: string };
    client.onFrame({
      type: 'pty:stdin-ack',
      sid: 's1',
      rid: exec.rid,
      opId: firstFrame.opId,
      ok: true,
    } as never);
    await first;
    await Promise.resolve();
    const stdinFrames = sent.filter((frame) => frame.type === 'pty:stdin');
    expect(stdinFrames).toHaveLength(2);

    const secondFrame = stdinFrames[1] as unknown as { opId: string };
    client.onFrame({
      type: 'pty:stdin-ack',
      sid: 's1',
      rid: exec.rid,
      opId: secondFrame.opId,
      ok: true,
    } as never);
    await second;
    await Promise.resolve();
    const eofFrames = sent.filter((frame) => frame.type === 'pty:stdin-eof');
    expect(eofFrames).toHaveLength(1);

    await expect(writer.writeStdin('s1', exec.rid, new Uint8Array([3]))).rejects.toThrow(
      /StdinClosedError|stdin.*(?:closed|ended)/i,
    );
    const eofFrame = eofFrames[0] as unknown as { opId: string };
    client.onFrame({
      type: 'pty:stdin-ack',
      sid: 's1',
      rid: exec.rid,
      opId: eofFrame.opId,
      ok: true,
    } as never);
    await eof;

    client.onFrame({
      type: 'pty:exit',
      sid: 's1',
      rid: exec.rid,
      code: 0,
      exit: { code: 0, signal: null },
      cwd: '/',
      env: {},
    });
    await run;
  });

  it('keeps session state until idempotent close receives its owner ack', async () => {
    const { client, sent } = harness();
    const opening = client.openSession('s1', { cwd: '/kept', env: { A: '1' } });
    const closer = client as unknown as { closeSession(sid: string): Promise<void> };

    const first = closer.closeSession('s1');
    await expect(opening).rejects.toThrow(/ClosedHandleError.*closing/i);
    const second = closer.closeSession('s1');
    expect(second).toBe(first);
    const frames = sent.filter((frame) => frame.type === 'pty:close');
    expect(frames).toHaveLength(1);
    expect(client.snapshot('s1')).toEqual({ cwd: '/kept', env: { A: '1' } });
    await expect(
      settledOr(
        first.then(() => 'resolved'),
        'pending',
      ),
    ).resolves.toBe('pending');

    const frame = frames[0] as unknown as { opId: string };
    client.onFrame({ type: 'pty:close-ack', sid: 's1', opId: frame.opId, ok: true } as never);
    await expect(first).resolves.toBeUndefined();
    expect(client.snapshot('s1')).toEqual({ cwd: '/', env: {} });
  });

  it('does not lose a synchronous pty:ready reply during openSession send', async () => {
    const ref: { client?: ReturnType<typeof createPtyClient> } = {};
    const client = createPtyClient({
      send: (frame) => {
        if (frame.type === 'pty:open') ref.client?.onFrame({ type: 'pty:ready', sid: frame.sid });
      },
    });
    ref.client = client;

    const settled = await settledOr(
      client.openSession('s1').then(() => 'resolved' as const),
      'pending' as const,
    );
    expect(settled).toBe('resolved');
  });

  it('does not fabricate owner admission when synchronous pty:exit wins during exec send', async () => {
    const ref: { client?: ReturnType<typeof createPtyClient> } = {};
    let startedRid: string | null = null;
    let sentRid: string | null = null;
    const client = createPtyClient({
      send: (frame) => {
        if (frame.type === 'pty:exec') {
          sentRid = frame.rid;
          ref.client?.onFrame({
            type: 'pty:exit',
            sid: frame.sid,
            rid: frame.rid,
            code: 7,
            exit: { code: 7, signal: null },
            cwd: '/after',
            env: { DONE: '1' },
          });
        }
      },
    });
    ref.client = client;

    const settled = await settledOr(
      client.exec('s1', 'fast-fail', {
        cols: 80,
        rows: 24,
        isTTY: true,
        onChunk: () => {},
        onStart: (rid) => {
          startedRid = rid;
        },
      }),
      -999,
    );
    expect(settled).toBe(7);
    expect(sentRid).not.toBeNull();
    expect(startedRid).toBeNull();
    expect(client.snapshot('s1')).toEqual({ cwd: '/after', env: { DONE: '1' } });
  });

  it('keeps the owner-admitted claim until exit when onStart throws', async () => {
    const order: string[] = [];
    const sent: PageToOwnerFrame[] = [];
    const client = createPtyClient({
      send: (frame) => {
        sent.push(frame);
        order.push(frame.type);
      },
    });

    const failed = client.exec('s1', 'first', {
      cols: 80,
      rows: 24,
      isTTY: true,
      onChunk: () => {},
      onStart: () => {
        order.push('onStart');
        throw new Error('start callback failed');
      },
    });
    const firstExec = sent.find(
      (frame): frame is Extract<PageToOwnerFrame, { type: 'pty:exec' }> =>
        frame.type === 'pty:exec',
    )!;
    expect(order).toEqual(['pty:exec']);
    client.onFrame({ type: 'pty:run-ready', sid: 's1', rid: firstExec.rid });
    await expect(failed).rejects.toThrow('start callback failed');
    expect(order).toEqual(['pty:exec', 'onStart', 'pty:signal']);

    expect(() =>
      client.exec('s1', 'too-early', {
        cols: 80,
        rows: 24,
        isTTY: true,
        onChunk: () => {},
      }),
    ).toThrow(/busy|already running/i);
    client.onFrame({
      type: 'pty:exit',
      sid: 's1',
      rid: firstExec.rid,
      code: 130,
      exit: { code: null, signal: 'SIGINT' },
      cwd: '/',
      env: {},
    });

    const next = client.exec('s1', 'second', {
      cols: 80,
      rows: 24,
      isTTY: true,
      onChunk: () => {},
    });
    const execs = sent.filter(
      (frame): frame is Extract<PageToOwnerFrame, { type: 'pty:exec' }> =>
        frame.type === 'pty:exec',
    );
    expect(execs).toHaveLength(2);
    client.onFrame({
      type: 'pty:exit',
      sid: 's1',
      rid: execs[1]!.rid,
      code: 0,
      exit: { code: 0, signal: null },
      cwd: '/',
      env: {},
    });
    await expect(next).resolves.toBe(0);
  });

  it('disconnect rejects a pending openSession waiter loudly (owner died before pty:ready)', async () => {
    const { client, sent } = harness();
    const ready = client.openSession('s1'); // no pty:ready will ever arrive
    const outcome = ready.then(
      () => 'resolved' as const,
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );
    client.disconnect();
    await expect(settledOr(outcome, 'pending')).resolves.toMatch(/ClosedHandleError.*owner died/i);
    expect(sent).toEqual([{ type: 'pty:open', sid: 's1' }]);
  });

  it('future open and close after owner death reject loudly without posting doomed frames', async () => {
    const { client, sent } = harness();
    client.disconnect();
    const open = client.openSession('s2').then(
      () => 'resolved' as const,
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );
    const close = client.closeSession('s2').then(
      () => 'resolved' as const,
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );

    await expect(settledOr(open, 'pending')).resolves.toMatch(/ClosedHandleError.*owner died/i);
    await expect(settledOr(close, 'pending')).resolves.toMatch(/ClosedHandleError.*owner died/i);
    expect(sent).toEqual([]);
  });

  it('starting close rejects a pending open and every future open with ClosedHandleError', async () => {
    const { client, sent } = harness();
    const ready = client.openSession('s1');
    const readyOutcome = ready.then(
      () => 'resolved' as const,
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );

    const close = client.closeSession('s1');
    const futureOpen = client.openSession('s1').then(
      () => 'resolved' as const,
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );
    const openOutcome = await settledOr(readyOutcome, 'pending');
    const futureOutcome = await settledOr(futureOpen, 'pending');

    const closeFrame = sent.find(
      (frame): frame is Extract<PageToOwnerFrame, { type: 'pty:close' }> =>
        frame.type === 'pty:close',
    )!;
    client.onFrame({
      type: 'pty:close-ack',
      sid: 's1',
      opId: closeFrame.opId,
      ok: true,
    });
    await close;

    expect(openOutcome).toMatch(/ClosedHandleError.*closing/i);
    expect(futureOutcome).toMatch(/ClosedHandleError.*closing/i);
  });

  it('future exec after owner death rejects loudly instead of inventing a process exit', async () => {
    const { client, sent } = harness();
    client.disconnect();
    const outcome = client
      .exec('s1', 'ls', { cols: 80, rows: 24, isTTY: true, onChunk: () => {} })
      .then(
        () => 'resolved' as const,
        (error: unknown) => (error instanceof Error ? error.message : String(error)),
      );
    await expect(settledOr(outcome, 'pending')).resolves.toMatch(/ClosedHandleError.*owner died/i);
    expect(sent.some((f) => f.type === 'pty:exec')).toBe(false);
  });

  it('future run controls and owner handshakes fail loudly after owner death', async () => {
    const { client, sent } = harness();
    client.disconnect();

    await expect(client.writeStdin('s1', 'r1', new Uint8Array([1]))).rejects.toThrow(
      /ClosedHandleError/,
    );
    await expect(client.endStdin('s1', 'r1')).rejects.toThrow(/ClosedHandleError/);
    await expect(client.resizeSession('s1', 80, 24)).rejects.toThrow(
      /ClosedHandleError.*owner died/i,
    );
    expect(() => client.resize('s1', 'r1', 80, 24)).toThrow(/ClosedHandleError/);
    expect(() => client.signal('s1', 'r1')).toThrow(/ClosedHandleError.*owner died/i);
    expect(() => client.requestDevServer()).toThrow(/ClosedHandleError.*owner died/i);
    expect(() => client.requestPreview()).toThrow(/ClosedHandleError.*owner died/i);
    expect(sent).toEqual([]);
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

  it('requestDevServer sends a pty:dev-server-req (dev-server handshake)', () => {
    const { client, sent } = harness();
    client.requestDevServer();
    expect(sent).toEqual([{ type: 'pty:dev-server-req' }]);
  });

  it('routes pty:preview to onPreview (ADR-0155 preview-port set)', () => {
    const seen: unknown[] = [];
    const client = createPtyClient({ send: () => {}, onPreview: (f) => seen.push(f) });
    client.onFrame({
      type: 'pty:preview',
      ports: [
        { port: 5174, url: '/preview/5174/', label: 'dev server', source: 'dev-server', sid: 's1' },
        { port: 3210, url: '/preview/3210/', label: 'node server.js', source: 'node', sid: 's2' },
      ],
    });
    expect(seen).toEqual([
      {
        type: 'pty:preview',
        ports: [
          {
            port: 5174,
            url: '/preview/5174/',
            label: 'dev server',
            source: 'dev-server',
            sid: 's1',
          },
          { port: 3210, url: '/preview/3210/', label: 'node server.js', source: 'node', sid: 's2' },
        ],
      },
    ]);
  });

  it('requestPreview sends a pty:preview-req (preview handshake)', () => {
    const { client, sent } = harness();
    client.requestPreview();
    expect(sent).toEqual([{ type: 'pty:preview-req' }]);
  });

  it('setDevConfig sends the current preset dev config and waits for owner readiness', async () => {
    const { client, sent } = harness();
    const ready = client.setDevConfig({
      templateId: 'express-sqlite',
      slug: 'fullstack',
      setup: 'from-scratch',
    });
    expect(sent).toEqual([
      {
        type: 'pty:dev-config',
        id: 'dc1',
        templateId: 'express-sqlite',
        slug: 'fullstack',
        setup: 'from-scratch',
      },
    ]);
    const beforeAck = await settledOr(
      ready.then(() => 'resolved' as const),
      'pending' as const,
    );
    expect(beforeAck).toBe('pending');
    client.onFrame({ type: 'pty:dev-config-ready', id: 'dc1' });
    await expect(ready).resolves.toBeUndefined();
  });

  it('keeps an admitted dev config pending past the former readiness timeout', async () => {
    vi.useFakeTimers();
    const { client } = harness();
    const ready = client.setDevConfig({
      templateId: 'express-sqlite',
      slug: 'slow-config',
      setup: 'from-scratch',
    });
    let outcome = 'pending';
    void ready.then(
      () => {
        outcome = 'resolved';
      },
      () => {
        outcome = 'rejected';
      },
    );

    await vi.advanceTimersByTimeAsync(60_001);
    expect(outcome).toBe('pending');

    client.onFrame({ type: 'pty:dev-config-ready', id: 'dc1' });
    await expect(ready).resolves.toBeUndefined();
  });

  it('registers dev config settlement before a synchronous owner reply', async () => {
    const client = createPtyClient({
      send(frame) {
        if (frame.type === 'pty:dev-config') {
          client.onFrame({ type: 'pty:dev-config-ready', id: frame.id });
        }
      },
    });

    const ready = client
      .setDevConfig({ templateId: 'typescript', slug: 'sync', setup: 'instant' })
      .then(
        () => 'resolved' as const,
        () => 'rejected' as const,
      );
    const outcome = await settledOr(ready, 'pending' as const);
    client.disconnect();
    expect(outcome).toBe('resolved');
  });

  it('rejects dev config with the exact synchronous send failure', async () => {
    const failure = new Error('dev config send failed exactly');
    const client = createPtyClient({
      send() {
        throw failure;
      },
    });

    await expect(
      client.setDevConfig({ templateId: 'typescript', slug: 'failed', setup: 'instant' }),
    ).rejects.toBe(failure);
  });

  it('disconnect rejects pending and future setDevConfig loudly', async () => {
    const { client, sent } = harness();
    const ready = client.setDevConfig({
      templateId: 'typescript',
      slug: 'scratch',
      setup: 'instant',
    });
    const outcome = ready.then(
      () => 'resolved' as const,
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );
    client.disconnect();
    await expect(settledOr(outcome, 'pending')).resolves.toMatch(/ClosedHandleError.*owner died/i);

    const future = client
      .setDevConfig({ templateId: 'vite-react', slug: 'later', setup: 'from-scratch' })
      .then(
        () => 'resolved' as const,
        (error: unknown) => (error instanceof Error ? error.message : String(error)),
      );
    await expect(settledOr(future, 'pending')).resolves.toMatch(/ClosedHandleError.*owner died/i);
    expect(sent.filter((frame) => frame.type === 'pty:dev-config')).toHaveLength(1);
  });
});
