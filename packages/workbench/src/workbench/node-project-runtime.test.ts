import { type ProcessExit, Shell } from '@riftydev/shell';
import { describe, expect, it } from 'vitest';
import { ProjectBusyError, ProjectRunExitedBeforeReadyError } from './errors.ts';
import {
  createNodeCliProjectRuntime,
  createNodeServerProjectRuntime,
} from './node-project-runtime.ts';
import {
  type PreviewAdvertisement,
  type PreviewReadiness,
  createPreviewReadiness,
} from './preview-readiness.ts';
import { createUnusedProjectContent } from './project-content.test-fixture.ts';
import { createProjectSession } from './project-session.ts';
import { type ProjectTerminalExecOptions, createProjectTerminal } from './project-terminal.ts';

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

/** Real ProjectTerminal's external owner/PTY boundary. */
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

  complete(): Promise<null> {
    return Promise.resolve(null);
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
const SERVER_PORT = 5174;

function advertisement(overrides: Partial<PreviewAdvertisement> = {}): PreviewAdvertisement {
  return {
    ownerToken: OWNER_TOKEN,
    ptySid: TERMINAL_SID,
    ptyRid: 'run-1',
    port: SERVER_PORT,
    url: `/preview/${SERVER_PORT}/`,
    label: 'npm run dev',
    source: 'dev-server',
    sid: 'node-server-1',
    ...overrides,
  };
}

function createServerHarness(cwd = '/') {
  const pty = new PtyBoundary(cwd);
  const previews = new PreviewBoundary();
  const terminal = createProjectTerminal({ id: TERMINAL_SID, port: pty });
  const runtime = createNodeServerProjectRuntime({
    terminal,
    ownerToken: OWNER_TOKEN,
    entryPath: '/src/server.mjs',
    port: SERVER_PORT,
    createPreviewReadiness: () => previews.create(),
  });
  let extraTerminalSequence = 0;
  const session = createProjectSession({
    content: createUnusedProjectContent('node-server-runtime-test'),
    runtime,
    terminal,
    createTerminal: () =>
      createProjectTerminal({ id: `terminal-extra-${++extraTerminalSequence}`, port: pty }),
  });
  return { pty, previews, terminal, runtime, session };
}

function createCliHarness(cwd = '/') {
  const pty = new PtyBoundary(cwd);
  const terminal = createProjectTerminal({ id: TERMINAL_SID, port: pty });
  const runtime = createNodeCliProjectRuntime({
    terminal,
    entryPath: "/scripts/cli report's.mjs",
    args: ['plain', 'two words', 'semi;colon', "single'quote", '', '$HOME'],
  });
  let extraTerminalSequence = 0;
  const session = createProjectSession({
    content: createUnusedProjectContent('node-cli-runtime-test'),
    runtime,
    terminal,
    createTerminal: () =>
      createProjectTerminal({ id: `terminal-extra-${++extraTerminalSequence}`, port: pty }),
  });
  return { pty, terminal, runtime, session };
}

async function admitServerRun(h: ReturnType<typeof createServerHarness>, rid = 'run-1') {
  h.pty.resolveOpen(TERMINAL_SID);
  await settleMicrotasks();
  h.pty.admit(0, rid);
  await settleMicrotasks();
}

async function proveServerPreview(h: ReturnType<typeof createServerHarness>) {
  h.previews.publish([advertisement()]);
  h.previews.swProofs[0]?.resolve();
  await settleMicrotasks();
  h.previews.httpProofs[0]?.resolve({ ok: true, status: 200 });
  await settleMicrotasks();
}

async function finishServerRun(
  h: ReturnType<typeof createServerHarness>,
  exit: ProcessExit = { code: 0, signal: null },
) {
  h.pty.exit(0, exit);
  const closing = h.session.close();
  await settleMicrotasks();
  h.previews.swProofs[1]?.resolve();
  await closing;
}

describe('Node server project runtime Contract+RED', () => {
  it('runs the project lifecycle at project root without discarding restored terminal cwd', async () => {
    const h = createServerHarness('/src');
    h.session.run();

    h.pty.resolveOpen(TERMINAL_SID);
    await settleMicrotasks();

    expect(h.pty.execCalls[0]?.line).toBe('npm --prefix .. run dev');
    expect(h.terminal.snapshot().cwd).toBe('/src');
  });

  it('claims synchronously, runs the dedicated lifecycle, then requires exact admitted preview provenance', async () => {
    const h = createServerHarness();
    const run = h.session.run();

    expect(() => h.session.run()).toThrowError(ProjectBusyError);
    expect(h.pty.execCalls).toEqual([]);
    expect(h.previews.requests).toBe(0);

    h.pty.resolveOpen(TERMINAL_SID);
    await settleMicrotasks();
    expect(h.pty.execCalls).toHaveLength(1);
    expect(h.pty.execCalls[0]).toMatchObject({ sid: TERMINAL_SID, line: 'npm run dev' });
    expect(h.previews.requests).toBe(0);

    h.pty.admit(0, 'run-1');
    await settleMicrotasks();
    expect(h.previews.requests).toBe(1);

    h.previews.publish([
      advertisement({ ownerToken: 'owner-sibling', sid: 'wrong-owner' }),
      advertisement({ ptySid: 'terminal-sibling', sid: 'wrong-terminal' }),
      advertisement({ ptyRid: 'run-stale', sid: 'stale-run' }),
      advertisement({ source: 'preview', sid: 'wrong-source' }),
      advertisement({ port: 5199, url: '/preview/5199/', sid: 'wrong-port' }),
    ]);
    await settleMicrotasks();
    expect(h.previews.mounted).toEqual([]);
    expect(h.previews.swProofs).toEqual([]);
    expect(
      await settledOr(
        run.ready.then(() => 'ready'),
        'pending',
      ),
    ).toBe('pending');

    await proveServerPreview(h);
    await expect(run.ready).resolves.toEqual({
      port: SERVER_PORT,
      url: `/preview/${SERVER_PORT}/`,
    });
    await finishServerRun(h);
  });

  it('accepts the configured port from an installed Node supervisor', async () => {
    const h = createServerHarness();
    const run = h.session.run();
    await admitServerRun(h);

    h.previews.publish([advertisement({ source: 'node', label: 'nodemon :5174' })]);
    h.previews.swProofs[0]?.resolve();
    await settleMicrotasks();
    h.previews.httpProofs[0]?.resolve({ ok: true, status: 200 });

    await expect(run.ready).resolves.toEqual({
      port: SERVER_PORT,
      url: `/preview/${SERVER_PORT}/`,
    });
    await finishServerRun(h);
  });

  it('preserves exact exit before proof, rejects readiness, and tears down the route once', async () => {
    const h = createServerHarness();
    const run = h.session.run();
    await admitServerRun(h);
    h.previews.publish([advertisement()]);
    expect(h.previews.mounted).toHaveLength(1);

    const exactExit = { code: 23, signal: null } as const;
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

  it('keeps the preview route through idempotent close until exact physical exit', async () => {
    const h = createServerHarness();
    const run = h.session.run();
    await admitServerRun(h);
    await proveServerPreview(h);
    await run.ready;

    const closing = run.close();
    expect(run.close()).toBe(closing);
    expect(h.pty.signalCalls).toEqual([{ sid: TERMINAL_SID, rid: 'run-1' }]);
    expect(h.previews.teardownCalls).toBe(0);

    const exactExit = { code: null, signal: 'SIGINT' } as const;
    h.pty.exit(0, exactExit, 130);
    await settleMicrotasks();
    expect(h.previews.swProofs).toHaveLength(2);
    h.previews.swProofs[1]?.resolve();
    await expect(closing).resolves.toBe(exactExit);
    expect(h.previews.teardownCalls).toBe(1);
    await h.session.close();
  });
});

describe('Node CLI project runtime Contract+RED', () => {
  it('resolves the project-rooted entry from restored terminal cwd', async () => {
    const h = createCliHarness('/scripts');
    h.session.run();

    h.pty.resolveOpen(TERMINAL_SID);
    await settleMicrotasks();

    expect(h.pty.execCalls[0]?.line).toBe(
      "node './cli report'\\''s.mjs' plain 'two words' 'semi;colon' 'single'\\''quote' '' '$HOME'",
    );
    expect(h.terminal.snapshot().cwd).toBe('/scripts');
  });

  it('keeps a root-level dash-prefixed entry a path instead of a Node option', async () => {
    const pty = new PtyBoundary();
    const terminal = createProjectTerminal({ id: TERMINAL_SID, port: pty });
    const runtime = createNodeCliProjectRuntime({
      terminal,
      entryPath: '/--version',
      args: [],
    });

    runtime.start();
    pty.resolveOpen(TERMINAL_SID);
    await settleMicrotasks();

    expect(pty.execCalls[0]?.line).toBe('node ./--version');
  });

  it('quotes the exact argv, claims synchronously, and becomes ready only on PTY admission', async () => {
    const h = createCliHarness();
    const run = h.session.run();

    expect(() => h.session.run()).toThrowError(ProjectBusyError);
    expect(h.pty.execCalls).toEqual([]);

    h.pty.resolveOpen(TERMINAL_SID);
    await settleMicrotasks();
    expect(h.pty.execCalls).toHaveLength(1);
    expect(h.pty.execCalls[0]).toMatchObject({
      sid: TERMINAL_SID,
      line: "node './scripts/cli report'\\''s.mjs' plain 'two words' 'semi;colon' 'single'\\''quote' '' '$HOME'",
    });
    const emittedLine = h.pty.execCalls[0]?.line;
    if (emittedLine === undefined) throw new Error('missing emitted Node CLI line');
    const shellArgv: string[][] = [];
    const shell = new Shell();
    shell.registerCommand('node', async (args) => {
      shellArgv.push([...args]);
      return 0;
    });
    await expect(shell.run(emittedLine)).resolves.toMatchObject({ exitCode: 0, stderr: '' });
    expect(shellArgv).toEqual([
      [
        "./scripts/cli report's.mjs",
        'plain',
        'two words',
        'semi;colon',
        "single'quote",
        '',
        '$HOME',
      ],
    ]);
    expect(
      await settledOr(
        run.ready.then(() => 'ready'),
        'pending',
      ),
    ).toBe('pending');

    h.pty.admit(0, 'run-cli');
    await expect(run.ready).resolves.toBeUndefined();

    const closing = run.close();
    expect(run.close()).toBe(closing);
    expect(h.pty.signalCalls).toEqual([{ sid: TERMINAL_SID, rid: 'run-cli' }]);
    const exactExit = { code: null, signal: 'SIGINT' } as const;
    h.pty.exit(0, exactExit, 130);
    await expect(run.exited).resolves.toBe(exactExit);
    await expect(closing).resolves.toBe(exactExit);
    await h.session.close();
  });

  it('preserves an exact natural CLI exit after admission without any preview proof', async () => {
    const h = createCliHarness();
    const run = h.session.run();
    h.pty.resolveOpen(TERMINAL_SID);
    await settleMicrotasks();
    h.pty.admit(0, 'run-cli');
    await expect(run.ready).resolves.toBeUndefined();

    const exactExit = { code: 7, signal: null } as const;
    h.pty.exit(0, exactExit);
    await expect(run.exited).resolves.toBe(exactExit);
    await expect(run.close()).resolves.toBe(exactExit);
    await h.session.close();
  });
});
