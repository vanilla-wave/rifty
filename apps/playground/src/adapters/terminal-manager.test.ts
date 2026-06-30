import { describe, expect, it, vi } from 'vitest';
import type { ExecOptions, PtySessionSnapshot } from '../glue/pty-client.ts';
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
  const signalled: Array<{ sid: string; rid: string }> = [];
  const writes: Array<{ path: string; content: string }> = [];
  const execs: ExecCall[] = [];
  const snapshots = new Map<string, PtySessionSnapshot>();
  let ridSeq = 0;

  const owner: WorkspaceOwnerHandle = {
    workspaceId: 'ws-test',
    root: '/scratch',
    ready: Promise.resolve(),
    previewOwnerToken: 'ws-test-token',
    snapshotPort: 59124,
    closed: Promise.resolve(null),
    openSession(sid: string): Promise<void> {
      opened.push(sid);
      return Promise.resolve();
    },
    exec(sid: string, line: string, opts: ExecOptions): Promise<number> {
      const rid = `r${++ridSeq}`;
      opts.onStart?.(rid);
      const done = deferred<number>();
      execs.push({ sid, line, opts, rid, resolve: done.resolve });
      return done.promise;
    },
    writeStdin(sid: string, rid: string, data: Uint8Array): void {
      stdin.push({ sid, rid, data });
    },
    signal(sid: string, rid: string): void {
      signalled.push({ sid, rid });
    },
    closeSession(sid: string): void {
      closed.push(sid);
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

  return { owner, opened, closed, stdin, signalled, writes, execs, snapshots };
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
