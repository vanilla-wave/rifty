import type { ShellCommand } from '@riftydev/shell';
import { describe, expect, it } from 'vitest';
import { type TerminalCommand, createTerminalManager } from './terminal-manager.ts';

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

describe('createTerminalManager', () => {
  it('starts with one default active session and can select a created session', () => {
    const manager = createTerminalManager({ cwd: '/workspace' });

    const initial = manager.sessions();
    expect(initial).toHaveLength(1);
    expect(initial[0]).toMatchObject({
      id: 'terminal-1',
      title: 'Terminal 1',
      cwd: '/workspace',
      status: 'idle',
    });
    expect(manager.activeSessionId()).toBe(initial[0]?.id);

    const second = manager.createSession('Tests');
    expect(second).toMatchObject({
      id: 'terminal-2',
      title: 'Tests',
      cwd: '/workspace',
      status: 'idle',
    });
    expect(manager.sessions().map((session) => session.id)).toEqual(['terminal-1', 'terminal-2']);

    manager.select(second.id);
    expect(manager.activeSessionId()).toBe(second.id);

    manager.dispose();
  });

  it('does not count named sessions in default terminal titles', () => {
    const manager = createTerminalManager({ cwd: '/workspace' });

    manager.createSession('Server');
    const nextShell = manager.createSession();

    expect(nextShell.id).toBe('terminal-3');
    expect(nextShell.title).toBe('Terminal 2');

    manager.dispose();
  });

  it('passes the owning terminal session id to registered commands', async () => {
    const seen: string[] = [];
    const inspect: TerminalCommand = async (_args, ctx) => {
      seen.push(ctx.sessionId);
      return 0;
    };
    const manager = createTerminalManager({ cwd: '/', commands: { inspect } });
    const second = manager.createSession('Second');

    await expect(manager.runLine(second.id, 'inspect')).resolves.toBe(0);

    expect(seen).toEqual([second.id]);

    manager.dispose();
  });

  it('routes output only to the writer attached to that session', async () => {
    const manager = createTerminalManager({
      cwd: '/',
      commands: {
        mark: async (_args, ctx) => {
          ctx.stdout.write('stdout\n');
          ctx.stderr.write('stderr\n');
          return 0;
        },
      },
    });
    const first = manager.sessions()[0]!;
    const second = manager.createSession('Second');
    const firstWriter = makeWriter();
    const secondWriter = makeWriter();
    manager.attachWriter(first.id, firstWriter.write);
    manager.attachWriter(second.id, secondWriter.write);

    await manager.runLine(first.id, 'mark');

    expect(firstWriter.calls).toEqual([
      { chunk: 'stdout\n', stream: 'stdout' },
      { chunk: 'stderr\n', stream: 'stderr' },
    ]);
    expect(secondWriter.calls).toEqual([]);

    manager.dispose();
  });

  it('does nothing for empty input', async () => {
    const manager = createTerminalManager({ cwd: '/' });
    const session = manager.sessions()[0]!;
    const writer = makeWriter();
    manager.attachWriter(session.id, writer.write);

    await expect(manager.runLine(session.id, '   ')).resolves.toBe(0);

    expect(writer.calls).toEqual([]);
    expect(manager.snapshot(session.id).status).toBe('idle');

    manager.dispose();
  });

  it('runs command sequences serially with visible prompts and stops on first failure', async () => {
    const seen: string[] = [];
    const manager = createTerminalManager({
      cwd: '/',
      commands: {
        ok: async (_args, ctx) => {
          seen.push('ok');
          ctx.stdout.write('ok\n');
          return 0;
        },
        fail: async (_args, ctx) => {
          seen.push('fail');
          ctx.stderr.write('fail\n');
          return 7;
        },
      },
    });
    const session = manager.sessions()[0]!;
    const writer = makeWriter();
    manager.attachWriter(session.id, writer.write);

    await expect(manager.runSequence(session.id, ['ok', 'fail', 'ok'])).resolves.toBe(7);

    expect(seen).toEqual(['ok', 'fail']);
    expect(writer.calls).toEqual([
      { chunk: '$ ok\n', stream: 'stdout' },
      { chunk: 'ok\n', stream: 'stdout' },
      { chunk: '$ fail\n', stream: 'stdout' },
      { chunk: 'fail\n', stream: 'stderr' },
    ]);
    expect(manager.snapshot(session.id).status).toBe('idle');

    manager.dispose();
  });

  it('aborts the active command for a session without affecting idle sessions', async () => {
    const started = deferred<void>();
    const manager = createTerminalManager({
      cwd: '/',
      commands: {
        wait: async (_args, ctx) => {
          started.resolve();
          return await new Promise<number>((resolve) => {
            ctx.signal?.addEventListener('abort', () => resolve(130), { once: true });
          });
        },
      },
    });
    const session = manager.sessions()[0]!;
    const other = manager.createSession('Other');

    const run = manager.runLine(session.id, 'wait');
    await started.promise;

    expect(manager.snapshot(session.id).status).toBe('running');
    expect(manager.snapshot(other.id).status).toBe('idle');

    manager.stop(other.id);
    expect(manager.snapshot(session.id).status).toBe('running');

    manager.stop(session.id);
    await expect(run).resolves.toBe(130);
    expect(manager.snapshot(session.id)).toMatchObject({ status: 'idle', exitCode: 130 });

    manager.dispose();
  });

  it('runs commands in different sessions concurrently', async () => {
    const starts: string[] = [];
    const gates = new Map<string, ReturnType<typeof deferred<number>>>();
    const gate: ShellCommand = async (_args, ctx) => {
      const id = `run-${starts.length + 1}`;
      starts.push(id);
      ctx.stdout.write(`${id}:start\n`);
      const done = deferred<number>();
      gates.set(id, done);
      const exitCode = await done.promise;
      ctx.stdout.write(`${id}:done\n`);
      return exitCode;
    };
    const manager = createTerminalManager({ cwd: '/', commands: { gate } });
    const first = manager.sessions()[0]!;
    const second = manager.createSession('Second');
    const firstWriter = makeWriter();
    const secondWriter = makeWriter();
    manager.attachWriter(first.id, firstWriter.write);
    manager.attachWriter(second.id, secondWriter.write);

    const firstRun = manager.runLine(first.id, 'gate');
    const secondRun = manager.runLine(second.id, 'gate');

    expect(starts).toEqual(['run-1', 'run-2']);
    expect(manager.snapshot(first.id).status).toBe('running');
    expect(manager.snapshot(second.id).status).toBe('running');

    gates.get('run-2')?.resolve(0);
    await expect(secondRun).resolves.toBe(0);
    expect(manager.snapshot(second.id).status).toBe('idle');
    expect(manager.snapshot(first.id).status).toBe('running');

    gates.get('run-1')?.resolve(0);
    await expect(firstRun).resolves.toBe(0);

    expect(firstWriter.calls.map((call) => call.chunk)).toEqual(['run-1:start\n', 'run-1:done\n']);
    expect(secondWriter.calls.map((call) => call.chunk)).toEqual(['run-2:start\n', 'run-2:done\n']);

    manager.dispose();
  });

  it('runs registered commands through shell parsing with args, cwd, and env overrides', async () => {
    const observed: Array<{ args: string[]; cwd: string; foo: string | undefined }> = [];
    const inspect: ShellCommand = async (args, ctx) => {
      observed.push({ args, cwd: ctx.cwd, foo: ctx.env.FOO });
      ctx.stdout.write(`${ctx.cwd}:${args.join(',')}:${ctx.env.FOO ?? ''}\n`);
      return 0;
    };
    const manager = createTerminalManager({ cwd: '/', commands: { inspect } });
    const session = manager.sessions()[0]!;
    const writer = makeWriter();
    manager.attachWriter(session.id, writer.write);

    await expect(manager.runLine(session.id, 'inspect one two')).resolves.toBe(0);
    await expect(
      manager.runLine(session.id, 'mkdir -p /x && cd /x && inspect after-cd'),
    ).resolves.toBe(0);
    await expect(manager.runLine(session.id, 'FOO=bar inspect with-env')).resolves.toBe(0);

    expect(observed).toEqual([
      { args: ['one', 'two'], cwd: '/', foo: undefined },
      { args: ['after-cd'], cwd: '/x', foo: undefined },
      { args: ['with-env'], cwd: '/x', foo: 'bar' },
    ]);
    expect(writer.calls.map((call) => call.chunk).join('')).toBe(
      '/:one,two:\n/x:after-cd:\n/x:with-env:bar\n',
    );

    manager.dispose();
  });

  it('refuses a second foreground command in the same session while keeping the first stoppable', async () => {
    const started = deferred<void>();
    const wait: ShellCommand = async (_args, ctx) => {
      started.resolve();
      return await new Promise<number>((resolve) => {
        ctx.signal?.addEventListener('abort', () => resolve(130), { once: true });
      });
    };
    const manager = createTerminalManager({ cwd: '/', commands: { wait } });
    const session = manager.sessions()[0]!;
    const writer = makeWriter();
    manager.attachWriter(session.id, writer.write);

    const firstRun = manager.runLine(session.id, 'wait');
    await started.promise;
    const secondRun = await manager.runLine(session.id, 'echo should-not-run');

    expect(secondRun).toBe(1);
    expect(manager.snapshot(session.id).status).toBe('running');
    expect(writer.calls).toEqual([{ chunk: 'terminal is busy\n', stream: 'stderr' }]);

    manager.stop(session.id);
    await expect(firstRun).resolves.toBe(130);
    expect(manager.snapshot(session.id)).toMatchObject({ status: 'idle', exitCode: 130 });

    manager.dispose();
  });

  it('throws for post-dispose public methods and remains idempotent', async () => {
    const manager = createTerminalManager({ cwd: '/' });
    const session = manager.sessions()[0]!;

    manager.dispose();
    manager.dispose();

    expect(() => manager.sessions()).toThrow('Terminal manager is disposed');
    expect(() => manager.snapshot(session.id)).toThrow('Terminal manager is disposed');
    expect(() => manager.activeSessionId()).toThrow('Terminal manager is disposed');
    expect(() => manager.createSession('Later')).toThrow('Terminal manager is disposed');
    expect(() => manager.select(session.id)).toThrow('Terminal manager is disposed');
    expect(() => manager.attachWriter(session.id, () => {})).toThrow(
      'Terminal manager is disposed',
    );
    expect(() => manager.stop(session.id)).toThrow('Terminal manager is disposed');
    await expect(manager.runLine(session.id, 'echo nope')).rejects.toThrow(
      'Terminal manager is disposed',
    );
    await expect(manager.runSequence(session.id, ['echo nope'])).rejects.toThrow(
      'Terminal manager is disposed',
    );
  });

  it('throws for unknown session snapshot and stop', () => {
    const manager = createTerminalManager({ cwd: '/' });

    expect(() => manager.snapshot('missing')).toThrow('Unknown terminal session: missing');
    expect(() => manager.stop('missing')).toThrow('Unknown terminal session: missing');

    manager.dispose();
  });

  it('returns idle status after a registered command rejects', async () => {
    const manager = createTerminalManager({
      cwd: '/',
      commands: {
        explode: async () => {
          throw new Error('boom');
        },
      },
    });
    const session = manager.sessions()[0]!;

    await expect(manager.runLine(session.id, 'explode')).rejects.toThrow('boom');
    expect(manager.snapshot(session.id).status).toBe('idle');

    manager.dispose();
  });

  it('does not let a stopped command late rejection poison a later run', async () => {
    const aStarted = deferred<void>();
    const bStarted = deferred<void>();
    const finishB = deferred<number>();
    let rejectA!: (reason: Error) => void;
    const a: ShellCommand = async () => {
      aStarted.resolve();
      return await new Promise<number>((_resolve, reject) => {
        rejectA = reject;
      });
    };
    const b: ShellCommand = async (_args, ctx) => {
      bStarted.resolve();
      const exitCode = await finishB.promise;
      ctx.stdout.write('b done\n');
      return exitCode;
    };
    const manager = createTerminalManager({ cwd: '/', commands: { a, b } });
    const session = manager.sessions()[0]!;
    const writer = makeWriter();
    manager.attachWriter(session.id, writer.write);

    const firstRun = manager.runLine(session.id, 'a');
    await aStarted.promise;
    manager.stop(session.id);
    await expect(firstRun).resolves.toBe(130);

    const secondRun = manager.runLine(session.id, 'b');
    await bStarted.promise;
    rejectA(new Error('late a rejection'));
    await Promise.resolve();
    finishB.resolve(0);

    await expect(secondRun).resolves.toBe(0);
    expect(manager.snapshot(session.id)).toMatchObject({ status: 'idle', exitCode: 0 });
    expect(writer.calls).toEqual([{ chunk: 'b done\n', stream: 'stdout' }]);

    manager.dispose();
  });

  it('falls back to the per-session shell when no registered command matches', async () => {
    const manager = createTerminalManager({ cwd: '/' });
    const session = manager.sessions()[0]!;
    const writer = makeWriter();
    manager.attachWriter(session.id, writer.write);

    await expect(manager.runLine(session.id, 'echo hello')).resolves.toBe(0);
    await expect(manager.runLine(session.id, 'definitely-not-real')).resolves.toBe(127);

    expect(writer.calls).toEqual([
      { chunk: 'hello\n', stream: 'stdout' },
      { chunk: 'definitely-not-real: command not found\n', stream: 'stderr' },
    ]);
    expect(manager.snapshot(session.id)).toMatchObject({ status: 'idle', exitCode: 127 });

    manager.dispose();
  });
});
