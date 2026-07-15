import type { ProcessExit } from '@riftydev/shell';
import { describe, expect, it } from 'vitest';

import {
  ClosedHandleError,
  ProjectBusyError,
  StdinClosedError,
  createProjectTerminal,
} from './project-terminal.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function settleMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

type ExecOptions = {
  readonly cols: number;
  readonly rows: number;
  readonly isTTY: boolean;
  readonly onChunk: (chunk: string, stream: 'stdout' | 'stderr') => void;
  readonly onStart?: (rid: string) => void;
};

type ExecResult = {
  readonly exitCode: number;
  readonly exit: ProcessExit;
};

type ExecCall = {
  readonly sid: string;
  readonly line: string;
  readonly options: ExecOptions;
  readonly result: ReturnType<typeof deferred<ExecResult>>;
};

type AckCall<T> = T & { readonly ack: ReturnType<typeof deferred<void>> };

/** Owner/PTY transport boundary only; the ProjectTerminal lifecycle is always real. */
class TerminalPortFixture {
  readonly closedGate = deferred<number | null>();
  readonly closed = this.closedGate.promise;
  readonly openCalls: string[] = [];
  readonly execCalls: ExecCall[] = [];
  readonly writeCalls: AckCall<{ sid: string; rid: string; data: Uint8Array }>[] = [];
  readonly eofCalls: AckCall<{ sid: string; rid: string }>[] = [];
  readonly resizeCalls: AckCall<{ sid: string; rid: string; cols: number; rows: number }>[] = [];
  readonly sessionResizeCalls: AckCall<{ sid: string; cols: number; rows: number }>[] = [];
  readonly signalCalls: { sid: string; rid: string }[] = [];
  readonly closeCalls: string[] = [];
  readonly closeFailures = new Map<string, Error>();
  readonly openGates = new Map<string, ReturnType<typeof deferred<void>>>();
  closeGate: ReturnType<typeof deferred<void>> | null = null;
  signalFailure: Error | null = null;
  onSignal: (() => void) | null = null;
  onCloseSession: (() => void) | null = null;
  rejectOpenOnClose = false;
  autoAck = true;
  alive = true;

  isAlive(): boolean {
    return this.alive;
  }

  openSession(sid: string): Promise<void> {
    this.openCalls.push(sid);
    const gate = deferred<void>();
    this.openGates.set(sid, gate);
    return gate.promise;
  }

  resolveOpen(sid: string): void {
    this.openGates.get(sid)?.resolve();
  }

  execResult(sid: string, line: string, options: ExecOptions): Promise<ExecResult> {
    const result = deferred<ExecResult>();
    this.execCalls.push({ sid, line, options, result });
    return result.promise;
  }

  admit(index: number, rid: string): void {
    this.execCalls[index]?.options.onStart?.(rid);
  }

  exit(index: number, exit: ProcessExit, exitCode = exit.code ?? 130): void {
    this.execCalls[index]?.result.resolve({ exitCode, exit });
  }

  writeStdin(sid: string, rid: string, data: Uint8Array): Promise<void> {
    const ack = deferred<void>();
    this.writeCalls.push({ sid, rid, data: data.slice(), ack });
    if (this.autoAck) ack.resolve();
    return ack.promise;
  }

  endStdin(sid: string, rid: string): Promise<void> {
    const ack = deferred<void>();
    this.eofCalls.push({ sid, rid, ack });
    if (this.autoAck) ack.resolve();
    return ack.promise;
  }

  resize(sid: string, rid: string, cols: number, rows: number): Promise<void> {
    const ack = deferred<void>();
    this.resizeCalls.push({ sid, rid, cols, rows, ack });
    if (this.autoAck) ack.resolve();
    return ack.promise;
  }

  resizeSession(sid: string, cols: number, rows: number): Promise<void> {
    const ack = deferred<void>();
    this.sessionResizeCalls.push({ sid, cols, rows, ack });
    if (this.autoAck) ack.resolve();
    return ack.promise;
  }

  signal(sid: string, rid: string): void {
    this.signalCalls.push({ sid, rid });
    this.onSignal?.();
    if (this.signalFailure !== null) throw this.signalFailure;
  }

  closeSession(sid: string, cancellation?: Error): Promise<void> {
    this.closeCalls.push(sid);
    this.onCloseSession?.();
    if (this.rejectOpenOnClose) {
      this.openGates
        .get(sid)
        ?.reject(cancellation ?? new Error(`ClosedHandleError: terminal ${sid} is closing`));
    }
    const failure = this.closeFailures.get(sid);
    return failure ? Promise.reject(failure) : (this.closeGate?.promise ?? Promise.resolve());
  }

  die(code: number | null = null): void {
    this.alive = false;
    this.closedGate.resolve(code);
  }
}

describe('ProjectTerminal lifecycle contract', () => {
  it('awaits owner-ACKed idle dimensions before sending the synchronously claimed run', async () => {
    const port = new TerminalPortFixture();
    port.autoAck = false;
    const terminal = createProjectTerminal({ id: 'terminal-1', port });
    const resized = terminal.resize(100, 30);
    void resized.catch(() => {});
    const run = terminal.run('node sized.mjs');

    expect(port.sessionResizeCalls).toHaveLength(0);
    expect(port.execCalls).toHaveLength(0);
    port.resolveOpen('terminal-1');
    await settleMicrotasks();
    expect(port.sessionResizeCalls).toHaveLength(1);
    expect(port.sessionResizeCalls[0]).toMatchObject({
      sid: 'terminal-1',
      cols: 100,
      rows: 30,
    });
    expect(port.execCalls).toHaveLength(0);

    port.sessionResizeCalls[0]!.ack.resolve();
    await expect(resized).resolves.toBeUndefined();
    await settleMicrotasks();
    expect(port.execCalls).toHaveLength(1);
    expect(port.execCalls[0]).toMatchObject({ options: { cols: 100, rows: 30 } });

    port.admit(0, 'run-1');
    port.exit(0, { code: 0, signal: null });
    await run.close();
    await terminal.close();
  });

  it('rejects a run waiting on failed idle dimensions without sending exec', async () => {
    const port = new TerminalPortFixture();
    port.autoAck = false;
    const terminal = createProjectTerminal({ id: 'terminal-1', port });
    const resized = terminal.resize(100, 30);
    void resized.catch(() => {});
    const run = terminal.run('node must-not-start.mjs');
    port.resolveOpen('terminal-1');
    await settleMicrotasks();
    const failure = new Error('owner idle resize failed exactly');
    port.sessionResizeCalls[0]?.ack.reject(failure);

    await expect(resized).rejects.toBe(failure);
    await expect(run.ready).rejects.toBe(failure);
    await expect(run.exited).rejects.toBe(failure);
    expect(port.execCalls).toEqual([]);
    await expect(run.close()).rejects.toBe(failure);
    await terminal.close();
  });

  it('uses the last positively acknowledged idle dimensions after a later idle NACK', async () => {
    const port = new TerminalPortFixture();
    port.autoAck = false;
    const terminal = createProjectTerminal({ id: 'terminal-1', port });
    port.resolveOpen('terminal-1');
    await settleMicrotasks();

    const accepted = terminal.resize(100, 30);
    await settleMicrotasks();
    port.sessionResizeCalls[0]?.ack.resolve();
    await accepted;
    const rejected = terminal.resize(120, 40);
    await settleMicrotasks();
    port.sessionResizeCalls[1]?.ack.reject(new Error('owner refused later idle size'));
    await expect(rejected).rejects.toThrow('owner refused later idle size');

    const run = terminal.run('node preserved-size.mjs');
    await settleMicrotasks();
    expect(port.execCalls[0]).toMatchObject({ options: { cols: 100, rows: 30 } });
    port.admit(0, 'run-1');
    port.exit(0, { code: 0, signal: null });
    await run.close();
    await terminal.close();
  });

  it('claims synchronously before owner readiness, publishes admission, preserves physical exit, and releases only after run.close', async () => {
    const port = new TerminalPortFixture();
    const terminal = createProjectTerminal({ id: 'terminal-1', port });

    const first = terminal.run('node cli.mjs');
    expect(() => terminal.run('node second.mjs')).toThrowError(ProjectBusyError);
    expect(port.execCalls).toHaveLength(0);

    port.resolveOpen('terminal-1');
    await settleMicrotasks();
    expect(port.execCalls).toHaveLength(1);
    expect(port.execCalls[0]).toMatchObject({
      sid: 'terminal-1',
      line: 'node cli.mjs',
      options: { cols: 80, rows: 24, isTTY: true },
    });

    let admitted = false;
    void first.ready.then(() => {
      admitted = true;
    });
    await settleMicrotasks();
    expect(admitted).toBe(false);

    port.admit(0, 'run-1');
    await expect(first.ready).resolves.toBeUndefined();
    const exactExit = { code: 7, signal: null } as const;
    port.exit(0, exactExit, 7);
    await expect(first.exited).resolves.toBe(exactExit);

    expect(() => terminal.run('node still-busy.mjs')).toThrowError(ProjectBusyError);
    await expect(first.close()).resolves.toBe(exactExit);

    const second = terminal.run('node reusable.mjs');
    await settleMicrotasks();
    expect(port.execCalls).toHaveLength(2);
    port.admit(1, 'run-2');
    port.exit(1, { code: 0, signal: null });
    await second.close();
    await terminal.close();
  });

  it('closes every run control at physical exit before the handle is released', async () => {
    const port = new TerminalPortFixture();
    const terminal = createProjectTerminal({ id: 'terminal-1', port });
    const run = terminal.run('node short-lived.mjs');
    port.resolveOpen('terminal-1');
    await settleMicrotasks();
    port.admit(0, 'run-1');
    await run.ready;

    const exactExit = { code: 0, signal: null } as const;
    port.exit(0, exactExit);
    await expect(run.exited).resolves.toBe(exactExit);

    await expect(terminal.write('after exit')).rejects.toBeInstanceOf(ClosedHandleError);
    await expect(terminal.end()).rejects.toBeInstanceOf(ClosedHandleError);
    await expect(terminal.resize(100, 30)).rejects.toBeInstanceOf(ClosedHandleError);
    await expect(run.stop()).resolves.toBe(exactExit);
    expect(port.writeCalls).toEqual([]);
    expect(port.eofCalls).toEqual([]);
    expect(port.resizeCalls).toEqual([]);
    expect(port.signalCalls).toEqual([]);

    await expect(run.close()).resolves.toBe(exactExit);
    await terminal.close();
  });

  it('uses session close as the sole cancellation owner before run admission', async () => {
    const port = new TerminalPortFixture();
    port.closeGate = deferred<void>();
    const terminal = createProjectTerminal({ id: 'terminal-1', port });
    const run = terminal.run('node delayed-admission.mjs');
    void run.ready.catch(() => {});
    port.resolveOpen('terminal-1');
    await settleMicrotasks();
    expect(port.execCalls).toHaveLength(1);

    const closing = terminal.close();
    void closing.catch(() => {});
    await settleMicrotasks();
    const closeCallsBeforeExit = [...port.closeCalls];
    const signalsBeforeExit = [...port.signalCalls];

    const exactExit = { code: null, signal: 'SIGINT' } as const;
    port.exit(0, exactExit, 130);
    port.closeGate.resolve();
    await expect(run.ready).rejects.toThrow(/exited before owner run admission/i);
    await expect(run.exited).resolves.toBe(exactExit);
    await expect(closing).resolves.toBeUndefined();

    expect(closeCallsBeforeExit).toEqual(['terminal-1']);
    expect(signalsBeforeExit).toEqual([]);
    expect(port.signalCalls).toEqual([]);
  });

  it('uses session close instead of a duplicate run signal for an admitted run', async () => {
    const port = new TerminalPortFixture();
    port.closeGate = deferred<void>();
    const terminal = createProjectTerminal({ id: 'terminal-1', port });
    const run = terminal.run('node admitted.mjs');
    port.resolveOpen('terminal-1');
    await settleMicrotasks();
    port.admit(0, 'run-1');
    await run.ready;

    const closing = terminal.close();
    await settleMicrotasks();
    expect(port.closeCalls).toEqual(['terminal-1']);
    expect(port.signalCalls).toEqual([]);

    const exactExit = { code: null, signal: 'SIGINT' } as const;
    port.exit(0, exactExit, 130);
    port.closeGate.resolve();
    await expect(run.exited).resolves.toBe(exactExit);
    await expect(run.close()).resolves.toBe(exactExit);
    await expect(closing).resolves.toBeUndefined();
    expect(port.signalCalls).toEqual([]);
  });

  it('cancels a run loudly but resolves successful terminal close before owner open', async () => {
    const port = new TerminalPortFixture();
    port.closeGate = deferred<void>();
    port.rejectOpenOnClose = true;
    const terminal = createProjectTerminal({ id: 'terminal-1', port });
    const run = terminal.run('node never-sent.mjs');
    void run.ready.catch(() => {});
    void run.exited.catch(() => {});

    const closing = terminal.close();
    void closing.catch(() => {});
    await settleMicrotasks();
    expect(port.execCalls).toEqual([]);
    expect(port.closeCalls).toEqual(['terminal-1']);
    port.closeGate.resolve();

    await expect(run.ready).rejects.toBeInstanceOf(ClosedHandleError);
    await expect(run.exited).rejects.toBeInstanceOf(ClosedHandleError);
    await expect(closing).resolves.toBeUndefined();
  });

  it('rejects terminal close when owner session cancellation fails before open', async () => {
    const port = new TerminalPortFixture();
    const ownerFailure = new Error('owner close NACK');
    port.closeFailures.set('terminal-1', ownerFailure);
    const terminal = createProjectTerminal({ id: 'terminal-1', port });
    const run = terminal.run('node never-sent.mjs');
    void run.ready.catch(() => {});
    void run.exited.catch(() => {});

    const closing = terminal.close();

    await expect(run.ready).rejects.toBe(ownerFailure);
    await expect(run.exited).rejects.toBe(ownerFailure);
    await expect(closing).rejects.toBe(ownerFailure);
  });

  it('preserves an owner open failure already rejected before close in the same tick', async () => {
    const port = new TerminalPortFixture();
    const terminal = createProjectTerminal({ id: 'terminal-1', port });
    const run = terminal.run('node never-sent.mjs');
    void run.ready.catch(() => {});
    void run.exited.catch(() => {});
    const ownerFailure = new Error('owner open failed exactly');

    port.openGates.get('terminal-1')!.reject(ownerFailure);
    const closing = terminal.close();

    await expect(run.ready).rejects.toBe(ownerFailure);
    await expect(run.exited).rejects.toBe(ownerFailure);
    await expect(closing).rejects.toBe(ownerFailure);
    expect(port.closeCalls).toEqual(['terminal-1']);
  });

  it('forwards pre-admission bytes and EOF in call order, makes EOF idempotent, and rejects writes after EOF', async () => {
    const port = new TerminalPortFixture();
    port.autoAck = false;
    const terminal = createProjectTerminal({ id: 'terminal-1', port });
    const run = terminal.run('node echo.mjs');

    const firstWrite = terminal.write('first');
    const secondWrite = terminal.write(new Uint8Array([0, 255, 1]));
    const firstEnd = terminal.end();
    const secondEnd = terminal.end();
    expect(secondEnd).toBe(firstEnd);
    await expect(terminal.write('late')).rejects.toBeInstanceOf(StdinClosedError);
    expect(port.writeCalls).toHaveLength(0);
    expect(port.eofCalls).toHaveLength(0);

    port.resolveOpen('terminal-1');
    await settleMicrotasks();
    port.admit(0, 'run-1');
    await run.ready;
    await settleMicrotasks();

    expect(port.writeCalls).toHaveLength(1);
    expect(new TextDecoder().decode(port.writeCalls[0]!.data)).toBe('first');
    expect(port.eofCalls).toHaveLength(0);

    port.writeCalls[0]!.ack.resolve();
    await settleMicrotasks();
    await expect(firstWrite).resolves.toBeUndefined();
    expect(port.writeCalls).toHaveLength(2);
    expect([...port.writeCalls[1]!.data]).toEqual([0, 255, 1]);
    expect(port.eofCalls).toHaveLength(0);

    port.writeCalls[1]!.ack.resolve();
    await settleMicrotasks();
    await expect(secondWrite).resolves.toBeUndefined();
    expect(port.eofCalls).toHaveLength(1);

    port.eofCalls[0]!.ack.resolve();
    await expect(firstEnd).resolves.toBeUndefined();
    await expect(secondEnd).resolves.toBeUndefined();
    expect(port.eofCalls).toHaveLength(1);

    port.exit(0, { code: 0, signal: null });
    await run.close();
    await terminal.close();
  });

  it('latches only the latest pre-admission size and serializes every live resize by ACK order', async () => {
    const port = new TerminalPortFixture();
    port.autoAck = false;
    const terminal = createProjectTerminal({ id: 'terminal-1', port });
    const run = terminal.run('node tty.mjs');

    const preReadyA = terminal.resize(90, 30);
    const preReadyB = terminal.resize(120, 40);
    expect(port.resizeCalls).toHaveLength(0);

    port.resolveOpen('terminal-1');
    await settleMicrotasks();
    port.admit(0, 'run-1');
    await run.ready;
    await settleMicrotasks();
    expect(port.resizeCalls).toHaveLength(1);
    expect(port.resizeCalls[0]).toMatchObject({
      sid: 'terminal-1',
      rid: 'run-1',
      cols: 120,
      rows: 40,
    });

    port.resizeCalls[0]!.ack.resolve();
    await expect(Promise.all([preReadyA, preReadyB])).resolves.toEqual([undefined, undefined]);

    const liveA = terminal.resize(130, 41);
    const liveB = terminal.resize(140, 42);
    await settleMicrotasks();
    expect(port.resizeCalls).toHaveLength(2);
    expect(port.resizeCalls[1]).toMatchObject({ cols: 130, rows: 41 });

    port.resizeCalls[1]!.ack.resolve();
    await settleMicrotasks();
    await expect(liveA).resolves.toBeUndefined();
    expect(port.resizeCalls).toHaveLength(3);
    expect(port.resizeCalls[2]).toMatchObject({ cols: 140, rows: 42 });

    port.resizeCalls[2]!.ack.resolve();
    await expect(liveB).resolves.toBeUndefined();
    port.exit(0, { code: 0, signal: null });
    await run.close();

    const inherited = terminal.run('node inherited-size.mjs');
    await settleMicrotasks();
    expect(port.execCalls[1]).toMatchObject({ options: { cols: 140, rows: 42 } });
    port.admit(1, 'run-2');
    port.exit(1, { code: 0, signal: null });
    await inherited.close();
    await terminal.close();
  });

  it('does not advance next-run dimensions after a failed live resize', async () => {
    const port = new TerminalPortFixture();
    port.autoAck = false;
    const terminal = createProjectTerminal({ id: 'terminal-1', port });
    const first = terminal.run('node first.mjs');
    port.resolveOpen('terminal-1');
    await settleMicrotasks();
    port.admit(0, 'run-1');
    await first.ready;

    const failedResize = terminal.resize(120, 40);
    await settleMicrotasks();
    const failure = new Error('live resize failed exactly');
    port.resizeCalls[0]?.ack.reject(failure);
    await expect(failedResize).rejects.toBe(failure);
    port.exit(0, { code: 0, signal: null });
    await first.close();

    const second = terminal.run('node second.mjs');
    await settleMicrotasks();
    expect(port.execCalls[1]).toMatchObject({ options: { cols: 80, rows: 24 } });
    port.admit(1, 'run-2');
    port.exit(1, { code: 0, signal: null });
    await second.close();
    await terminal.close();
  });

  it('makes stop and close idempotent with the same exact exit outcome and rejects controls after terminal close', async () => {
    const port = new TerminalPortFixture();
    const terminal = createProjectTerminal({ id: 'terminal-1', port });
    const run = terminal.run('node long-running.mjs');
    port.resolveOpen('terminal-1');
    await settleMicrotasks();
    port.admit(0, 'run-1');
    await run.ready;

    const stopA = run.stop();
    const stopB = run.stop();
    expect(stopB).toBe(stopA);
    expect(port.signalCalls).toEqual([{ sid: 'terminal-1', rid: 'run-1' }]);

    const exactExit = { code: null, signal: 'SIGINT' } as const;
    port.exit(0, exactExit, 130);
    await expect(stopA).resolves.toBe(exactExit);

    const closeA = run.close();
    const closeB = run.close();
    expect(closeB).toBe(closeA);
    await expect(closeA).resolves.toBe(exactExit);
    await expect(closeB).resolves.toBe(exactExit);
    expect(port.signalCalls).toHaveLength(1);

    const terminalCloseA = terminal.close();
    const terminalCloseB = terminal.close();
    expect(terminalCloseB).toBe(terminalCloseA);
    await terminalCloseA;
    expect(port.closeCalls).toEqual(['terminal-1']);
    await expect(terminal.write('closed')).rejects.toBeInstanceOf(ClosedHandleError);
    await expect(terminal.end()).rejects.toBeInstanceOf(ClosedHandleError);
    await expect(terminal.resize(80, 24)).rejects.toBeInstanceOf(ClosedHandleError);
    expect(() => terminal.run('node closed.mjs')).toThrowError(ClosedHandleError);
  });

  it('reserves stop and run-close identity before a reentrant signal callback', async () => {
    const port = new TerminalPortFixture();
    const terminal = createProjectTerminal({ id: 'terminal-1', port });
    const run = terminal.run('node reentrant-stop.mjs');
    port.resolveOpen('terminal-1');
    await settleMicrotasks();
    port.admit(0, 'run-1');
    await run.ready;

    let reentrantStop: Promise<ProcessExit> | null = null;
    let reentrantClose: Promise<ProcessExit> | null = null;
    port.onSignal = () => {
      reentrantStop = run.stop();
      reentrantClose = run.close();
    };
    const closing = run.close();

    expect(reentrantStop).toBe(run.stop());
    expect(reentrantClose).toBe(closing);
    expect(port.signalCalls).toEqual([{ sid: 'terminal-1', rid: 'run-1' }]);
    port.exit(0, { code: null, signal: 'SIGINT' }, 130);
    await expect(closing).resolves.toEqual({ code: null, signal: 'SIGINT' });
    await terminal.close();
  });

  it('reserves terminal-close identity before a reentrant owner close callback', async () => {
    const port = new TerminalPortFixture();
    const terminal = createProjectTerminal({ id: 'terminal-1', port });
    port.resolveOpen('terminal-1');
    await settleMicrotasks();

    let reentrantClose: Promise<void> | null = null;
    let reentered = false;
    port.onCloseSession = () => {
      if (reentered) return;
      reentered = true;
      reentrantClose = terminal.close();
    };
    const closing = terminal.close();

    expect(reentrantClose).toBe(closing);
    expect(port.closeCalls).toEqual(['terminal-1']);
    await closing;
  });

  it('does not release a run after signal transport failure until physical exit settles it', async () => {
    const port = new TerminalPortFixture();
    const terminal = createProjectTerminal({ id: 'terminal-1', port });
    const run = terminal.run('node unconfirmed-stop.mjs');
    port.resolveOpen('terminal-1');
    await settleMicrotasks();
    port.admit(0, 'run-1');
    await run.ready;

    const transportFailure = new Error('signal transport failed');
    port.signalFailure = transportFailure;
    await expect(run.stop()).rejects.toBe(transportFailure);
    const closing = run.close();
    void closing.catch(() => {});
    await settleMicrotasks();

    expect(() => terminal.run('node must-stay-busy.mjs')).toThrowError(ProjectBusyError);
    const exactExit = { code: 0, signal: null } as const;
    port.exit(0, exactExit);
    await expect(closing).rejects.toBe(transportFailure);

    port.signalFailure = null;
    const replacement = terminal.run('node replacement.mjs');
    await settleMicrotasks();
    port.admit(1, 'run-2');
    port.exit(1, { code: 0, signal: null });
    await replacement.close();
    await terminal.close();
  });

  it('never reports readiness when stop was requested before owner admission', async () => {
    const port = new TerminalPortFixture();
    const terminal = createProjectTerminal({ id: 'terminal-1', port });
    const run = terminal.run('node delayed-admission.mjs');
    port.resolveOpen('terminal-1');
    await settleMicrotasks();
    expect(port.execCalls).toHaveLength(1);

    const stopped = run.stop();
    port.admit(0, 'run-1');

    await expect(run.ready).rejects.toBeInstanceOf(ClosedHandleError);
    expect(port.signalCalls).toEqual([{ sid: 'terminal-1', rid: 'run-1' }]);
    const exactExit = { code: null, signal: 'SIGINT' } as const;
    port.exit(0, exactExit, 130);
    await expect(stopped).resolves.toBe(exactExit);
    await expect(run.close()).resolves.toBe(exactExit);
    await terminal.close();
  });

  it('keeps physical exit independent when a latched pre-admission signal throws', async () => {
    const port = new TerminalPortFixture();
    const terminal = createProjectTerminal({ id: 'terminal-1', port });
    const run = terminal.run('node delayed-admission.mjs');
    port.resolveOpen('terminal-1');
    await settleMicrotasks();
    expect(port.execCalls).toHaveLength(1);

    const transportFailure = new Error('signal transport failed');
    port.signalFailure = transportFailure;
    const stopped = run.stop();
    void stopped.catch(() => {});
    port.admit(0, 'run-1');
    await expect(run.ready).rejects.toBeInstanceOf(ClosedHandleError);
    await expect(stopped).rejects.toBe(transportFailure);

    const closing = run.close();
    void closing.catch(() => {});
    await settleMicrotasks();
    expect(() => terminal.run('node must-stay-busy.mjs')).toThrowError(ProjectBusyError);

    const exactExit = { code: 0, signal: null } as const;
    port.exit(0, exactExit);
    await expect(run.exited).resolves.toBe(exactExit);
    await expect(closing).rejects.toBe(transportFailure);
    await terminal.close();
  });

  it('closes one PTY session without disturbing a sibling terminal', async () => {
    const port = new TerminalPortFixture();
    const first = createProjectTerminal({ id: 'terminal-1', port });
    const sibling = createProjectTerminal({ id: 'terminal-2', port });
    port.resolveOpen('terminal-1');
    port.resolveOpen('terminal-2');
    await settleMicrotasks();

    const siblingRun = sibling.run('node sibling.mjs');
    await settleMicrotasks();
    port.admit(0, 'sibling-run');
    await siblingRun.ready;

    await first.close();
    expect(port.closeCalls).toEqual(['terminal-1']);
    await expect(sibling.write('still alive')).resolves.toBeUndefined();
    expect(port.writeCalls).toHaveLength(1);
    expect(port.writeCalls[0]).toMatchObject({ sid: 'terminal-2', rid: 'sibling-run' });

    port.exit(0, { code: 0, signal: null });
    await expect(siblingRun.exited).resolves.toEqual({ code: 0, signal: null });
    await siblingRun.close();
    await sibling.close();
    expect(port.closeCalls).toEqual(['terminal-1', 'terminal-2']);
  });

  it('rejects an idle resize when terminal close starts and ignores its late owner ACK', async () => {
    const port = new TerminalPortFixture();
    port.autoAck = false;
    const terminal = createProjectTerminal({ id: 'terminal-1', port });
    port.resolveOpen('terminal-1');
    await settleMicrotasks();
    const resized = terminal.resize(100, 30);
    void resized.catch(() => {});
    await settleMicrotasks();
    expect(port.sessionResizeCalls).toHaveLength(1);

    const closed = terminal.close();
    await expect(resized).rejects.toBeInstanceOf(ClosedHandleError);
    port.sessionResizeCalls[0]!.ack.resolve();
    await expect(closed).resolves.toBeUndefined();
  });

  it('rejects an idle resize when the owner dies', async () => {
    const port = new TerminalPortFixture();
    port.autoAck = false;
    const terminal = createProjectTerminal({ id: 'terminal-1', port });
    port.resolveOpen('terminal-1');
    await settleMicrotasks();
    const resized = terminal.resize(100, 30);
    void resized.catch(() => {});
    await settleMicrotasks();
    expect(port.sessionResizeCalls).toHaveLength(1);

    port.die(1);
    await expect(resized).rejects.toBeInstanceOf(ClosedHandleError);
    await expect(terminal.close()).rejects.toBeInstanceOf(ClosedHandleError);
  });

  it('turns owner death into a loud terminal outcome for admission, exit, queued control, and future calls', async () => {
    const port = new TerminalPortFixture();
    const terminal = createProjectTerminal({ id: 'terminal-1', port });
    const run = terminal.run('node never-admitted.mjs');
    const queuedWrite = terminal.write('queued');
    const queuedResize = terminal.resize(100, 30);
    void queuedWrite.catch(() => {});
    void queuedResize.catch(() => {});

    port.die(1);

    await expect(run.ready).rejects.toBeInstanceOf(ClosedHandleError);
    await expect(run.exited).rejects.toBeInstanceOf(ClosedHandleError);
    await expect(queuedWrite).rejects.toBeInstanceOf(ClosedHandleError);
    await expect(queuedResize).rejects.toBeInstanceOf(ClosedHandleError);
    await expect(terminal.write('after death')).rejects.toBeInstanceOf(ClosedHandleError);
    expect(() => terminal.run('node after-death.mjs')).toThrowError(ClosedHandleError);
    await expect(run.close()).rejects.toBeInstanceOf(ClosedHandleError);
    await expect(terminal.close()).rejects.toBeInstanceOf(ClosedHandleError);
  });

  it('detaches output listeners when owner death closes the terminal lifecycle', async () => {
    const port = new TerminalPortFixture();
    const terminal = createProjectTerminal({ id: 'terminal-1', port });
    const chunks: string[] = [];
    terminal.attach((chunk) => chunks.push(chunk));
    const run = terminal.run('node late-output.mjs');
    void run.ready.catch(() => {});
    void run.exited.catch(() => {});
    port.resolveOpen('terminal-1');
    await settleMicrotasks();
    port.admit(0, 'run-1');
    await run.ready;

    port.die(1);
    await expect(run.exited).rejects.toBeInstanceOf(ClosedHandleError);
    port.execCalls[0]!.options.onChunk('late', 'stdout');

    expect(chunks).toEqual([]);
  });
});
