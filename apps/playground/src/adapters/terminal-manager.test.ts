import { describe, expect, it, vi } from 'vitest';
import type { ExecOptions, PtyRunResult, PtySessionSnapshot } from '../glue/pty-client.ts';
import type { WorkspaceOwnerHandle } from '../glue/realVite.ts';
import { createTerminalManager } from './terminal-manager.ts';

interface WriterChunk {
  readonly chunk: string;
  readonly stream: 'stdout' | 'stderr' | undefined;
}

function makeWriter(): {
  write: (chunk: string, stream?: 'stdout' | 'stderr') => void;
  calls: WriterChunk[];
} {
  const calls: WriterChunk[] = [];
  return {
    calls,
    write(chunk: string, stream?: 'stdout' | 'stderr'): void {
      calls.push({ chunk, stream });
    },
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const settledOr = <T>(promise: Promise<T>, pending: T): Promise<T> =>
  Promise.race([promise, new Promise<T>((resolve) => setTimeout(() => resolve(pending), 50))]);

/** Flush microtasks until `count` execs have been recorded (or give up). */
async function waitForExecs(execs: readonly unknown[], count: number): Promise<void> {
  for (let i = 0; i < 50 && execs.length < count; i++) await Promise.resolve();
}

interface ExecCall {
  readonly sid: string;
  readonly line: string;
  readonly opts: ExecOptions;
  readonly rid: string;
  resolve(code: number): void;
}

/**
 * In-memory stand-in for the workspace-owner worker (the external cross-realm
 * boundary — a fake here, not a mock of the unit). Records frames the manager
 * pushes and lets the test drive `exec` completion + per-session cwd/env.
 */
function makeFakeOwner(opts: { readonly root?: string } = {}) {
  const root = opts.root ?? '/workspace';
  const opened: string[] = [];
  const closed: string[] = [];
  const stdin: Array<{ sid: string; rid: string; data: Uint8Array }> = [];
  const stdinEof: Array<{ sid: string; rid: string }> = [];
  const resizes: Array<{ sid: string; rid: string; cols: number; rows: number }> = [];
  const signalled: Array<{ sid: string; rid: string }> = [];
  const writes: Array<{ path: string; content: string }> = [];
  const execs: ExecCall[] = [];
  const snapshots = new Map<string, PtySessionSnapshot>();
  let ridSeq = 0;

  const startExec = (sid: string, line: string, execOpts: ExecOptions): Promise<PtyRunResult> => {
    const rid = `r${++ridSeq}`;
    execOpts.onStart?.(rid);
    const done = deferred<PtyRunResult>();
    execs.push({
      sid,
      line,
      opts: execOpts,
      rid,
      resolve: (code) =>
        done.resolve({
          exitCode: code,
          exit: code === 130 ? { code: null, signal: 'SIGINT' } : { code, signal: null },
        }),
    });
    return done.promise;
  };

  const owner: WorkspaceOwnerHandle = {
    workspaceId: 'ws-test',
    root: '/scratch',
    ready: Promise.resolve(),
    previewOwnerToken: 'ws-test-token',
    snapshotPort: 59124,
    closed: Promise.resolve(null),
    ownerEpoch: 'terminal-manager-test-owner',
    openSession(sid: string): Promise<void> {
      opened.push(sid);
      return Promise.resolve();
    },
    exec(sid: string, line: string, opts: ExecOptions): Promise<number> {
      return startExec(sid, line, opts).then((result) => result.exitCode);
    },
    execResult(sid: string, line: string, opts: ExecOptions): Promise<PtyRunResult> {
      return startExec(sid, line, opts);
    },
    writeStdin(sid: string, rid: string, data: Uint8Array): Promise<void> {
      stdin.push({ sid, rid, data });
      return Promise.resolve();
    },
    endStdin(sid: string, rid: string): Promise<void> {
      stdinEof.push({ sid, rid });
      return Promise.resolve();
    },
    resize(sid: string, rid: string, cols: number, rows: number): Promise<void> {
      resizes.push({ sid, rid, cols, rows });
      return Promise.resolve();
    },
    signal(sid: string, rid: string): void {
      signalled.push({ sid, rid });
    },
    closeSession(sid: string): Promise<void> {
      closed.push(sid);
      return Promise.resolve();
    },
    isAlive(): boolean {
      return true;
    },
    writeFile(path: string, content: string): void {
      writes.push({ path, content });
    },
    writeFrame(): void {},
    writeFrameAcked(): Promise<void> {
      return Promise.resolve();
    },
    // In-memory fake: no durability tier behind it (memory-backend contract).
    flushDurable(): Promise<void> {
      return Promise.resolve();
    },
    applyHostCommit(): Promise<never> {
      return Promise.reject(new Error('terminal-manager fake does not serve VFS commits'));
    },
    durabilityBarrier(): Promise<never> {
      return Promise.reject(new Error('terminal-manager fake has no durability authority'));
    },
    exportArchive(): Promise<string> {
      return Promise.resolve('{"version":1,"root":"/workspace","files":[]}');
    },
    importArchive(): Promise<void> {
      return Promise.resolve();
    },
    readFileBytes(): Promise<Uint8Array> {
      return Promise.resolve(new Uint8Array());
    },
    snapshot(sid: string): PtySessionSnapshot {
      return snapshots.get(sid) ?? { cwd: root, env: {} };
    },
    onDevServer(): () => void {
      return () => {};
    },
    onPreview(): () => void {
      return () => {};
    },
    requestPreview(): void {},
    setDevConfig(): Promise<void> {
      return Promise.resolve();
    },
    sendTsLsp(): void {},
    onTsLsp(): () => void {
      return () => {};
    },
    close(): void {},
  };

  return {
    owner,
    opened,
    closed,
    stdin,
    stdinEof,
    resizes,
    signalled,
    writes,
    execs,
    snapshots,
  };
}

describe('createTerminalManager (pty port client)', () => {
  it('opens a pty session for the default terminal and any created session', () => {
    const fake = makeFakeOwner();
    const manager = createTerminalManager({ owner: fake.owner });

    expect(manager.sessions()).toHaveLength(1);
    expect(manager.activeSessionId()).toBe('terminal-1');
    expect(fake.opened).toEqual(['terminal-1']);

    const second = manager.createSession('Tests');
    expect(second).toMatchObject({ id: 'terminal-2', title: 'Tests', status: 'idle' });
    expect(fake.opened).toEqual(['terminal-1', 'terminal-2']);

    manager.select(second.id);
    expect(manager.activeSessionId()).toBe(second.id);

    manager.dispose();
  });

  it('does not count named sessions in default terminal titles', () => {
    const fake = makeFakeOwner();
    const manager = createTerminalManager({ owner: fake.owner });

    manager.createSession('Server');
    const nextShell = manager.createSession();

    expect(nextShell.id).toBe('terminal-3');
    expect(nextShell.title).toBe('Terminal 2');

    manager.dispose();
  });

  it('forwards a line to the owner and streams chunks to the session writer', async () => {
    const fake = makeFakeOwner();
    const manager = createTerminalManager({ owner: fake.owner });
    const session = manager.sessions()[0]!;
    const writer = makeWriter();
    manager.attachWriter(session.id, writer.write);

    const run = manager.runLine(session.id, 'echo hi', { cols: 100, rows: 30 });
    await waitForExecs(fake.execs, 1);

    expect(fake.execs).toHaveLength(1);
    const call = fake.execs[0]!;
    expect(call).toMatchObject({ sid: session.id, line: 'echo hi' });
    expect(call.opts).toMatchObject({ cols: 100, rows: 30, isTTY: true });
    expect(manager.snapshot(session.id).status).toBe('running');

    call.opts.onChunk('hi\n', 'stdout');
    call.opts.onChunk('warn\n', 'stderr');
    call.resolve(0);

    await expect(run).resolves.toBe(0);
    expect(writer.calls).toEqual([
      { chunk: 'hi\n', stream: 'stdout' },
      { chunk: 'warn\n', stream: 'stderr' },
    ]);
    expect(manager.snapshot(session.id)).toMatchObject({ status: 'idle', exitCode: 0 });

    manager.dispose();
  });

  it('routes output only to the writer attached to that session', async () => {
    const fake = makeFakeOwner();
    const manager = createTerminalManager({ owner: fake.owner });
    const first = manager.sessions()[0]!;
    const second = manager.createSession('Second');
    const firstWriter = makeWriter();
    const secondWriter = makeWriter();
    manager.attachWriter(first.id, firstWriter.write);
    manager.attachWriter(second.id, secondWriter.write);

    const run = manager.runLine(first.id, 'mark');
    await waitForExecs(fake.execs, 1);
    const call = fake.execs.find((e) => e.sid === first.id)!;
    call.opts.onChunk('stdout\n', 'stdout');
    call.opts.onChunk('stderr\n', 'stderr');
    call.resolve(0);
    await run;

    expect(firstWriter.calls).toEqual([
      { chunk: 'stdout\n', stream: 'stdout' },
      { chunk: 'stderr\n', stream: 'stderr' },
    ]);
    expect(secondWriter.calls).toEqual([]);

    manager.dispose();
  });

  it('does nothing for empty input', async () => {
    const fake = makeFakeOwner();
    const manager = createTerminalManager({ owner: fake.owner });
    const session = manager.sessions()[0]!;

    await expect(manager.runLine(session.id, '   ')).resolves.toBe(0);

    expect(fake.execs).toHaveLength(0);
    expect(manager.snapshot(session.id).status).toBe('idle');

    manager.dispose();
  });

  it('treats empty input as shell Enter while a process is running', async () => {
    const fake = makeFakeOwner();
    const manager = createTerminalManager({ owner: fake.owner });
    const session = manager.sessions()[0]!;
    const writer = makeWriter();
    manager.attachWriter(session.id, writer.write);

    const run = manager.runLine(session.id, 'wait');
    await waitForExecs(fake.execs, 1);

    await expect(manager.runLine(session.id, '')).resolves.toBe(0);

    expect(writer.calls).toEqual([]);
    expect(fake.execs).toHaveLength(1);
    fake.execs[0]!.resolve(0);
    await run;

    manager.dispose();
  });

  it('reads cwd/env from the owner snapshot cache', () => {
    const fake = makeFakeOwner();
    fake.snapshots.set('terminal-1', { cwd: '/work', env: { FOO: 'bar' } });
    const manager = createTerminalManager({ owner: fake.owner });
    const session = manager.sessions()[0]!;

    expect(manager.snapshot(session.id)).toMatchObject({ cwd: '/work', env: { FOO: 'bar' } });

    manager.dispose();
  });

  it('rebinds existing terminal sessions to a respawned owner before the next command', async () => {
    const firstOwner = makeFakeOwner({ root: '/projects/alpha' });
    const manager = createTerminalManager({ owner: firstOwner.owner });
    const first = manager.sessions()[0]!;
    const second = manager.createSession('Second');

    const nextOwner = makeFakeOwner({ root: '/projects/beta' });
    await manager.rebindOwner(nextOwner.owner);

    expect(nextOwner.opened).toEqual([first.id, second.id]);
    expect(manager.snapshot(first.id).cwd).toBe('/projects/beta');

    const run = manager.runLine(first.id, 'pwd');
    await waitForExecs(nextOwner.execs, 1);
    expect(nextOwner.execs[0]).toMatchObject({ sid: first.id, line: 'pwd' });
    nextOwner.execs[0]!.resolve(0);
    await expect(run).resolves.toBe(0);

    manager.dispose();
    expect(nextOwner.closed).toEqual([first.id, second.id]);
  });

  it('retries rebind session open until the respawned owner replies ready', async () => {
    vi.useFakeTimers();
    try {
      const firstOwner = makeFakeOwner({ root: '/projects/alpha' });
      const manager = createTerminalManager({ owner: firstOwner.owner });
      const session = manager.sessions()[0]!;

      const nextOwner = makeFakeOwner({ root: '/projects/beta' });
      const openSession = nextOwner.owner.openSession;
      let attempts = 0;
      nextOwner.owner.openSession = (sid, seed) => {
        attempts += 1;
        if (attempts === 1) return new Promise<void>(() => {});
        return openSession(sid, seed);
      };

      const rebind = manager.rebindOwner(nextOwner.owner);
      await Promise.resolve();
      expect(attempts).toBe(1);

      await vi.advanceTimersByTimeAsync(250);
      await rebind;

      expect(attempts).toBe(2);
      expect(nextOwner.opened).toEqual([session.id]);
      manager.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears a session by writing the ANSI screen + scrollback reset to its writer', () => {
    const fake = makeFakeOwner();
    const manager = createTerminalManager({ owner: fake.owner });
    const session = manager.sessions()[0]!;
    const writer = makeWriter();
    manager.attachWriter(session.id, writer.write);

    manager.clear(session.id);
    expect(writer.calls).toEqual([{ chunk: '\x1b[2J\x1b[3J\x1b[H', stream: 'stdout' }]);

    const second = manager.createSession('Second');
    expect(() => manager.clear(second.id)).not.toThrow();

    manager.dispose();
  });

  it('runs command sequences serially with prompts and stops on first failure', async () => {
    const fake = makeFakeOwner();
    const manager = createTerminalManager({ owner: fake.owner });
    const session = manager.sessions()[0]!;
    const writer = makeWriter();
    manager.attachWriter(session.id, writer.write);

    const run = manager.runSequence(session.id, ['ok', 'fail', 'ok']);
    // Resolve each exec as it arrives: first ok (0), then fail (7) → stop.
    await waitForExecs(fake.execs, 1);
    fake.execs[0]!.opts.onChunk('ok\n', 'stdout');
    fake.execs[0]!.resolve(0);
    await waitForExecs(fake.execs, 2);
    fake.execs[1]!.opts.onChunk('fail\n', 'stderr');
    fake.execs[1]!.resolve(7);

    await expect(run).resolves.toBe(7);
    expect(fake.execs.map((e) => e.line)).toEqual(['ok', 'fail']);
    expect(writer.calls).toEqual([
      { chunk: '$ ok\n', stream: 'stdout' },
      { chunk: 'ok\n', stream: 'stdout' },
      { chunk: '$ fail\n', stream: 'stdout' },
      { chunk: 'fail\n', stream: 'stderr' },
    ]);
    expect(manager.snapshot(session.id).status).toBe('idle');

    manager.dispose();
  });

  it('refuses a second foreground command in the same session while keeping the first stoppable', async () => {
    const fake = makeFakeOwner();
    const manager = createTerminalManager({ owner: fake.owner });
    const session = manager.sessions()[0]!;
    const writer = makeWriter();
    manager.attachWriter(session.id, writer.write);

    const firstRun = manager.runLine(session.id, 'wait');
    await waitForExecs(fake.execs, 1);
    const secondRun = await manager.runLine(session.id, 'echo should-not-run');

    expect(secondRun).toBe(1);
    expect(manager.snapshot(session.id).status).toBe('running');
    expect(writer.calls).toEqual([{ chunk: 'terminal is busy\n', stream: 'stderr' }]);

    manager.stop(session.id);
    expect(fake.signalled).toEqual([{ sid: session.id, rid: fake.execs[0]!.rid }]);
    fake.execs[0]!.resolve(130);
    await expect(firstRun).resolves.toBe(130);
    expect(manager.snapshot(session.id)).toMatchObject({ status: 'idle', exitCode: 130 });

    manager.dispose();
  });

  it('claims the session before deferred owner readiness in the same tick', async () => {
    const fake = makeFakeOwner();
    const ownerReady = deferred<void>();
    fake.owner.openSession = () => ownerReady.promise;
    const manager = createTerminalManager({ owner: fake.owner });
    const session = manager.sessions()[0]!;

    const first = manager.runLine(session.id, 'first');
    const second = manager.runLine(session.id, 'second');
    const outcome = await Promise.race([
      second,
      new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 50)),
    ]);

    try {
      expect(outcome).toBe(1);
    } finally {
      ownerReady.resolve();
      await waitForExecs(fake.execs, 1);
      for (const call of fake.execs) call.resolve(0);
      await Promise.allSettled([first, second]);
      manager.dispose();
    }
    expect(fake.execs).toHaveLength(1);
  });

  it('latches the latest pre-ready resize, queues EOF, and rejects writes after EOF', async () => {
    const fake = makeFakeOwner();
    const ownerReady = deferred<void>();
    const resizeAck = deferred<void>();
    fake.owner.openSession = () => ownerReady.promise;
    fake.owner.resize = (sid, rid, cols, rows) => {
      fake.resizes.push({ sid, rid, cols, rows });
      return resizeAck.promise;
    };
    const manager = createTerminalManager({ owner: fake.owner });
    const session = manager.sessions()[0]!;

    const run = manager.runLine(session.id, 'cat');
    const firstResize = manager.resize(session.id, { cols: 100, rows: 30 });
    const latestResize = manager.resize(session.id, { cols: 132, rows: 43 });
    const eof = manager.endStdin(session.id);
    await expect(manager.writeStdin(session.id, 'late')).rejects.toThrow(
      /StdinClosedError|stdin.*ended/i,
    );
    expect(fake.resizes).toEqual([]);
    expect(fake.stdinEof).toEqual([]);

    ownerReady.resolve();
    await waitForExecs(fake.execs, 1);
    await Promise.resolve();
    await Promise.resolve();
    expect(fake.resizes).toEqual([
      { sid: session.id, rid: fake.execs[0]!.rid, cols: 132, rows: 43 },
    ]);
    expect(fake.stdinEof).toEqual([{ sid: session.id, rid: fake.execs[0]!.rid }]);

    resizeAck.resolve();
    await Promise.all([firstResize, latestResize, eof]);
    fake.execs[0]!.resolve(0);
    await run;
    manager.dispose();
  });

  it('stops a pre-ready run without starting it and rejects every queued control', async () => {
    const fake = makeFakeOwner();
    const ownerReady = deferred<void>();
    fake.owner.openSession = () => ownerReady.promise;
    const manager = createTerminalManager({ owner: fake.owner });
    const session = manager.sessions()[0]!;

    const run = manager.runLine(session.id, 'cat');
    const stdin = manager.writeStdin(session.id, 'queued');
    const eof = manager.endStdin(session.id);
    const resize = manager.resize(session.id, { cols: 120, rows: 40 });
    const runOutcome = run.then(
      (code) => code,
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );
    const controlOutcome = (operation: Promise<void>) =>
      operation.then(
        () => 'resolved' as const,
        (error: unknown) => (error instanceof Error ? error.message : String(error)),
      );

    manager.stop(session.id);
    const outcomes = await Promise.all([
      settledOr(runOutcome, 'pending'),
      settledOr(controlOutcome(stdin), 'pending'),
      settledOr(controlOutcome(eof), 'pending'),
      settledOr(controlOutcome(resize), 'pending'),
    ]);

    try {
      expect(outcomes).toEqual([
        130,
        expect.stringMatching(/stopped/i),
        expect.stringMatching(/stopped/i),
        expect.stringMatching(/stopped/i),
      ]);
      expect(manager.snapshot(session.id)).toMatchObject({ status: 'idle', exitCode: 130 });
    } finally {
      ownerReady.resolve();
      await waitForExecs(fake.execs, 1);
      for (const call of fake.execs) call.resolve(0);
      manager.dispose();
      await Promise.allSettled([run, stdin, eof, resize]);
    }

    expect(fake.execs).toEqual([]);
    expect(fake.stdin).toEqual([]);
    expect(fake.stdinEof).toEqual([]);
    expect(fake.resizes).toEqual([]);
    expect(fake.signalled).toEqual([]);
  });

  it('latches stop after exec claim but before onStart and never flushes queued controls', async () => {
    const fake = makeFakeOwner();
    const execution = deferred<number>();
    let claimed: { sid: string; opts: ExecOptions } | undefined;
    fake.owner.exec = (sid, _line, opts) => {
      claimed = { sid, opts };
      return execution.promise;
    };
    const manager = createTerminalManager({ owner: fake.owner });
    const session = manager.sessions()[0]!;

    const run = manager.runLine(session.id, 'cat');
    await vi.waitFor(() => expect(claimed).toBeDefined());
    const stdin = manager.writeStdin(session.id, 'queued');
    const eof = manager.endStdin(session.id);
    const resize = manager.resize(session.id, { cols: 120, rows: 40 });
    const controlOutcome = (operation: Promise<void>) =>
      operation.then(
        () => 'resolved' as const,
        (error: unknown) => (error instanceof Error ? error.message : String(error)),
      );

    manager.stop(session.id);
    const outcomes = Promise.all([
      controlOutcome(stdin),
      controlOutcome(eof),
      controlOutcome(resize),
    ]);
    claimed!.opts.onStart?.('late-rid');
    await Promise.resolve();

    try {
      expect(await outcomes).toEqual([
        expect.stringMatching(/stopped/i),
        expect.stringMatching(/stopped/i),
        expect.stringMatching(/stopped/i),
      ]);
      expect(fake.signalled).toEqual([{ sid: session.id, rid: 'late-rid' }]);
      expect(fake.stdin).toEqual([]);
      expect(fake.stdinEof).toEqual([]);
      expect(fake.resizes).toEqual([]);
    } finally {
      execution.resolve(130);
      await Promise.allSettled([run, stdin, eof, resize]);
      manager.dispose();
    }
    await expect(run).resolves.toBe(130);
  });

  it('rejects pre-ready control waiters and the claimed run on owner rebind', async () => {
    const firstOwner = makeFakeOwner();
    const firstReady = deferred<void>();
    firstOwner.owner.openSession = () => firstReady.promise;
    const manager = createTerminalManager({ owner: firstOwner.owner });
    const session = manager.sessions()[0]!;
    const run = manager.runLine(session.id, 'cat');
    const stdin = manager.writeStdin(session.id, 'queued');
    const resize = manager.resize(session.id, { cols: 120, rows: 40 });
    const stdinRejected = expect(stdin).rejects.toThrow(/owner rebound/i);
    const resizeRejected = expect(resize).rejects.toThrow(/owner rebound/i);
    const runRejected = expect(run).rejects.toThrow(/owner rebound/i);

    const nextOwner = makeFakeOwner();
    await manager.rebindOwner(nextOwner.owner);
    await Promise.all([stdinRejected, resizeRejected, runRejected]);
    expect(nextOwner.opened).toEqual([session.id]);

    firstReady.resolve();
    manager.dispose();
  });

  it('rejects forwarded ACK waiters on rebind and never sends an old run tail to the new owner', async () => {
    const firstOwner = makeFakeOwner();
    const stdinAck = deferred<void>();
    const resizeAck = deferred<void>();
    firstOwner.owner.writeStdin = (sid, rid, data) => {
      firstOwner.stdin.push({ sid, rid, data });
      return stdinAck.promise;
    };
    firstOwner.owner.resize = (sid, rid, cols, rows) => {
      firstOwner.resizes.push({ sid, rid, cols, rows });
      return resizeAck.promise;
    };
    const manager = createTerminalManager({ owner: firstOwner.owner });
    const session = manager.sessions()[0]!;

    const run = manager.runLine(session.id, 'cat');
    const firstWrite = manager.writeStdin(session.id, 'first');
    const secondWrite = manager.writeStdin(session.id, 'second');
    const resize = manager.resize(session.id, { cols: 120, rows: 40 });
    const outcome = (promise: Promise<void>) =>
      promise.then(
        () => 'resolved' as const,
        (error: unknown) => (error instanceof Error ? error.message : String(error)),
      );
    const firstOutcome = outcome(firstWrite);
    const secondOutcome = outcome(secondWrite);
    const resizeOutcome = outcome(resize);

    await waitForExecs(firstOwner.execs, 1);
    await vi.waitFor(() => {
      expect(firstOwner.stdin).toHaveLength(1);
      expect(firstOwner.resizes).toHaveLength(1);
    });

    const nextOwner = makeFakeOwner();
    await manager.rebindOwner(nextOwner.owner);
    const outcomes = await Promise.all([
      settledOr(firstOutcome, 'pending'),
      settledOr(secondOutcome, 'pending'),
      settledOr(resizeOutcome, 'pending'),
    ]);

    stdinAck.resolve();
    resizeAck.resolve();
    firstOwner.execs[0]!.resolve(0);
    await Promise.allSettled([firstWrite, secondWrite, resize, run]);
    await Promise.resolve();
    try {
      expect(outcomes).toEqual([
        expect.stringMatching(/ClosedHandleError.*owner rebound/i),
        expect.stringMatching(/ClosedHandleError.*owner rebound/i),
        expect.stringMatching(/ClosedHandleError.*owner rebound/i),
      ]);
      expect(nextOwner.stdin).toEqual([]);
      expect(nextOwner.resizes).toEqual([]);
    } finally {
      manager.dispose();
    }
  });

  it('rejects every pre-ready waiter when disposed', async () => {
    const fake = makeFakeOwner();
    const ownerReady = deferred<void>();
    fake.owner.openSession = () => ownerReady.promise;
    const manager = createTerminalManager({ owner: fake.owner });
    const session = manager.sessions()[0]!;
    const run = manager.runLine(session.id, 'cat');
    const stdin = manager.writeStdin(session.id, 'queued');
    const resize = manager.resize(session.id, { cols: 120, rows: 40 });
    const stdinRejected = expect(stdin).rejects.toThrow(/disposed/i);
    const resizeRejected = expect(resize).rejects.toThrow(/disposed/i);
    const runRejected = expect(run).rejects.toThrow(/disposed/i);

    manager.dispose();
    await Promise.all([stdinRejected, resizeRejected, runRejected]);
    ownerReady.resolve();
  });

  it('rejects already-forwarded stdin, EOF, and resize ACK waiters when disposed', async () => {
    const fake = makeFakeOwner();
    const stdinAck = deferred<void>();
    const eofAck = deferred<void>();
    const resizeAck = deferred<void>();
    fake.owner.writeStdin = (sid, rid, data) => {
      fake.stdin.push({ sid, rid, data });
      return stdinAck.promise;
    };
    fake.owner.endStdin = (sid, rid) => {
      fake.stdinEof.push({ sid, rid });
      return eofAck.promise;
    };
    fake.owner.resize = (sid, rid, cols, rows) => {
      fake.resizes.push({ sid, rid, cols, rows });
      return resizeAck.promise;
    };
    const manager = createTerminalManager({ owner: fake.owner });
    const session = manager.sessions()[0]!;
    const run = manager.runLine(session.id, 'cat');
    await waitForExecs(fake.execs, 1);

    const stdin = manager.writeStdin(session.id, 'data');
    const eof = manager.endStdin(session.id);
    const resize = manager.resize(session.id, { cols: 100, rows: 30 });
    const outcome = (promise: Promise<void>) =>
      promise.then(
        () => 'resolved' as const,
        (error: unknown) => (error instanceof Error ? error.message : String(error)),
      );
    const stdinOutcome = outcome(stdin);
    const eofOutcome = outcome(eof);
    const resizeOutcome = outcome(resize);

    manager.dispose();
    const outcomes = await Promise.all([
      settledOr(stdinOutcome, 'pending'),
      settledOr(eofOutcome, 'pending'),
      settledOr(resizeOutcome, 'pending'),
    ]);

    stdinAck.resolve();
    eofAck.resolve();
    resizeAck.resolve();
    fake.execs[0]!.resolve(0);
    await Promise.allSettled([stdin, eof, resize, run]);
    expect(outcomes).toEqual([
      expect.stringMatching(/ClosedHandleError.*disposed/i),
      expect.stringMatching(/ClosedHandleError.*disposed/i),
      expect.stringMatching(/ClosedHandleError.*disposed/i),
    ]);
  });

  it('awaits an idempotent per-session close and preserves its sibling', async () => {
    const fake = makeFakeOwner();
    const closeAck = deferred<void>();
    fake.owner.closeSession = (sid) => {
      fake.closed.push(sid);
      return closeAck.promise;
    };
    const manager = createTerminalManager({ owner: fake.owner });
    const first = manager.sessions()[0]!;
    const second = manager.createSession('Second');
    manager.select(first.id);

    const close = manager.closeSession(first.id);
    expect(manager.closeSession(first.id)).toBe(close);
    expect(manager.sessions().map((session) => session.id)).toEqual([first.id, second.id]);
    closeAck.resolve();
    await close;

    expect(manager.sessions().map((session) => session.id)).toEqual([second.id]);
    expect(manager.activeSessionId()).toBe(second.id);
    expect(manager.snapshot(second.id).status).toBe('idle');
    manager.dispose();
  });

  it('keeps a locally closed session closed when owner close fails', async () => {
    const fake = makeFakeOwner();
    fake.owner.closeSession = () => Promise.reject(new Error('owner close failed'));
    const manager = createTerminalManager({ owner: fake.owner });
    const session = manager.sessions()[0]!;
    const writer = vi.fn();
    manager.attachWriter(session.id, writer);

    const close = manager.closeSession(session.id);
    await expect(close).rejects.toThrow('owner close failed');
    expect(manager.closeSession(session.id)).toBe(close);
    manager.clear(session.id);
    expect(writer).not.toHaveBeenCalled();
    await expect(manager.runLine(session.id, 'echo nope')).rejects.toThrow(/ClosedHandleError/);
    await expect(manager.resize(session.id, { cols: 100, rows: 30 })).rejects.toThrow(
      /ClosedHandleError/,
    );
  });

  it('does not resurrect a locally closed tombstone when the owner is rebound', async () => {
    const firstOwner = makeFakeOwner();
    firstOwner.owner.closeSession = () => Promise.reject(new Error('owner died during close'));
    const manager = createTerminalManager({ owner: firstOwner.owner });
    const closed = manager.sessions()[0]!;
    const sibling = manager.createSession('Sibling');
    await expect(manager.closeSession(closed.id)).rejects.toThrow('owner died during close');

    const nextOwner = makeFakeOwner();
    await manager.rebindOwner(nextOwner.owner);

    expect(nextOwner.opened).toEqual([sibling.id]);
    await expect(manager.runLine(closed.id, 'echo resurrected')).rejects.toThrow(
      /ClosedHandleError/,
    );
    manager.dispose();
    expect(nextOwner.closed).toEqual([sibling.id]);
  });

  it('runs a new foreground command after a non-zero command exits', async () => {
    const fake = makeFakeOwner();
    const manager = createTerminalManager({ owner: fake.owner });
    const session = manager.sessions()[0]!;

    const firstRun = manager.runLine(session.id, 'false');
    await waitForExecs(fake.execs, 1);
    fake.execs[0]!.resolve(1);
    await expect(firstRun).resolves.toBe(1);
    expect(manager.snapshot(session.id)).toMatchObject({ status: 'idle', exitCode: 1 });

    const secondRun = manager.runLine(session.id, 'echo after');
    await waitForExecs(fake.execs, 2);
    expect(fake.execs.map((e) => e.line)).toEqual(['false', 'echo after']);
    expect(fake.execs[1]!.rid).not.toBe(fake.execs[0]!.rid);
    fake.execs[1]!.resolve(0);
    await expect(secondRun).resolves.toBe(0);
    expect(manager.snapshot(session.id)).toMatchObject({ status: 'idle', exitCode: 0 });

    manager.dispose();
  });

  it('forwards raw terminal input to the active run stdin', async () => {
    const fake = makeFakeOwner();
    const manager = createTerminalManager({ owner: fake.owner });
    const session = manager.sessions()[0]!;

    const run = manager.runLine(session.id, 'read');
    await waitForExecs(fake.execs, 1);
    manager.writeStdin(session.id, 'typed input');

    expect(fake.stdin).toEqual([
      { sid: session.id, rid: fake.execs[0]!.rid, data: new TextEncoder().encode('typed input') },
    ]);

    fake.execs[0]!.resolve(0);
    await run;
    // After the run ends there's no active rid — stdin is dropped silently.
    manager.writeStdin(session.id, 'late');
    expect(fake.stdin).toHaveLength(1);

    manager.dispose();
  });

  it('closes every pty session on dispose and throws for post-dispose methods', async () => {
    const fake = makeFakeOwner();
    const manager = createTerminalManager({ owner: fake.owner });
    const session = manager.sessions()[0]!;
    manager.createSession('Second');

    manager.dispose();
    manager.dispose();
    expect(fake.closed).toEqual(['terminal-1', 'terminal-2']);

    expect(() => manager.sessions()).toThrow('Terminal manager is disposed');
    expect(() => manager.snapshot(session.id)).toThrow('Terminal manager is disposed');
    expect(() => manager.activeSessionId()).toThrow('Terminal manager is disposed');
    expect(() => manager.createSession('Later')).toThrow('Terminal manager is disposed');
    expect(() => manager.select(session.id)).toThrow('Terminal manager is disposed');
    expect(() => manager.attachWriter(session.id, () => {})).toThrow(
      'Terminal manager is disposed',
    );
    expect(() => manager.clear(session.id)).toThrow('Terminal manager is disposed');
    expect(() => manager.writeStdin(session.id, 'x')).toThrow('Terminal manager is disposed');
    expect(() => manager.stop(session.id)).toThrow('Terminal manager is disposed');
    await expect(manager.runLine(session.id, 'echo nope')).rejects.toThrow(
      'Terminal manager is disposed',
    );
    await expect(manager.runSequence(session.id, ['echo nope'])).rejects.toThrow(
      'Terminal manager is disposed',
    );
  });

  it('throws for unknown session snapshot and stop', () => {
    const fake = makeFakeOwner();
    const manager = createTerminalManager({ owner: fake.owner });

    expect(() => manager.snapshot('missing')).toThrow('Unknown terminal session: missing');
    expect(() => manager.stop('missing')).toThrow('Unknown terminal session: missing');

    manager.dispose();
  });
});
