import type { ShellCompletionResult } from '@riftydev/shell';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPtyClient } from './pty-client.ts';
import type { OwnerToPageFrame, PageToOwnerFrame } from './pty-protocol.ts';

type FuturePtyComplete = {
  readonly type: 'pty:complete';
  readonly sid: string;
  readonly opId: string;
  readonly line: string;
  readonly cursor: number;
};

type FuturePtyCompleteResult =
  | {
      readonly type: 'pty:complete-result';
      readonly sid: string;
      readonly opId: string;
      readonly ok: true;
      readonly result: ShellCompletionResult | null;
    }
  | {
      readonly type: 'pty:complete-result';
      readonly sid: string;
      readonly opId: string;
      readonly ok: false;
      readonly error: string;
    };

type CompletionPtyClient = ReturnType<typeof createPtyClient> & {
  complete(sid: string, line: string, cursor: number): Promise<ShellCompletionResult | null>;
};

function completionClient(client: ReturnType<typeof createPtyClient>): CompletionPtyClient {
  return client as unknown as CompletionPtyClient;
}

function completionFrames(sent: readonly PageToOwnerFrame[]): readonly FuturePtyComplete[] {
  return (sent as readonly (PageToOwnerFrame | FuturePtyComplete)[]).filter(
    (frame): frame is FuturePtyComplete => frame.type === 'pty:complete',
  );
}

function deliverCompletion(
  client: ReturnType<typeof createPtyClient>,
  frame: FuturePtyCompleteResult,
): void {
  client.onFrame(frame as unknown as OwnerToPageFrame);
}

async function openCompletionSession(
  client: ReturnType<typeof createPtyClient>,
  sid: string,
): Promise<void> {
  const opened = client.openSession(sid);
  client.onFrame({ type: 'pty:ready', sid });
  await opened;
}

function harness() {
  const sent: PageToOwnerFrame[] = [];
  const client = createPtyClient({ send: (f) => sent.push(f) });
  return { client, sent };
}

function captureThrown(operation: () => void): unknown {
  try {
    operation();
    return undefined;
  } catch (error) {
    return error;
  }
}

function deliverChunk(
  client: ReturnType<typeof createPtyClient>,
  sid: string,
  rid: string,
  data = 'late',
): void {
  client.onFrame({
    type: 'pty:chunk',
    sid,
    rid,
    stream: 'stdout',
    seq: 1,
    data: new TextEncoder().encode(data),
  });
}

type ExecFrame = Extract<PageToOwnerFrame, { type: 'pty:exec' }>;

function execFrames(sent: readonly PageToOwnerFrame[]): readonly ExecFrame[] {
  return sent.filter((frame): frame is ExecFrame => frame.type === 'pty:exec');
}

function startRun(
  client: ReturnType<typeof createPtyClient>,
  sent: PageToOwnerFrame[],
  sid: string,
  onChunk: (chunk: string) => void = () => {},
): { readonly frame: ExecFrame; readonly promise: Promise<number> } {
  const promise = client.exec(sid, 'command', { cols: 80, rows: 24, isTTY: true, onChunk });
  const frame = execFrames(sent).at(-1);
  if (frame === undefined) throw new Error(`missing exec frame for ${sid}`);
  return { frame, promise };
}

function deliverExit(client: ReturnType<typeof createPtyClient>, frame: ExecFrame, code = 0): void {
  client.onFrame({
    type: 'pty:exit',
    sid: frame.sid,
    rid: frame.rid,
    code,
    exit: code === 130 ? { code: null, signal: 'SIGINT' } : { code, signal: null },
    cwd: '/',
    env: {},
  });
}

function expectCorrelationMismatch(error: unknown, type: string, received: string): void {
  expect(error).toMatchObject({
    name: 'PtyProtocolInvariantError',
    message: expect.stringMatching(new RegExp(`${type}.*correlation.*${received}`, 'i')),
  });
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

  it('rejects an owner-side lifecycle failure instead of fabricating a process exit', async () => {
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
      code: 1,
      exit: { code: 1, signal: null },
      cwd: '/',
      env: {},
      error: 'Worker peer closed unexpectedly',
    });

    await expect(result).rejects.toThrow(/peer closed unexpectedly/i);
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

  it('binds output and exit to the exact sid/rid across sessions', async () => {
    const { client, sent } = harness();
    const firstChunks: string[] = [];
    const secondChunks: string[] = [];
    const first = startRun(client, sent, 's1', (chunk) => firstChunks.push(chunk));
    const second = startRun(client, sent, 's2', (chunk) => secondChunks.push(chunk));

    const chunkMismatch = captureThrown(() =>
      deliverChunk(client, second.frame.sid, first.frame.rid, 'crossed'),
    );
    const exitMismatch = captureThrown(() =>
      client.onFrame({
        type: 'pty:exit',
        sid: second.frame.sid,
        rid: first.frame.rid,
        code: 0,
        exit: { code: 0, signal: null },
        cwd: '/',
        env: {},
      }),
    );
    deliverChunk(client, first.frame.sid, first.frame.rid, 'A');
    deliverChunk(client, second.frame.sid, second.frame.rid, 'B');
    deliverExit(client, first.frame);
    deliverExit(client, second.frame);
    await Promise.all([first.promise, second.promise]);

    expectCorrelationMismatch(chunkMismatch, 'pty:chunk', second.frame.sid);
    expectCorrelationMismatch(exitMismatch, 'pty:exit', second.frame.sid);
    expect(firstChunks).toEqual(['A']);
    expect(secondChunks).toEqual(['B']);
  });

  it('delivers admitted output that arrives after pty:exit to the exact run sink', async () => {
    const { client, sent } = harness();
    const chunks: string[] = [];
    const run = startRun(client, sent, 's1', (chunk) => chunks.push(chunk));
    client.onFrame({ type: 'pty:run-ready', sid: run.frame.sid, rid: run.frame.rid });
    deliverExit(client, run.frame, 130);
    await expect(run.promise).resolves.toBe(130);
    const mismatch = captureThrown(() => deliverChunk(client, 'sibling', run.frame.rid));
    deliverChunk(client, run.frame.sid, run.frame.rid, 'late output\n');

    expectCorrelationMismatch(mismatch, 'pty:chunk', 'sibling');
    expect(chunks.join('')).toBe('late output\n');
  });

  it('never publishes output authority when exit wins before admission', async () => {
    const { client, sent } = harness();
    const chunks: string[] = [];
    const run = startRun(client, sent, 'not-admitted', (chunk) => chunks.push(chunk));
    deliverExit(client, run.frame);
    await run.promise;
    deliverChunk(client, run.frame.sid, run.frame.rid);

    expect(chunks).toEqual([]);
  });

  it('retires stale output authority when a newer run is admitted', async () => {
    const { client, sent } = harness();
    const firstChunks: string[] = [];
    const secondChunks: string[] = [];
    const first = startRun(client, sent, 's1', (chunk) => firstChunks.push(chunk));
    client.onFrame({ type: 'pty:run-ready', sid: first.frame.sid, rid: first.frame.rid });
    deliverExit(client, first.frame);
    await first.promise;

    const second = startRun(client, sent, 's1', (chunk) => secondChunks.push(chunk));
    client.onFrame({ type: 'pty:run-ready', sid: second.frame.sid, rid: second.frame.rid });
    deliverChunk(client, first.frame.sid, first.frame.rid, 'stale');
    deliverExit(client, second.frame);
    await second.promise;

    expect(firstChunks).toEqual([]);
    expect(secondChunks).toEqual([]);
  });

  it.each(['close', 'disconnect'] as const)(
    'retires admitted output authority on %s',
    async (settlement) => {
      const { client, sent } = harness();
      const chunks: string[] = [];
      const run = startRun(client, sent, 'retired', (chunk) => chunks.push(chunk));
      client.onFrame({ type: 'pty:run-ready', sid: run.frame.sid, rid: run.frame.rid });

      if (settlement === 'disconnect') {
        client.disconnect();
        await expect(run.promise).rejects.toThrow(/owner died/i);
      } else {
        const closing = client.closeSession(run.frame.sid);
        const close = sent.find(
          (frame): frame is Extract<PageToOwnerFrame, { type: 'pty:close' }> =>
            frame.type === 'pty:close',
        )!;
        client.onFrame({ type: 'pty:close-ack', sid: close.sid, opId: close.opId, ok: true });
        await closing;
      }

      deliverChunk(client, run.frame.sid, run.frame.rid, 'retired');
      if (settlement === 'close') {
        deliverExit(client, run.frame);
        await run.promise;
      }
      expect(chunks).toEqual([]);
    },
  );

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
    client.onFrame({ type: 'pty:ready', sid: 's1' });
  });

  it('disconnect rejects a hung exec loudly instead of inventing a process exit', async () => {
    const { client } = harness();
    const p = client.exec('s1', 'sleep 9', { cols: 80, rows: 24, isTTY: true, onChunk: () => {} });
    client.disconnect(); // owner died
    await expect(p).rejects.toThrow(/ClosedHandleError.*owner died/i);
  });

  it('preserves one caller-owned disconnect cause across every pending and future operation', async () => {
    vi.useFakeTimers();
    const { client, sent } = harness();
    const opening = client.openSession('opening');
    const idleResize = client.resizeSession('idle-resize', 80, 24);
    const devConfig = client.setDevConfig({
      templateId: 'typescript',
      slug: 'disconnect-provenance',
      setup: 'instant',
    });
    const closing = client.closeSession('closing');
    const running = client.exec('running', 'cat', {
      cols: 80,
      rows: 24,
      isTTY: true,
      onChunk: () => {},
    });
    const exec = sent.find(
      (frame): frame is Extract<PageToOwnerFrame, { type: 'pty:exec' }> =>
        frame.type === 'pty:exec',
    );
    if (exec === undefined) throw new Error('missing exec frame');
    const writing = client.writeStdin('running', exec.rid, new Uint8Array([1]));
    const ending = client.endStdin('running', exec.rid);
    const resizing = client.resize('running', exec.rid, 100, 30);
    const pending = [
      opening,
      idleResize,
      devConfig,
      closing,
      running,
      writing,
      ending,
      resizing,
    ].map((operation) =>
      operation.then(
        () => null,
        (error: unknown) => error,
      ),
    );
    const disconnectCause = new Error('exact owner transport disconnect');

    client.disconnect(disconnectCause);
    client.disconnect(new Error('later disconnect must not replace the first cause'));

    const future = [
      client.openSession('future-open'),
      client.resizeSession('future-resize', 80, 24),
      client.closeSession('future-close'),
      client.setDevConfig({
        templateId: 'vite-react',
        slug: 'future-config',
        setup: 'from-scratch',
      }),
      client.exec('future-run', 'true', {
        cols: 80,
        rows: 24,
        isTTY: true,
        onChunk: () => {},
      }),
      client.writeStdin('future-run', 'future-rid', new Uint8Array([1])),
      client.endStdin('future-run', 'future-rid'),
    ].map((operation) =>
      operation.then(
        () => null,
        (error: unknown) => error,
      ),
    );

    const thrownBy = (operation: () => void): unknown => {
      try {
        operation();
        return null;
      } catch (error) {
        return error;
      }
    };
    const synchronous = [
      thrownBy(() => client.resize('future-run', 'future-rid', 80, 24)),
      thrownBy(() => client.signal('future-run', 'future-rid')),
      thrownBy(() => client.requestDevServer()),
      thrownBy(() => client.requestPreview()),
    ];
    const outcomes = [
      ...(await Promise.all(pending)),
      ...(await Promise.all(future)),
      ...synchronous,
    ];
    expect(outcomes).toEqual(outcomes.map(() => disconnectCause));
    expect(vi.getTimerCount()).toBe(0);
  });

  // Race a promise against a 50ms sentinel so a hang fails fast + deterministically.
  const settledOr = <T>(p: Promise<T>, pending: T): Promise<T> =>
    Promise.race([p, new Promise<T>((r) => setTimeout(() => r(pending), 50))]);

  const ACK_TIMEOUT_MS = 60_000;

  it('bounds initial session readiness, ignores its late frame, and fences only that session', async () => {
    vi.useFakeTimers();
    const { client, sent } = harness();
    const opening = client.openSession('hung-open');
    let failure: unknown;
    void opening.catch((error: unknown) => {
      failure = error;
    });

    await vi.advanceTimersByTimeAsync(ACK_TIMEOUT_MS + 1);

    expect(failure).toEqual(
      expect.objectContaining({
        name: 'PtyAckTimeoutError',
        message: expect.stringMatching(/pty:ready.*hung-open.*60000ms/i),
      }),
    );
    client.onFrame({ type: 'pty:ready', sid: 'hung-open' });
    await expect(client.openSession('hung-open')).rejects.toBe(failure);
    expect(
      sent.filter((frame) => frame.type === 'pty:open' && frame.sid === 'hung-open'),
    ).toHaveLength(1);

    const sibling = client.openSession('healthy-open');
    client.onFrame({ type: 'pty:ready', sid: 'healthy-open' });
    await expect(sibling).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds run admission without timing out an admitted process lifetime', async () => {
    vi.useFakeTimers();
    const { client, sent } = harness();
    const starts: string[] = [];
    const hung = client.exec('hung-run', 'node server.js', {
      cols: 80,
      rows: 24,
      isTTY: true,
      onChunk: () => {},
      onStart: (rid) => starts.push(rid),
    });
    const hungFrame = sent.find(
      (frame): frame is Extract<PageToOwnerFrame, { type: 'pty:exec' }> =>
        frame.type === 'pty:exec',
    )!;
    let failure: unknown;
    void hung.catch((error: unknown) => {
      failure = error;
    });

    await vi.advanceTimersByTimeAsync(ACK_TIMEOUT_MS + 1);

    expect(failure).toEqual(
      expect.objectContaining({
        name: 'PtyAckTimeoutError',
        message: expect.stringMatching(/pty:run-ready.*hung-run.*60000ms/i),
      }),
    );
    client.onFrame({ type: 'pty:run-ready', sid: 'hung-run', rid: hungFrame.rid });
    expect(starts).toEqual([]);
    expect(() =>
      client.exec('hung-run', 'must-not-overlap', {
        cols: 80,
        rows: 24,
        isTTY: true,
        onChunk: () => {},
      }),
    ).toThrow(/pty:run-ready.*hung-run/i);

    let admittedOutcome = 'pending';
    const admitted = client.exec('healthy-run', 'node long-lived.js', {
      cols: 80,
      rows: 24,
      isTTY: true,
      onChunk: () => {},
    });
    void admitted.then(
      () => {
        admittedOutcome = 'resolved';
      },
      () => {
        admittedOutcome = 'rejected';
      },
    );
    const admittedFrame = sent.filter(
      (frame): frame is Extract<PageToOwnerFrame, { type: 'pty:exec' }> =>
        frame.type === 'pty:exec',
    )[1]!;
    client.onFrame({ type: 'pty:run-ready', sid: 'healthy-run', rid: admittedFrame.rid });
    await vi.advanceTimersByTimeAsync(ACK_TIMEOUT_MS * 2);
    expect(admittedOutcome).toBe('pending');

    client.onFrame({
      type: 'pty:exit',
      sid: 'healthy-run',
      rid: admittedFrame.rid,
      code: 0,
      exit: { code: 0, signal: null },
      cwd: '/',
      env: {},
    });
    await expect(admitted).resolves.toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

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
    const mismatch = captureThrown(() =>
      client.onFrame({
        type: 'pty:run-ready',
        sid: 's2',
        rid: firstExec.rid,
      }),
    );
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
    expectCorrelationMismatch(mismatch, 'pty:run-ready', 's2');
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

    const mismatch = captureThrown(() =>
      client.onFrame({
        type: 'pty:resize-ack',
        sid: 'sibling',
        rid: 'sibling-run',
        opId: frame.opId,
        ok: true,
      } as never),
    );
    client.onFrame({
      type: 'pty:resize-ack',
      sid: 's1',
      rid: exec.rid,
      opId: frame.opId,
      ok: true,
    } as never);
    await expect(resized).resolves.toBeUndefined();
    expectCorrelationMismatch(mismatch, 'pty:resize-ack', 'sibling');
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
    const mismatch = captureThrown(() =>
      client.onFrame({
        type: 'pty:session-resize-ack',
        sid: 'sibling',
        opId: first.opId,
        ok: true,
      }),
    );
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
    expectCorrelationMismatch(mismatch, 'pty:session-resize-ack', 'sibling');

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
    const mismatch = captureThrown(() =>
      client.onFrame({
        type: 'pty:stdin-ack',
        sid: 'sibling',
        rid: 'sibling-run',
        opId: firstFrame.opId,
        ok: true,
      } as never),
    );
    client.onFrame({
      type: 'pty:stdin-ack',
      sid: 's1',
      rid: exec.rid,
      opId: firstFrame.opId,
      ok: true,
    } as never);
    await first;
    expectCorrelationMismatch(mismatch, 'pty:stdin-ack', 'sibling');
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

  it.each(['data', 'eof'] as const)(
    'bounds a hung stdin %s acknowledgement, ignores it late, and keeps process lifetime unbounded',
    async (kind) => {
      vi.useFakeTimers();
      const { client, sent } = harness();
      const run = client.exec('stdin-timeout', 'cat', {
        cols: 80,
        rows: 24,
        isTTY: true,
        onChunk: () => {},
      });
      const exec = sent.find(
        (frame): frame is Extract<PageToOwnerFrame, { type: 'pty:exec' }> =>
          frame.type === 'pty:exec',
      )!;
      client.onFrame({ type: 'pty:run-ready', sid: exec.sid, rid: exec.rid });

      const operation =
        kind === 'data'
          ? client.writeStdin(exec.sid, exec.rid, new Uint8Array([1]))
          : client.endStdin(exec.sid, exec.rid);
      const operationFrame = sent.find(
        (frame): frame is Extract<PageToOwnerFrame, { type: 'pty:stdin' | 'pty:stdin-eof' }> =>
          frame.type === (kind === 'data' ? 'pty:stdin' : 'pty:stdin-eof'),
      )!;
      let failure: unknown;
      void operation.catch((error: unknown) => {
        failure = error;
      });

      await vi.advanceTimersByTimeAsync(ACK_TIMEOUT_MS + 1);

      expect(failure).toEqual(
        expect.objectContaining({
          name: 'PtyAckTimeoutError',
          message: expect.stringMatching(/pty:stdin.*stdin-timeout.*60000ms/i),
        }),
      );
      client.onFrame({
        type: 'pty:stdin-ack',
        sid: exec.sid,
        rid: exec.rid,
        opId: operationFrame.opId,
        ok: true,
      });

      let runOutcome = 'pending';
      void run.then(
        () => {
          runOutcome = 'resolved';
        },
        () => {
          runOutcome = 'rejected';
        },
      );
      await vi.advanceTimersByTimeAsync(ACK_TIMEOUT_MS + 1);
      expect(runOutcome).toBe('pending');
      client.onFrame({
        type: 'pty:exit',
        sid: exec.sid,
        rid: exec.rid,
        code: 0,
        exit: { code: 0, signal: null },
        cwd: '/',
        env: {},
      });
      await expect(run).resolves.toBe(0);

      const next = client.exec(exec.sid, 'true', {
        cols: 80,
        rows: 24,
        isTTY: true,
        onChunk: () => {},
      });
      const nextExec = sent.filter(
        (frame): frame is Extract<PageToOwnerFrame, { type: 'pty:exec' }> =>
          frame.type === 'pty:exec',
      )[1]!;
      client.onFrame({ type: 'pty:run-ready', sid: nextExec.sid, rid: nextExec.rid });
      client.onFrame({
        type: 'pty:exit',
        sid: nextExec.sid,
        rid: nextExec.rid,
        code: 0,
        exit: { code: 0, signal: null },
        cwd: '/',
        env: {},
      });
      await expect(next).resolves.toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('bounds active resize per opId, ignores a late ACK, and admits a subsequent resize', async () => {
    vi.useFakeTimers();
    const { client, sent } = harness();
    const run = client.exec('resize-timeout', 'cat', {
      cols: 80,
      rows: 24,
      isTTY: true,
      onChunk: () => {},
    });
    const exec = sent.find(
      (frame): frame is Extract<PageToOwnerFrame, { type: 'pty:exec' }> =>
        frame.type === 'pty:exec',
    )!;
    client.onFrame({ type: 'pty:run-ready', sid: exec.sid, rid: exec.rid });
    const first = client.resize(exec.sid, exec.rid, 100, 30);
    const firstFrame = sent.find(
      (frame): frame is Extract<PageToOwnerFrame, { type: 'pty:resize' }> =>
        frame.type === 'pty:resize',
    )!;
    let failure: unknown;
    void first.catch((error: unknown) => {
      failure = error;
    });

    await vi.advanceTimersByTimeAsync(ACK_TIMEOUT_MS + 1);

    expect(failure).toEqual(
      expect.objectContaining({
        name: 'PtyAckTimeoutError',
        message: expect.stringMatching(/pty:resize-ack.*resize-timeout.*60000ms/i),
      }),
    );
    client.onFrame({
      type: 'pty:resize-ack',
      sid: exec.sid,
      rid: exec.rid,
      opId: firstFrame.opId,
      ok: true,
    });

    const second = client.resize(exec.sid, exec.rid, 120, 40);
    const secondFrame = sent.filter(
      (frame): frame is Extract<PageToOwnerFrame, { type: 'pty:resize' }> =>
        frame.type === 'pty:resize',
    )[1]!;
    client.onFrame({
      type: 'pty:resize-ack',
      sid: exec.sid,
      rid: exec.rid,
      opId: secondFrame.opId,
      ok: true,
    });
    await expect(second).resolves.toBeUndefined();
    client.onFrame({
      type: 'pty:exit',
      sid: exec.sid,
      rid: exec.rid,
      code: 0,
      exit: { code: 0, signal: null },
      cwd: '/',
      env: {},
    });
    await run;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds idle resize per opId, ignores a late ACK, and admits a subsequent resize', async () => {
    vi.useFakeTimers();
    const { client, sent } = harness();
    const first = client.resizeSession('idle-timeout', 100, 30);
    const firstFrame = sent.find(
      (frame): frame is Extract<PageToOwnerFrame, { type: 'pty:session-resize' }> =>
        frame.type === 'pty:session-resize',
    )!;
    let failure: unknown;
    void first.catch((error: unknown) => {
      failure = error;
    });

    await vi.advanceTimersByTimeAsync(ACK_TIMEOUT_MS + 1);

    expect(failure).toEqual(
      expect.objectContaining({
        name: 'PtyAckTimeoutError',
        message: expect.stringMatching(/pty:session-resize-ack.*idle-timeout.*60000ms/i),
      }),
    );
    client.onFrame({
      type: 'pty:session-resize-ack',
      sid: firstFrame.sid,
      opId: firstFrame.opId,
      ok: true,
    });

    const second = client.resizeSession(firstFrame.sid, 120, 40);
    const secondFrame = sent.filter(
      (frame): frame is Extract<PageToOwnerFrame, { type: 'pty:session-resize' }> =>
        frame.type === 'pty:session-resize',
    )[1]!;
    client.onFrame({
      type: 'pty:session-resize-ack',
      sid: secondFrame.sid,
      opId: secondFrame.opId,
      ok: true,
    });
    await expect(second).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds session close, ignores its late ACK, and permits an opId-correlated recovery close', async () => {
    vi.useFakeTimers();
    const { client, sent } = harness();
    const first = client.closeSession('close-timeout');
    const firstFrame = sent.find(
      (frame): frame is Extract<PageToOwnerFrame, { type: 'pty:close' }> =>
        frame.type === 'pty:close',
    )!;
    let failure: unknown;
    void first.catch((error: unknown) => {
      failure = error;
    });

    await vi.advanceTimersByTimeAsync(ACK_TIMEOUT_MS + 1);

    expect(failure).toEqual(
      expect.objectContaining({
        name: 'PtyAckTimeoutError',
        message: expect.stringMatching(/pty:close-ack.*close-timeout.*60000ms/i),
      }),
    );
    client.onFrame({
      type: 'pty:close-ack',
      sid: firstFrame.sid,
      opId: firstFrame.opId,
      ok: true,
    });

    const recovery = client.closeSession(firstFrame.sid);
    const recoveryFrame = sent.filter(
      (frame): frame is Extract<PageToOwnerFrame, { type: 'pty:close' }> =>
        frame.type === 'pty:close',
    )[1]!;
    expect(recoveryFrame.opId).not.toBe(firstFrame.opId);
    client.onFrame({
      type: 'pty:close-ack',
      sid: recoveryFrame.sid,
      opId: recoveryFrame.opId,
      ok: true,
    });
    await expect(recovery).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
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
    const mismatch = captureThrown(() =>
      client.onFrame({
        type: 'pty:close-ack',
        sid: 'sibling',
        opId: frame.opId,
        ok: true,
      } as never),
    );
    client.onFrame({ type: 'pty:close-ack', sid: 's1', opId: frame.opId, ok: true } as never);
    await expect(first).resolves.toBeUndefined();
    expectCorrelationMismatch(mismatch, 'pty:close-ack', 'sibling');
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

  it('bounds dev-config readiness and fences only the indeterminate config channel', async () => {
    vi.useFakeTimers();
    const { client, sent } = harness();
    const ready = client.setDevConfig({
      templateId: 'express-sqlite',
      slug: 'slow-config',
      setup: 'from-scratch',
    });
    let failure: unknown;
    void ready.catch((error: unknown) => {
      failure = error;
    });
    await vi.advanceTimersByTimeAsync(10_000);
    const concurrent = client.setDevConfig({
      templateId: 'typescript',
      slug: 'also-indeterminate',
      setup: 'instant',
    });
    let concurrentFailure: unknown;
    void concurrent.catch((error: unknown) => {
      concurrentFailure = error;
    });

    await vi.advanceTimersByTimeAsync(ACK_TIMEOUT_MS - 10_000 + 1);

    expect(failure).toEqual(
      expect.objectContaining({
        name: 'PtyAckTimeoutError',
        message: expect.stringMatching(/pty:dev-config-ready.*dc1.*60000ms/i),
      }),
    );
    expect(concurrentFailure).toBe(failure);
    client.onFrame({ type: 'pty:dev-config-ready', id: 'dc1' });
    client.onFrame({ type: 'pty:dev-config-ready', id: 'dc2' });

    await expect(
      client.setDevConfig({
        templateId: 'typescript',
        slug: 'unsafe-reorder',
        setup: 'instant',
      }),
    ).rejects.toBe(failure);
    expect(sent.filter((frame) => frame.type === 'pty:dev-config')).toHaveLength(2);

    const opening = client.openSession('config-timeout-sibling');
    client.onFrame({ type: 'pty:ready', sid: 'config-timeout-sibling' });
    await expect(opening).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
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

  it('posts exact completion requests and settles two inverted replies by opId', async () => {
    const { client, sent } = harness();
    await openCompletionSession(client, 'completion-order');
    const completer = completionClient(client);
    const firstResult = {
      start: 0,
      end: 2,
      items: [{ value: 'vite ', display: 'vite' }],
    } satisfies ShellCompletionResult;
    const secondResult = {
      start: 0,
      end: 3,
      items: [{ value: 'pwd ', display: 'pwd' }],
    } satisfies ShellCompletionResult;
    const settlementOrder: string[] = [];

    const first = completer.complete('completion-order', 'vi', 2);
    const second = completer.complete('completion-order', 'pwd', 3);
    void first.then(() => settlementOrder.push('first'));
    void second.then(() => settlementOrder.push('second'));

    const frames = completionFrames(sent);
    expect(frames).toHaveLength(2);
    const firstFrame = frames[0]!;
    const secondFrame = frames[1]!;
    expect(firstFrame).toEqual({
      type: 'pty:complete',
      sid: 'completion-order',
      opId: firstFrame.opId,
      line: 'vi',
      cursor: 2,
    });
    expect(secondFrame).toEqual({
      type: 'pty:complete',
      sid: 'completion-order',
      opId: secondFrame.opId,
      line: 'pwd',
      cursor: 3,
    });
    expect(firstFrame.opId).not.toBe(secondFrame.opId);

    const mismatch = captureThrown(() =>
      deliverCompletion(client, {
        type: 'pty:complete-result',
        sid: 'completion-sibling',
        opId: firstFrame.opId,
        ok: true,
        result: firstResult,
      }),
    );
    expectCorrelationMismatch(mismatch, 'pty:complete-result', 'completion-sibling');
    await expect(
      settledOr(
        first.then(() => 'resolved'),
        'pending',
      ),
    ).resolves.toBe('pending');

    deliverCompletion(client, {
      type: 'pty:complete-result',
      sid: secondFrame.sid,
      opId: secondFrame.opId,
      ok: true,
      result: secondResult,
    });
    await expect(second).resolves.toEqual(secondResult);
    expect(settlementOrder).toEqual(['second']);

    deliverCompletion(client, {
      type: 'pty:complete-result',
      sid: firstFrame.sid,
      opId: firstFrame.opId,
      ok: true,
      result: firstResult,
    });
    await expect(first).resolves.toEqual(firstResult);
    expect(settlementOrder).toEqual(['second', 'first']);
  });

  it('rejects completion with the exact owner error instead of publishing an empty result', async () => {
    const { client, sent } = harness();
    await openCompletionSession(client, 'completion-error');
    const pending = completionClient(client).complete('completion-error', './private/', 10);
    const frame = completionFrames(sent)[0]!;

    deliverCompletion(client, {
      type: 'pty:complete-result',
      sid: frame.sid,
      opId: frame.opId,
      ok: false,
      error: 'owner completion readdir failed exactly',
    });

    await expect(pending).rejects.toMatchObject({
      message: 'owner completion readdir failed exactly',
    });
  });

  it('bounds completion, ignores its late result, and admits the next request', async () => {
    vi.useFakeTimers();
    const { client, sent } = harness();
    await openCompletionSession(client, 'completion-timeout');
    const completer = completionClient(client);
    const first = completer.complete('completion-timeout', 'vi', 2);
    const firstFrame = completionFrames(sent)[0]!;
    let failure: unknown;
    void first.catch((error: unknown) => {
      failure = error;
    });

    await vi.advanceTimersByTimeAsync(ACK_TIMEOUT_MS + 1);

    expect(failure).toEqual(
      expect.objectContaining({
        name: 'PtyAckTimeoutError',
        message: expect.stringMatching(/pty:complete-result.*completion-timeout.*60000ms/i),
      }),
    );
    deliverCompletion(client, {
      type: 'pty:complete-result',
      sid: firstFrame.sid,
      opId: firstFrame.opId,
      ok: true,
      result: null,
    });

    const second = completer.complete('completion-timeout', 'vit', 3);
    const secondFrame = completionFrames(sent)[1]!;
    const result = {
      start: 0,
      end: 3,
      items: [{ value: 'vite ', display: 'vite' }],
    } satisfies ShellCompletionResult;
    deliverCompletion(client, {
      type: 'pty:complete-result',
      sid: secondFrame.sid,
      opId: secondFrame.opId,
      ok: true,
      result,
    });

    await expect(second).resolves.toEqual(result);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['disconnect', 'close'] as const)(
    '%s rejects pending and future completion without posting a doomed request',
    async (settlement) => {
      const { client, sent } = harness();
      await openCompletionSession(client, `completion-${settlement}`);
      const completer = completionClient(client);
      const pending = completer.complete(`completion-${settlement}`, 'vi', 2);
      const outcome = pending.then(
        () => 'resolved' as const,
        (error: unknown) => error,
      );

      if (settlement === 'disconnect') {
        const cause = new Error('exact completion owner disconnect');
        client.disconnect(cause);
        await expect(outcome).resolves.toBe(cause);
        await expect(completer.complete('completion-disconnect', 'vit', 3)).rejects.toBe(cause);
      } else {
        const cause = new Error('project terminal close started exactly');
        const closing = client.closeSession('completion-close', cause);
        await expect(outcome).resolves.toBe(cause);
        const closeFrame = sent.find(
          (frame): frame is Extract<PageToOwnerFrame, { type: 'pty:close' }> =>
            frame.type === 'pty:close',
        )!;
        client.onFrame({
          type: 'pty:close-ack',
          sid: closeFrame.sid,
          opId: closeFrame.opId,
          ok: true,
        });
        await closing;
        await expect(completer.complete('completion-close', 'vit', 3)).rejects.toThrow(
          /ClosedHandleError.*closed/i,
        );
      }

      expect(completionFrames(sent)).toHaveLength(1);
    },
  );
});
