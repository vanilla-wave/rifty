import type { ProcessExit } from '@riftydev/shell';
import { describe, expect, it } from 'vitest';
import { createVfsCommitCoordinator } from '../glue/vfs-commit-coordinator.ts';
import { SnapshotFs } from './internal/snapshot-fs.ts';

import { DirtyProjectDocumentError } from './errors.ts';
import { createProjectContentController } from './project-content.ts';
import type { ProjectDocumentReadEntry } from './project-documents.ts';
import {
  ClosedHandleError,
  ProjectBusyError,
  ProjectRunExitedBeforeReadyError,
  createProjectSession,
  registerProjectSessionBeforeClose,
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

const CONTENT_ROOT = '/.rifty/workbench/projects/session-contract';
const CONTENT_OWNER_EPOCH = 'session-content-owner';
const encoder = new TextEncoder();

function createContentFixture() {
  const snapshots = new SnapshotFs(CONTENT_ROOT);
  snapshots.bindOwner(CONTENT_OWNER_EPOCH, CONTENT_ROOT);
  snapshots.update({
    type: 'snapshot',
    root: CONTENT_ROOT,
    ownerEpoch: CONTENT_OWNER_EPOCH,
    treeRevision: 1,
    nodeModulesPresent: false,
    entries: [
      { path: `${CONTENT_ROOT}/src`, kind: 'dir', size: 0, version: 'dir-v1' },
      {
        path: `${CONTENT_ROOT}/src/main.ts`,
        kind: 'file',
        size: 3,
        content: encoder.encode('old'),
        version: 'file-v1',
      },
    ],
  });
  const ownerClosed = deferred<unknown>();
  const committer = createVfsCommitCoordinator({
    captureOwner: () => ({
      ownerEpoch: CONTENT_OWNER_EPOCH,
      isAlive: () => true,
      closed: ownerClosed.promise,
      applyHostCommit: async () => {
        throw new Error('Session contract did not expect a content commit');
      },
      durabilityBarrier: async (treeRevision) => ({
        ownerEpoch: CONTENT_OWNER_EPOCH,
        treeRevision,
        durability: 'ephemeral' as const,
      }),
    }),
    subscribeSnapshots: (listener) => snapshots.subscribeRevisions(listener),
    timeoutMs: 1_000,
  });
  let readVersionedFile = async (path: string): Promise<ProjectDocumentReadEntry> => ({
    path,
    kind: 'file',
    size: 3,
    content: encoder.encode('old'),
    version: 'file-v1',
    ownerEpoch: CONTENT_OWNER_EPOCH,
    treeRevision: 1,
  });
  const content = createProjectContentController({
    projectRoot: CONTENT_ROOT,
    snapshots,
    committer,
    readVersionedFile: (path) => readVersionedFile(path),
    readVersionedDirectory: async () => [],
  });
  return {
    content,
    setReadVersionedFile(next: typeof readVersionedFile) {
      readVersionedFile = next;
    },
  };
}

async function settleMicrotasks(): Promise<void> {
  for (let turn = 0; turn < 10; turn++) await Promise.resolve();
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

  snapshot(): { readonly cwd: '/'; readonly env: Record<string, string> } {
    return { cwd: '/', env: {} };
  }

  complete(): Promise<null> {
    return Promise.resolve(null);
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
  const contentFixture = createContentFixture();
  const defaultTerminal = createProjectTerminal({ id: 'terminal-default', port });
  const readyGates: ReturnType<typeof deferred<string>>[] = [];
  let terminalSequence = 0;
  let runtimeCloseCalls = 0;
  let runtimeCloseError: Error | null = null;
  let ownerCloseCalls = 0;
  let ownerCloseError: Error | null = null;
  const ownerCloseOrder: {
    readonly terminalCalls: readonly string[];
    readonly runtimeCalls: number;
  }[] = [];

  const runtime = {
    start() {
      const ready = deferred<string>();
      readyGates.push(ready);
      const run = defaultTerminal.run('vite --port 5173');
      return {
        run,
        ready: ready.promise,
        closed: run.exited.then(
          () => undefined,
          () => undefined,
        ),
      };
    },
    async close(): Promise<void> {
      runtimeCloseCalls++;
      if (runtimeCloseError) throw runtimeCloseError;
    },
  };

  const session = createProjectSession({
    content: contentFixture.content,
    runtime,
    terminal: defaultTerminal,
    createTerminal: () =>
      createProjectTerminal({ id: `terminal-extra-${++terminalSequence}`, port }),
    async closeOwner(): Promise<void> {
      ownerCloseCalls++;
      ownerCloseOrder.push({
        terminalCalls: [...port.closeCalls],
        runtimeCalls: runtimeCloseCalls,
      });
      if (ownerCloseError) throw ownerCloseError;
    },
  });

  return {
    port,
    content: contentFixture.content,
    session,
    defaultTerminal,
    readyGates,
    runtimeCloseCalls: () => runtimeCloseCalls,
    ownerCloseCalls: () => ownerCloseCalls,
    ownerCloseOrder,
    failRuntimeClose(error: Error) {
      runtimeCloseError = error;
    },
    failOwnerClose(error: Error) {
      ownerCloseError = error;
    },
    setReadVersionedFile: contentFixture.setReadVersionedFile,
  };
}

describe('ProjectSession lifecycle contract', () => {
  it('exposes the required real files and documents handles from its content owner', () => {
    const h = createHarness();

    expect(h.session.files).toBe(h.content.files);
    expect(h.session.documents).toBe(h.content.documents);
  });

  it('rolls back a dirty content preflight without fencing or closing session resources', async () => {
    const h = createHarness();
    const document = await h.session.documents.open('/src/main.ts');
    document.replace('dirty');

    const firstClose = h.session.close();
    expect(h.session.close()).toBe(firstClose);
    expect(() => h.session.terminals.open()).not.toThrow();
    await expect(firstClose).rejects.toBeInstanceOf(DirtyProjectDocumentError);

    expect(h.port.closeCalls).toEqual([]);
    expect(h.runtimeCloseCalls()).toBe(0);
    expect(h.ownerCloseCalls()).toBe(0);
    expect(() => document.replace('still editable')).not.toThrow();
    await expect(h.session.files.readFile('/src/main.ts')).resolves.toMatchObject({
      path: '/src/main.ts',
      bytes: encoder.encode('old'),
    });

    const run = h.session.run();
    h.port.resolveOpen('terminal-default');
    await settleMicrotasks();
    h.port.admit(0, 'post-preflight-run');
    h.port.exit(0, { code: 0, signal: null });
    await run.close();

    await document.close({ dirty: 'discard' });
    await expect(h.session.close()).resolves.toBeUndefined();
  });

  it('fences a successful clean close in the same tick', async () => {
    const h = createHarness();

    const closing = h.session.close();

    expect(() => h.session.run()).toThrow(ClosedHandleError);
    expect(() => h.session.terminals.open()).toThrow(ClosedHandleError);
    await expect(closing).resolves.toBeUndefined();
  });

  it('starts aggregate teardown after synchronous preflight while admitted content drains', async () => {
    const h = createHarness();
    const reading = deferred<ProjectDocumentReadEntry>();
    h.setReadVersionedFile(() => reading.promise);
    const opening = h.session.documents.open('/src/main.ts');

    const closing = h.session.close();
    expect(h.session.close()).toBe(closing);
    await settleMicrotasks();
    expect(h.port.closeCalls).toEqual(['terminal-default']);
    expect(h.runtimeCloseCalls()).toBe(1);
    expect(h.ownerCloseCalls()).toBe(1);

    reading.resolve({
      path: `${CONTENT_ROOT}/src/main.ts`,
      kind: 'file',
      size: 3,
      content: encoder.encode('old'),
      version: 'file-v1',
      ownerEpoch: CONTENT_OWNER_EPOCH,
      treeRevision: 1,
    });
    await expect(opening).rejects.toBeInstanceOf(ClosedHandleError);
    await settleMicrotasks();

    expect(() => h.session.run()).toThrow(ClosedHandleError);
    expect(() => h.session.terminals.open()).toThrow(ClosedHandleError);
    expect(h.port.closeCalls).toEqual(['terminal-default']);
    expect(h.runtimeCloseCalls()).toBe(1);
    expect(h.ownerCloseCalls()).toBe(1);
    expect(h.ownerCloseOrder).toEqual([{ terminalCalls: ['terminal-default'], runtimeCalls: 1 }]);
    await expect(closing).resolves.toBeUndefined();
    expect(h.session.close()).toBe(closing);
  });

  it('drains private pre-close work before every core teardown sibling and aggregates failures', async () => {
    const h = createHarness();
    const gate = deferred<void>();
    const toolFailure = new Error('tool drain failed');
    const events: string[] = [];
    registerProjectSessionBeforeClose(h.session, async () => {
      events.push('tools:start');
      await gate.promise;
      events.push('tools:end');
      throw toolFailure;
    });

    const closing = h.session.close();
    await settleMicrotasks();
    expect(events).toEqual(['tools:start']);
    expect(h.port.closeCalls).toEqual([]);
    expect(h.runtimeCloseCalls()).toBe(0);
    expect(h.ownerCloseCalls()).toBe(0);

    gate.resolve();
    const failure = await closing.catch((error: unknown) => error);

    expect(events).toEqual(['tools:start', 'tools:end']);
    expect(h.port.closeCalls).toEqual(['terminal-default']);
    expect(h.runtimeCloseCalls()).toBe(1);
    expect(h.ownerCloseCalls()).toBe(1);
    expect(failure).toBe(toolFailure);
  });

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
    await settleMicrotasks();

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

  it('deduplicates a shared causal close failure only by reference identity', async () => {
    const h = createHarness();
    const authorityFailure = new AggregateError(
      [new Error('route teardown failed')],
      'preview authority close failed',
    );
    const readinessFailure = new AggregateError(
      [authorityFailure],
      'preview readiness close failed',
    );
    h.failRuntimeClose(readinessFailure);
    h.failOwnerClose(authorityFailure);

    const failure = await h.session.close().catch((error: unknown) => error);

    expect(failure).toBe(authorityFailure);
  });

  it('keeps equal-looking independent close failures distinct', async () => {
    const h = createHarness();
    const runtimeFailure = new Error('same close failure');
    const ownerFailure = new Error('same close failure');
    h.failRuntimeClose(runtimeFailure);
    h.failOwnerClose(ownerFailure);

    const failure = await h.session.close().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([runtimeFailure, ownerFailure]);
  });
});
