import type { ProcessExit } from '@riftydev/shell';
import { describe, expect, it } from 'vitest';
import { ProjectBusyError, ProjectRunExitedBeforeReadyError } from './errors.ts';
import {
  type PreviewAdvertisement,
  type PreviewReadiness,
  createPreviewReadiness,
} from './preview-readiness.ts';
import { createUnusedProjectContent } from './project-content.test-fixture.ts';
import { createProjectSession } from './project-session.ts';
import { type ProjectTerminalExecOptions, createProjectTerminal } from './project-terminal.ts';
import { createViteProjectRuntime } from './vite-project-runtime.ts';

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
  reject(reason?: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function settleMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function settledOr<T>(promise: Promise<T>, pending: T): Promise<T> {
  return Promise.race([promise, Promise.resolve().then(() => pending)]);
}

type ExecCall = {
  readonly sid: string;
  readonly line: string;
  readonly options: ProjectTerminalExecOptions;
  readonly result: Deferred<{ readonly exitCode: number; readonly exit: ProcessExit }>;
};

/** Real ProjectTerminal's external owner/PTy boundary. */
class PtyBoundary {
  readonly closedGate = deferred<unknown>();
  readonly closed = this.closedGate.promise;
  readonly openGates = new Map<string, Deferred<void>>();
  readonly execCalls: ExecCall[] = [];
  readonly signalCalls: Array<{ readonly sid: string; readonly rid: string }> = [];
  readonly closeCalls: string[] = [];
  alive = true;

  constructor(private readonly cwd = '/') {}

  isAlive(): boolean {
    return this.alive;
  }

  openSession(sid: string): Promise<void> {
    const gate = deferred<void>();
    this.openGates.set(sid, gate);
    return gate.promise;
  }

  snapshot(): { readonly cwd: string; readonly env: Record<string, string> } {
    return { cwd: this.cwd, env: {} };
  }

  resolveOpen(sid: string): void {
    this.openGates.get(sid)?.resolve();
  }

  execResult(
    sid: string,
    line: string,
    options: ProjectTerminalExecOptions,
  ): Promise<{ readonly exitCode: number; readonly exit: ProcessExit }> {
    const result = deferred<{ readonly exitCode: number; readonly exit: ProcessExit }>();
    this.execCalls.push({ sid, line, options, result });
    return result.promise;
  }

  admit(index: number, rid: string): void {
    const call = this.execCalls[index];
    if (call === undefined) throw new Error(`missing exec call ${index}`);
    call.options.onStart?.(rid);
  }

  exit(index: number, exit: ProcessExit, exitCode = exit.code ?? 130): void {
    const call = this.execCalls[index];
    if (call === undefined) throw new Error(`missing exec call ${index}`);
    call.result.resolve({ exitCode, exit });
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
  }

  closeSession(sid: string): Promise<void> {
    this.closeCalls.push(sid);
    return Promise.resolve();
  }
}

/** Real PreviewReadiness's external owner/SW/route/fetch boundaries. */
class PreviewBoundary {
  listener: ((entries: readonly PreviewAdvertisement[]) => void) | null = null;
  requests = 0;
  teardownCalls = 0;
  readonly mounted: PreviewAdvertisement[] = [];
  readonly swProofs: Deferred<void>[] = [];
  readonly httpProofs: Deferred<{ readonly ok: boolean; readonly status: number }>[] = [];

  create(): PreviewReadiness {
    return createPreviewReadiness({
      timeoutMs: 60_000,
      subscribe: (listener) => {
        this.listener = listener;
        return () => {
          if (this.listener === listener) this.listener = null;
        };
      },
      requestSnapshot: () => {
        this.requests++;
      },
      mountRoute: (entry) => {
        this.mounted.push(entry);
        let tornDown = false;
        return () => {
          if (tornDown) throw new Error('preview route was torn down twice');
          tornDown = true;
          this.teardownCalls++;
        };
      },
      proveServiceWorkerControl: (signal) => {
        const proof = deferred<void>();
        signal.addEventListener('abort', () => proof.reject(signal.reason), { once: true });
        this.swProofs.push(proof);
        return proof.promise;
      },
      probe: (_url, signal) => {
        const proof = deferred<{ readonly ok: boolean; readonly status: number }>();
        signal.addEventListener('abort', () => proof.reject(signal.reason), { once: true });
        this.httpProofs.push(proof);
        return proof.promise;
      },
    });
  }

  publish(entries: readonly PreviewAdvertisement[]): void {
    if (this.listener === null) throw new Error('preview listener is not attached');
    this.listener(entries);
  }
}

const OWNER_TOKEN = 'owner-workbench';
const TERMINAL_SID = 'terminal-default';

function advertisement(overrides: Partial<PreviewAdvertisement> = {}): PreviewAdvertisement {
  return {
    ownerToken: OWNER_TOKEN,
    ptySid: TERMINAL_SID,
    ptyRid: 'run-1',
    port: 5173,
    url: '/preview/5173/',
    label: 'node :5173',
    source: 'node',
    sid: 'bin-vite-1',
    ...overrides,
  };
}

function createHarness(
  options: { readonly readinessCloseGate?: Deferred<void>; readonly cwd?: string } = {},
) {
  const pty = new PtyBoundary(options.cwd);
  const previews = new PreviewBoundary();
  const terminal = createProjectTerminal({ id: TERMINAL_SID, port: pty });
  const runtime = createViteProjectRuntime({
    terminal,
    ownerToken: OWNER_TOKEN,
    createPreviewReadiness: () => {
      const readiness = previews.create();
      const gate = options.readinessCloseGate;
      if (gate === undefined) return readiness;
      return {
        waitFor: (waitOptions) => readiness.waitFor(waitOptions),
        close: async () => {
          await gate.promise;
          await readiness.close();
        },
      };
    },
  });
  let extraTerminalSequence = 0;
  const session = createProjectSession({
    content: createUnusedProjectContent('vite-runtime-test'),
    runtime,
    terminal,
    createTerminal: () =>
      createProjectTerminal({ id: `terminal-extra-${++extraTerminalSequence}`, port: pty }),
  });
  return { pty, previews, terminal, runtime, session };
}

async function admitDefaultRun(h: ReturnType<typeof createHarness>, rid = 'run-1') {
  h.pty.resolveOpen(TERMINAL_SID);
  await settleMicrotasks();
  h.pty.admit(0, rid);
  await settleMicrotasks();
}

async function proveExactPreview(h: ReturnType<typeof createHarness>) {
  h.previews.publish([advertisement()]);
  h.previews.swProofs[0]?.resolve();
  await settleMicrotasks();
  h.previews.httpProofs[0]?.resolve({ ok: true, status: 200 });
  await settleMicrotasks();
}

describe('Vite project runtime Contract+RED', () => {
  it('passes the project root explicitly when restored terminal cwd is nested', async () => {
    const h = createHarness({ cwd: '/src/nested' });
    h.session.run();

    h.pty.resolveOpen(TERMINAL_SID);
    await settleMicrotasks();

    expect(h.pty.execCalls[0]?.line).toBe('vite ../..');
    expect(h.terminal.snapshot().cwd).toBe('/src/nested');
  });

  it('claims synchronously, runs exactly vite, and waits for owner admission before preview', async () => {
    const h = createHarness();
    const run = h.session.run();

    expect(() => h.session.run()).toThrowError(ProjectBusyError);
    expect(h.pty.execCalls).toEqual([]);
    expect(h.previews.requests).toBe(0);

    h.pty.resolveOpen(TERMINAL_SID);
    await settleMicrotasks();
    expect(h.pty.execCalls).toHaveLength(1);
    expect(h.pty.execCalls[0]).toMatchObject({ sid: TERMINAL_SID, line: 'vite' });
    expect(h.previews.requests).toBe(0);

    h.pty.admit(0, 'run-1');
    await settleMicrotasks();
    expect(h.previews.requests).toBe(1);

    await proveExactPreview(h);
    await expect(run.ready).resolves.toMatchObject({ port: 5173, url: '/preview/5173/' });
    h.pty.exit(0, { code: 0, signal: null });
    const closing = run.close();
    await settleMicrotasks();
    expect(h.previews.swProofs).toHaveLength(2);
    h.previews.swProofs[1]?.resolve();
    await closing;
    await h.session.close();
  });

  it('skips sibling and stale same-owner entries in one snapshot and proves only the admitted pair', async () => {
    const h = createHarness();
    const run = h.session.run();
    await admitDefaultRun(h);

    const sibling = advertisement({
      ptySid: 'terminal-sibling',
      ptyRid: 'run-sibling',
      port: 4173,
      url: '/preview/4173/',
      sid: 'sibling-child',
    });
    const stale = advertisement({
      ptyRid: 'run-stale',
      port: 4174,
      url: '/preview/4174/',
      sid: 'stale-child',
    });
    const exact = advertisement();
    h.previews.publish([sibling, stale, exact]);

    expect(h.previews.mounted).toEqual([exact]);
    expect(h.previews.swProofs).toHaveLength(1);
    h.previews.swProofs[0]?.resolve();
    await settleMicrotasks();
    h.previews.httpProofs[0]?.resolve({ ok: true, status: 200 });
    await expect(run.ready).resolves.toEqual({
      port: 5173,
      url: '/preview/5173/',
    });

    h.pty.exit(0, { code: 0, signal: null });
    const closing = run.close();
    await settleMicrotasks();
    expect(h.previews.swProofs).toHaveLength(2);
    h.previews.swProofs[1]?.resolve();
    await closing;
    await h.session.close();
  });

  it('lossy-aggregate fault: run A advertisement cannot ready sequential run B', async () => {
    const h = createHarness();
    const first = h.session.run();
    await admitDefaultRun(h, 'run-a');
    const exactA = advertisement({ ptyRid: 'run-a', sid: 'vite-a' });
    h.previews.publish([exactA]);
    h.previews.swProofs[0]?.resolve();
    await settleMicrotasks();
    h.previews.httpProofs[0]?.resolve({ ok: true, status: 200 });
    await first.ready;
    h.pty.exit(0, { code: 0, signal: null });
    const firstClosing = first.close();
    await settleMicrotasks();
    expect(h.previews.swProofs).toHaveLength(2);
    h.previews.swProofs[1]?.resolve();
    await firstClosing;

    const second = h.session.run();
    await settleMicrotasks();
    expect(h.pty.execCalls).toHaveLength(2);
    h.pty.admit(1, 'run-b');
    await settleMicrotasks();
    expect(h.previews.requests).toBe(2);

    const lateA = advertisement({ ptyRid: 'run-a', sid: 'vite-a-late' });
    h.previews.publish([lateA]);
    await settleMicrotasks();
    expect(h.previews.mounted).toEqual([exactA]);
    expect(h.previews.swProofs).toHaveLength(2);
    expect(
      await settledOr(
        second.ready.then(() => 'ready'),
        'pending',
      ),
    ).toBe('pending');

    const exactB = advertisement({ ptyRid: 'run-b', sid: 'vite-b' });
    h.previews.publish([exactB]);
    expect(h.previews.mounted).toEqual([exactA, exactB]);
    h.previews.swProofs[2]?.resolve();
    await settleMicrotasks();
    h.previews.httpProofs[1]?.resolve({ ok: true, status: 200 });
    await expect(second.ready).resolves.toEqual({
      port: 5173,
      url: '/preview/5173/',
    });

    h.pty.exit(1, { code: 0, signal: null });
    const secondClosing = second.close();
    await settleMicrotasks();
    expect(h.previews.swProofs).toHaveLength(4);
    h.previews.swProofs[3]?.resolve();
    await secondClosing;
    await h.session.close();
  });

  it('provenance-lie fault: admission rejection never starts preview readiness', async () => {
    const h = createHarness();
    const run = h.session.run();
    h.pty.resolveOpen(TERMINAL_SID);
    await settleMicrotasks();
    const failure = new Error('owner rejected Vite admission');
    h.pty.execCalls[0]?.result.reject(failure);

    await expect(run.exited).rejects.toBe(failure);
    await expect(run.ready).rejects.toBe(failure);
    expect(h.previews.requests).toBe(0);
    expect(h.previews.listener).toBeNull();
    expect(h.previews.mounted).toEqual([]);
    await expect(run.close()).rejects.toBe(failure);
    await h.session.close();
  });

  it('provenance-lie fault: close before admission ignores a late owner ACK', async () => {
    const h = createHarness();
    const run = h.session.run();
    h.pty.resolveOpen(TERMINAL_SID);
    await settleMicrotasks();
    expect(h.pty.execCalls).toHaveLength(1);

    const closing = run.close();
    void closing.catch(() => {});
    await settleMicrotasks();
    h.pty.admit(0, 'run-late');
    await settleMicrotasks();

    expect(h.previews.requests).toBe(0);
    expect(h.previews.listener).toBeNull();
    expect(h.previews.mounted).toEqual([]);
    expect(h.pty.signalCalls).toEqual([{ sid: TERMINAL_SID, rid: 'run-late' }]);

    const exactExit = { code: null, signal: 'SIGINT' } as const;
    h.pty.exit(0, exactExit, 130);
    await expect(closing).resolves.toBe(exactExit);
    await h.session.close();
  });

  it('preserves exact exit before proof, rejects readiness, and tears down the route once', async () => {
    const h = createHarness();
    const run = h.session.run();
    await admitDefaultRun(h);
    h.previews.publish([advertisement()]);
    expect(h.previews.mounted).toHaveLength(1);

    const exactExit = { code: 1, signal: null } as const;
    h.pty.exit(0, exactExit);

    await expect(run.exited).resolves.toBe(exactExit);
    const readinessError = await run.ready.catch((error: unknown) => error);
    expect(readinessError).toBeInstanceOf(ProjectRunExitedBeforeReadyError);
    expect((readinessError as ProjectRunExitedBeforeReadyError).exit).toBe(exactExit);
    await settleMicrotasks();
    expect(h.previews.teardownCalls).toBe(1);
    expect(h.previews.swProofs).toHaveLength(2);

    h.previews.swProofs[0]?.resolve();
    await settleMicrotasks();
    expect(h.previews.httpProofs).toHaveLength(0);
    const closing = run.close();
    expect(
      await settledOr(
        closing.then(() => 'closed'),
        'pending',
      ),
    ).toBe('pending');
    h.previews.swProofs[1]?.resolve();
    await expect(closing).resolves.toBe(exactExit);
    await h.session.close();
  });

  it('keeps the route through idempotent close until the exact physical exit', async () => {
    const h = createHarness();
    const run = h.session.run();
    await admitDefaultRun(h);
    await proveExactPreview(h);
    await run.ready;

    const closing = run.close();
    expect(run.close()).toBe(closing);
    expect(h.pty.signalCalls).toEqual([{ sid: TERMINAL_SID, rid: 'run-1' }]);
    expect(
      await settledOr(
        closing.then(() => 'closed'),
        'pending',
      ),
    ).toBe('pending');
    expect(h.previews.teardownCalls).toBe(0);

    const exactExit = { code: null, signal: 'SIGINT' } as const;
    h.pty.exit(0, exactExit, 130);
    await settleMicrotasks();
    expect(h.previews.swProofs).toHaveLength(2);
    h.previews.swProofs[1]?.resolve();
    await expect(closing).resolves.toBe(exactExit);
    await settleMicrotasks();
    expect(h.previews.teardownCalls).toBe(1);
    await h.session.close();
  });

  it('torn-state fault: keeps the run claimed until preview cleanup settles after physical exit', async () => {
    const readinessClose = deferred<void>();
    const h = createHarness({ readinessCloseGate: readinessClose });
    const run = h.session.run();
    await admitDefaultRun(h);
    await proveExactPreview(h);
    await run.ready;

    const exactExit = { code: 0, signal: null } as const;
    h.pty.exit(0, exactExit);
    const closing = run.close();
    await settleMicrotasks();

    expect(h.previews.teardownCalls).toBe(0);
    expect(
      await settledOr(
        closing.then(() => 'closed'),
        'pending',
      ),
    ).toBe('pending');
    expect(() => h.session.run()).toThrowError(ProjectBusyError);

    readinessClose.resolve();
    await settleMicrotasks();
    expect(h.previews.swProofs).toHaveLength(2);
    h.previews.swProofs[1]?.resolve();
    await expect(closing).resolves.toBe(exactExit);
    expect(h.previews.teardownCalls).toBe(1);
    await h.session.close();
  });

  it('torn-state fault: rejects run close when preview cleanup fails', async () => {
    const readinessClose = deferred<void>();
    void readinessClose.promise.catch(() => {});
    const h = createHarness({ readinessCloseGate: readinessClose });
    const run = h.session.run();
    await admitDefaultRun(h);
    await proveExactPreview(h);
    await run.ready;

    const exactExit = { code: 0, signal: null } as const;
    h.pty.exit(0, exactExit);
    const cleanupFailure = new Error('preview route cleanup failed');
    readinessClose.reject(cleanupFailure);

    await expect(run.close()).rejects.toBe(cleanupFailure);
    expect(h.previews.teardownCalls).toBe(0);
    await expect(h.session.close()).rejects.toBe(cleanupFailure);
  });
});
