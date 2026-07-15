import type { ProcessExit } from '@riftydev/shell';
import { describe, expect, it } from 'vitest';

import {
  ClosedHandleError,
  ProjectBusyError,
  ProjectRunExitedBeforeReadyError,
  createProjectSession,
} from './project-session.ts';
import { createProjectTerminal } from './project-terminal.ts';

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

type ExecCall = {
  readonly sid: string;
  readonly line: string;
  readonly options: ExecOptions;
  readonly result: ReturnType<
    typeof deferred<{ readonly exitCode: number; readonly exit: ProcessExit }>
  >;
};

/** Shared owner/PTY boundary for real ProjectTerminal handles composed by ProjectSession. */
class SessionPortFixture {
  readonly closedGate = deferred<number | null>();
  readonly closed = this.closedGate.promise;
  readonly openGates = new Map<string, ReturnType<typeof deferred<void>>>();
  readonly execCalls: ExecCall[] = [];
  readonly signalCalls: { sid: string; rid: string }[] = [];
  readonly closeCalls: string[] = [];
  readonly closeFailures = new Map<string, Error>();
  readonly closeGates = new Map<string, ReturnType<typeof deferred<void>>>();
  signalFailure: Error | null = null;
  onSignal: (() => void) | null = null;
  onCloseSession: (() => void) | null = null;
  alive = true;

  isAlive(): boolean {
    return this.alive;
  }

  openSession(sid: string): Promise<void> {
    const gate = deferred<void>();
    this.openGates.set(sid, gate);
    return gate.promise;
  }

  resolveOpen(sid: string): void {
    this.openGates.get(sid)?.resolve();
  }

  execResult(sid: string, line: string, options: ExecOptions) {
    const result = deferred<{ readonly exitCode: number; readonly exit: ProcessExit }>();
    this.execCalls.push({ sid, line, options, result });
    return result.promise;
  }

  admit(index: number, rid: string): void {
    this.execCalls[index]?.options.onStart?.(rid);
  }

  exit(index: number, exit: ProcessExit, exitCode = exit.code ?? 130): void {
    this.execCalls[index]?.result.resolve({ exitCode, exit });
  }

  writeStdin(): Promise<void> {
    return Promise.resolve();
  }

  endStdin(): Promise<void> {
    return Promise.resolve();
  }

  resizeSession(): Promise<void> {
    return Promise.resolve();
  }

  resize(): Promise<void> {
    return Promise.resolve();
  }

  signal(sid: string, rid: string): void {
    this.signalCalls.push({ sid, rid });
    this.onSignal?.();
    if (this.signalFailure !== null) throw this.signalFailure;
  }

  closeSession(sid: string): Promise<void> {
    this.closeCalls.push(sid);
    this.onCloseSession?.();
    const failure = this.closeFailures.get(sid);
    return failure
      ? Promise.reject(failure)
      : (this.closeGates.get(sid)?.promise ?? Promise.resolve());
  }
}

function createHarness() {
  const port = new SessionPortFixture();
  const defaultTerminal = createProjectTerminal({ id: 'terminal-default', port });
  const readyGates: ReturnType<typeof deferred<string>>[] = [];
  let terminalSequence = 0;
  let runtimeCloseCalls = 0;
  let runtimeCloseError: Error | null = null;

  const runtime = {
    start() {
      const ready = deferred<string>();
      readyGates.push(ready);
      return {
        run: defaultTerminal.run('vite --port 5173'),
        ready: ready.promise,
      };
    },
    async close(): Promise<void> {
      runtimeCloseCalls++;
      if (runtimeCloseError) throw runtimeCloseError;
    },
  };

  const session = createProjectSession({
    runtime,
    terminal: defaultTerminal,
    createTerminal: () =>
      createProjectTerminal({ id: `terminal-extra-${++terminalSequence}`, port }),
  });

  return {
    port,
    session,
    defaultTerminal,
    readyGates,
    runtimeCloseCalls: () => runtimeCloseCalls,
    failRuntimeClose(error: Error) {
      runtimeCloseError = error;
    },
  };
}

describe('ProjectSession lifecycle contract', () => {
  it('claims the default run in the same tick, exposes ready/exited, and stays busy until run.close completes', async () => {
    const h = createHarness();

    const first = h.session.run();
    expect(first.terminal).toBe(h.defaultTerminal);
    expect(() => h.session.run()).toThrowError(ProjectBusyError);

    h.port.resolveOpen('terminal-default');
    await settleMicrotasks();
    expect(h.port.execCalls).toHaveLength(1);
    h.port.admit(0, 'default-run-1');
    const preview = { url: '/preview/5173/' };
    h.readyGates[0]!.resolve(preview.url);
    await expect(first.ready).resolves.toBe(preview.url);

    const exactExit = { code: 0, signal: null } as const;
    h.port.exit(0, exactExit);
    await expect(first.exited).resolves.toBe(exactExit);
    expect(() => h.session.run()).toThrowError(ProjectBusyError);

    await expect(first.close()).resolves.toBe(exactExit);
    const second = h.session.run();
    await settleMicrotasks();
    h.port.admit(1, 'default-run-2');
    h.readyGates[1]!.resolve('/preview/5174/');
    h.port.exit(1, { code: 0, signal: null });
    await second.close();
    await h.session.close();
  });

  it('returns stable stop/close promises with the same exact exit and rejects session operations after close', async () => {
    const h = createHarness();
    const run = h.session.run();
    h.port.resolveOpen('terminal-default');
    await settleMicrotasks();
    h.port.admit(0, 'default-run-1');

    const stopA = run.stop();
    const stopB = run.stop();
    expect(stopB).toBe(stopA);
    expect(h.port.signalCalls).toEqual([{ sid: 'terminal-default', rid: 'default-run-1' }]);

    const exactExit = { code: null, signal: 'SIGINT' } as const;
    h.port.exit(0, exactExit, 130);
    await expect(stopA).resolves.toBe(exactExit);

    const closeA = run.close();
    const closeB = run.close();
    expect(closeB).toBe(closeA);
    await expect(closeA).resolves.toBe(exactExit);
    await expect(closeB).resolves.toBe(exactExit);

    const sessionCloseA = h.session.close();
    const sessionCloseB = h.session.close();
    expect(sessionCloseB).toBe(sessionCloseA);
    await sessionCloseA;
    expect(h.runtimeCloseCalls()).toBe(1);
    expect(() => h.session.run()).toThrowError(ClosedHandleError);
    expect(() => h.session.terminals.open()).toThrowError(ClosedHandleError);
    await expect(h.defaultTerminal.write('closed')).rejects.toBeInstanceOf(ClosedHandleError);
  });

  it('reserves project run-close identity before a reentrant terminal signal callback', async () => {
    const h = createHarness();
    const run = h.session.run();
    h.port.resolveOpen('terminal-default');
    await settleMicrotasks();
    h.port.admit(0, 'default-run-1');

    let reentrantClose: Promise<ProcessExit> | null = null;
    h.port.onSignal = () => {
      reentrantClose = run.close();
    };
    const closing = run.close();

    expect(reentrantClose).toBe(closing);
    expect(h.port.signalCalls).toEqual([{ sid: 'terminal-default', rid: 'default-run-1' }]);
    h.port.exit(0, { code: null, signal: 'SIGINT' }, 130);
    await closing;
    await h.session.close();
  });

  it('reserves project session-close identity before reentrant terminal teardown', async () => {
    const h = createHarness();
    h.port.resolveOpen('terminal-default');
    await settleMicrotasks();

    let reentrantClose: Promise<void> | null = null;
    let reentered = false;
    h.port.onCloseSession = () => {
      if (reentered) return;
      reentered = true;
      reentrantClose = h.session.close();
    };
    const closing = h.session.close();

    expect(reentrantClose).toBe(closing);
    await closing;
    expect(h.port.closeCalls).toEqual(['terminal-default']);
    expect(h.runtimeCloseCalls()).toBe(1);
  });

  it('starts owner session cancellation before awaiting a pre-admission run close', async () => {
    const h = createHarness();
    const ownerClose = deferred<void>();
    h.port.closeGates.set('terminal-default', ownerClose);
    const run = h.session.run();
    void run.ready.catch(() => {});
    h.port.resolveOpen('terminal-default');
    await settleMicrotasks();
    expect(h.port.execCalls).toHaveLength(1);

    const closing = h.session.close();
    await settleMicrotasks();
    const closeCallsBeforeExit = [...h.port.closeCalls];
    const runtimeCloseCallsBeforeExit = h.runtimeCloseCalls();

    h.port.exit(0, { code: null, signal: 'SIGINT' }, 130);
    ownerClose.resolve();
    await expect(closing).resolves.toBeUndefined();
    expect(closeCallsBeforeExit).toEqual(['terminal-default']);
    expect(runtimeCloseCallsBeforeExit).toBe(1);
  });

  it('uses the owned terminal as the sole cancellation owner for an admitted session run', async () => {
    const h = createHarness();
    const ownerClose = deferred<void>();
    h.port.closeGates.set('terminal-default', ownerClose);
    const run = h.session.run();
    h.port.resolveOpen('terminal-default');
    await settleMicrotasks();
    h.port.admit(0, 'default-run-1');
    h.readyGates[0]!.resolve('/preview/5173/');
    await run.ready;

    const closing = h.session.close();
    await settleMicrotasks();
    expect(h.port.signalCalls).toEqual([]);
    expect(h.port.closeCalls).toEqual(['terminal-default']);

    const exactExit = { code: null, signal: 'SIGINT' } as const;
    h.port.exit(0, exactExit, 130);
    ownerClose.resolve();
    await expect(run.exited).resolves.toBe(exactExit);
    await expect(run.close()).resolves.toBe(exactExit);
    await expect(closing).resolves.toBeUndefined();
    expect(h.port.signalCalls).toEqual([]);
  });

  it('reports one signal transport failure instead of aggregating the run and its terminal twice', async () => {
    const h = createHarness();
    const run = h.session.run();
    h.port.resolveOpen('terminal-default');
    await settleMicrotasks();
    h.port.admit(0, 'default-run-1');
    const transportFailure = new Error('signal transport failed');
    h.port.signalFailure = transportFailure;

    const runClose = run.close();
    void runClose.catch(() => {});
    const closing = h.session.close();

    await expect(runClose).rejects.toBe(transportFailure);
    await expect(closing).rejects.toBe(transportFailure);
    expect(h.port.signalCalls).toEqual([{ sid: 'terminal-default', rid: 'default-run-1' }]);
    expect(h.port.closeCalls).toEqual(['terminal-default']);
  });

  it('starts every owned terminal and runtime close before awaiting a hung sibling', async () => {
    const h = createHarness();
    const sibling = h.session.terminals.open();
    h.port.resolveOpen('terminal-default');
    h.port.resolveOpen('terminal-extra-1');
    await settleMicrotasks();
    const defaultClose = deferred<void>();
    const siblingClose = deferred<void>();
    h.port.closeGates.set('terminal-default', defaultClose);
    h.port.closeGates.set('terminal-extra-1', siblingClose);

    const closing = h.session.close();
    await settleMicrotasks();
    const siblingResize = sibling.resize(100, 30);

    expect(h.port.closeCalls).toEqual(['terminal-default', 'terminal-extra-1']);
    expect(h.runtimeCloseCalls()).toBe(1);
    await expect(siblingResize).rejects.toBeInstanceOf(ClosedHandleError);
    defaultClose.resolve();
    siblingClose.resolve();
    await expect(closing).resolves.toBeUndefined();
  });

  it('keeps the project run claimed after signal transport failure until physical exit', async () => {
    const h = createHarness();
    const run = h.session.run();
    h.port.resolveOpen('terminal-default');
    await settleMicrotasks();
    h.port.admit(0, 'default-run-1');

    const transportFailure = new Error('signal transport failed');
    h.port.signalFailure = transportFailure;
    await expect(run.stop()).rejects.toBe(transportFailure);
    const closing = run.close();
    void closing.catch(() => {});
    await settleMicrotasks();

    expect(() => h.session.run()).toThrowError(ProjectBusyError);
    h.port.exit(0, { code: 0, signal: null });
    await expect(closing).rejects.toBe(transportFailure);

    h.port.signalFailure = null;
    const replacement = h.session.run();
    await settleMicrotasks();
    h.port.admit(1, 'default-run-2');
    h.port.exit(1, { code: 0, signal: null });
    await replacement.close();
    await h.session.close();
  });

  it('rejects readiness when the process exits first and ignores a late readiness proof', async () => {
    const h = createHarness();
    const run = h.session.run();
    h.port.resolveOpen('terminal-default');
    await settleMicrotasks();
    h.port.admit(0, 'default-run-1');
    const exactExit = { code: 1, signal: null } as const;

    h.port.exit(0, exactExit, 1);
    await expect(run.exited).resolves.toBe(exactExit);
    h.readyGates[0]!.resolve('/preview/too-late/');

    const failure = await run.ready.catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ProjectRunExitedBeforeReadyError);
    expect((failure as ProjectRunExitedBeforeReadyError).exit).toBe(exactExit);
    await run.close();
    await h.session.close();
  });

  it('attempts every owned terminal and runtime close once, then aggregates the exact failures', async () => {
    const h = createHarness();
    const sibling = h.session.terminals.open();
    h.port.resolveOpen('terminal-default');
    h.port.resolveOpen('terminal-extra-1');
    await settleMicrotasks();

    const defaultFailure = new Error('default terminal close failed');
    const siblingFailure = new Error('sibling terminal close failed');
    const runtimeFailure = new Error('runtime close failed');
    h.port.closeFailures.set('terminal-default', defaultFailure);
    h.port.closeFailures.set('terminal-extra-1', siblingFailure);
    h.failRuntimeClose(runtimeFailure);

    const firstClose = h.session.close();
    const repeatedClose = h.session.close();
    expect(repeatedClose).toBe(firstClose);
    const failure = await firstClose.catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([
      defaultFailure,
      siblingFailure,
      runtimeFailure,
    ]);
    expect(h.port.closeCalls).toEqual(['terminal-default', 'terminal-extra-1']);
    expect(h.runtimeCloseCalls()).toBe(1);
    await expect(repeatedClose).rejects.toBe(failure);
    await expect(h.session.close()).rejects.toBe(failure);
    expect(h.port.closeCalls).toEqual(['terminal-default', 'terminal-extra-1']);
    expect(h.runtimeCloseCalls()).toBe(1);

    await expect(sibling.write('closed')).rejects.toBeInstanceOf(ClosedHandleError);
  });
});
