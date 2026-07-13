/**
 * Terminal session manager — PAGE-side pty port client; shell/npm/bin are
 * owner-resident in the persistent workspace owner (ADR-0146).
 *
 * The `Shell`, cwd/env, npm-install and bin/`execSync` all live in the
 * persistent workspace-owner worker now; this manager keeps only PAGE-local UI
 * state per session (title, status, exit code, the attached terminal writer)
 * and forwards run/stdin/signal over the {@link WorkspaceOwnerHandle} pty
 * channel. cwd/env in snapshots are read from the owner's per-session cache
 * (populated from `pty:exit`), so the explorer/prompt scope stays correct
 * without the page hosting a shell.
 *
 * The session id (`terminal-N`) doubles as the owner pty `sid`: `openSession`
 * on create, `closeSession` on dispose. The active run's `rid` is tracked per
 * session so `writeStdin`/`stop` route to the in-flight run.
 */
import type { TerminalRawInput } from '@riftydev/terminal';
import type { WorkspaceOwnerHandle } from '../glue/realVite.ts';

export type TerminalStatus = 'idle' | 'running';

export interface TerminalSessionSnapshot {
  readonly id: string;
  readonly title: string;
  readonly cwd: string;
  readonly env: Record<string, string>;
  readonly status: TerminalStatus;
  readonly exitCode?: number;
}

export interface TerminalRunDimensions {
  readonly cols?: number;
  readonly rows?: number;
}

export interface TerminalDimensions {
  readonly cols: number;
  readonly rows: number;
}

export type TerminalWriter = (chunk: string, stream?: 'stdout' | 'stderr') => void;

export interface TerminalManager {
  sessions(): TerminalSessionSnapshot[];
  snapshot(id: string): TerminalSessionSnapshot;
  activeSessionId(): string;
  createSession(title?: string): TerminalSessionSnapshot;
  select(id: string): void;
  attachWriter(id: string, writer: TerminalWriter): void;
  /** Wipe the session's screen + scrollback (e.g. a user `clear`). */
  clear(id: string): void;
  /**
   * Fresh console for a (re)booting project: wipe screen + scrollback, then
   * re-emit the onboarding `banner` so the boot terminal still greets — the
   * boot's first clear would otherwise erase the banner printed at mount.
   */
  freshConsole(id: string, banner?: string): void;
  writeStdin(id: string, data: TerminalRawInput): Promise<void>;
  endStdin(id: string): Promise<void>;
  resize(id: string, dims: TerminalDimensions): Promise<void>;
  runLine(id: string, input: string, dims?: TerminalRunDimensions): Promise<number>;
  runSequence(id: string, lines: readonly string[], dims?: TerminalRunDimensions): Promise<number>;
  /** Re-open the PAGE session ids in a respawned workspace owner. */
  rebindOwner(owner: WorkspaceOwnerHandle): Promise<void>;
  stop(id: string): void;
  closeSession(id: string): Promise<void>;
  dispose(): void;
}

interface ControlWaiter {
  settled: boolean;
  readonly promise: Promise<void>;
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
}

interface PendingInputOperation extends ControlWaiter {
  readonly kind: 'data' | 'eof';
  readonly data?: Uint8Array;
}

interface PendingResize {
  readonly waiters: ControlWaiter[];
}

interface ClaimCancellation {
  readonly promise: Promise<never>;
  readonly reject: (error: Error) => void;
}

interface TerminalSession {
  id: string;
  title: string;
  status: TerminalStatus;
  exitCode?: number;
  writer: TerminalWriter | null;
  /** `rid` of the run currently owning the foreground; null when idle. */
  activeRid: string | null;
  /** Resolves once the owner replies `pty:ready` for this session. */
  ready: Promise<void>;
  dimensions: TerminalDimensions;
  pendingInput: PendingInputOperation[];
  pendingResize?: PendingResize;
  readonly controlWaiters: Set<ControlWaiter>;
  eofPromise?: Promise<void>;
  closed: boolean;
  closePromise?: Promise<void>;
  generation: number;
  claimCancellation?: ClaimCancellation;
  stopRequested: boolean;
}

const DISPOSED_ERROR = 'Terminal manager is disposed';
const OPEN_SESSION_RETRY_MS = 250;
const enc = new TextEncoder();

class TerminalRunStoppedError extends Error {
  constructor(id: string) {
    super(`TerminalRunStoppedError: terminal run ${id} stopped before foreground attach`);
  }
}

export interface TerminalManagerOptions {
  /** The persistent workspace owner hosting the realm-resident shells. */
  owner: WorkspaceOwnerHandle;
  /**
   * Persisted cwd/env restored into each opened owner session (ADR-0146). The
   * shell is owner-resident, so the seed travels to it over `pty:open`; the PAGE
   * snapshot cache reflects it immediately for the prompt/explorer.
   */
  initialState?: { readonly cwd: string; readonly env: Record<string, string> };
}

export function createTerminalManager(opts: TerminalManagerOptions): TerminalManager {
  let owner = opts.owner;
  const sessions = new Map<string, TerminalSession>();
  let nextSessionNumber = 1;
  let nextDefaultTitleNumber = 1;
  let activeId = '';
  let disposed = false;

  function observedReady(ready: Promise<void>): Promise<void> {
    // The manager owns readiness even before a run awaits it. Keep the rejection
    // for that future run while preventing an idle session from going unhandled.
    void ready.catch(() => {});
    return ready;
  }

  async function openOwnerSession(
    claimedOwner: WorkspaceOwnerHandle,
    sid: string,
    seed?: TerminalManagerOptions['initialState'],
  ): Promise<void> {
    while (!disposed) {
      const ready = claimedOwner.openSession(sid, seed);
      const result = await Promise.race([
        ready.then(() => 'ready' as const),
        new Promise<'retry'>((resolve) =>
          setTimeout(() => resolve('retry'), OPEN_SESSION_RETRY_MS),
        ),
      ]);
      if (result === 'ready') return;
    }
  }

  const create = (title?: string): TerminalSession => {
    const number = nextSessionNumber++;
    const displayTitle = title ?? `Terminal ${nextDefaultTitleNumber++}`;
    const id = `terminal-${number}`;
    const session: TerminalSession = {
      id,
      title: displayTitle,
      status: 'idle',
      writer: null,
      activeRid: null,
      ready: observedReady(openOwnerSession(owner, id, opts.initialState)),
      dimensions: { cols: 80, rows: 24 },
      pendingInput: [],
      controlWaiters: new Set(),
      closed: false,
      generation: 0,
      stopRequested: false,
    };
    sessions.set(id, session);
    return session;
  };

  const initial = create();
  activeId = initial.id;

  function ensureNotDisposed(): void {
    if (disposed) throw new Error(DISPOSED_ERROR);
  }

  function getSession(id: string): TerminalSession {
    ensureNotDisposed();
    const session = sessions.get(id);
    if (!session) throw new Error(`Unknown terminal session: ${id}`);
    return session;
  }

  function toSnapshot(session: TerminalSession): TerminalSessionSnapshot {
    const { cwd, env } = owner.snapshot(session.id);
    return {
      id: session.id,
      title: session.title,
      cwd,
      env,
      status: session.status,
      ...(session.exitCode === undefined ? {} : { exitCode: session.exitCode }),
    };
  }

  function write(
    session: TerminalSession,
    chunk: string,
    stream: 'stdout' | 'stderr' = 'stdout',
  ): void {
    session.writer?.(chunk, stream);
  }

  function dimension(value: number, name: 'cols' | 'rows'): number {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new RangeError(`Terminal ${name} must be a positive safe integer; received ${value}`);
    }
    return value;
  }

  function controlWaiter(session: TerminalSession): ControlWaiter {
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<void>((res, rej) => {
      resolve = () => {
        if (waiter.settled) return;
        waiter.settled = true;
        session.controlWaiters.delete(waiter);
        res();
      };
      reject = (error) => {
        if (waiter.settled) return;
        waiter.settled = true;
        session.controlWaiters.delete(waiter);
        rej(error);
      };
    });
    const waiter = { settled: false, promise, resolve, reject };
    session.controlWaiters.add(waiter);
    return waiter;
  }

  function pendingInput(
    session: TerminalSession,
    kind: 'data' | 'eof',
    data?: Uint8Array,
  ): PendingInputOperation {
    return Object.assign(controlWaiter(session), { kind, data });
  }

  function claimCancellation(): ClaimCancellation {
    let reject!: (error: Error) => void;
    const promise = new Promise<never>((_resolve, rej) => {
      reject = rej;
    });
    return { promise, reject };
  }

  function rejectPending(session: TerminalSession, error: Error): void {
    session.pendingInput.splice(0);
    session.pendingResize = undefined;
    for (const waiter of [...session.controlWaiters]) waiter.reject(error);
    session.claimCancellation?.reject(error);
  }

  function settleForwarded(waiter: ControlWaiter, operation: () => Promise<void>): Promise<void> {
    if (waiter.settled) return waiter.promise;
    try {
      void operation().then(waiter.resolve, (error: unknown) => {
        waiter.reject(error instanceof Error ? error : new Error(String(error)));
      });
    } catch (error) {
      waiter.reject(error instanceof Error ? error : new Error(String(error)));
    }
    return waiter.promise;
  }

  function forwarded(session: TerminalSession, operation: () => Promise<void>): Promise<void> {
    const waiter = controlWaiter(session);
    return settleForwarded(waiter, operation);
  }

  function flushPending(
    session: TerminalSession,
    rid: string,
    claimedOwner: WorkspaceOwnerHandle,
    generation: number,
  ): void {
    if (session.generation !== generation || session.closed || disposed) return;
    const resize = session.pendingResize;
    session.pendingResize = undefined;
    if (resize) {
      let operation: Promise<void>;
      try {
        operation = claimedOwner.resize(
          session.id,
          rid,
          session.dimensions.cols,
          session.dimensions.rows,
        );
      } catch (error) {
        const cause = error instanceof Error ? error : new Error(String(error));
        for (const waiter of resize.waiters) waiter.reject(cause);
        operation = Promise.resolve();
      }
      void operation.then(
        () => {
          for (const waiter of resize.waiters) waiter.resolve();
        },
        (error: unknown) => {
          const cause = error instanceof Error ? error : new Error(String(error));
          for (const waiter of resize.waiters) waiter.reject(cause);
        },
      );
    }

    const input = session.pendingInput.splice(0);
    let prior = Promise.resolve();
    for (const operation of input) {
      prior = prior.then(async () => {
        if (operation.settled) return;
        if (session.generation !== generation || session.closed || disposed) {
          operation.reject(new Error(`ClosedHandleError: terminal run ${session.id} is closed`));
          return;
        }
        await settleForwarded(operation, () =>
          operation.kind === 'data'
            ? claimedOwner.writeStdin(session.id, rid, operation.data!)
            : claimedOwner.endStdin(session.id, rid),
        ).catch(() => {});
      });
    }
  }

  async function runLine(id: string, input: string, dims?: TerminalRunDimensions): Promise<number> {
    const session = getSession(id);
    if (session.closed) throw new Error(`ClosedHandleError: terminal session ${id} is closed`);
    const trimmed = input.trim();
    if (trimmed.length === 0) return 0;

    if (session.status === 'running') {
      write(session, 'terminal is busy\n', 'stderr');
      return 1;
    }

    session.dimensions = {
      cols: dims?.cols === undefined ? session.dimensions.cols : dimension(dims.cols, 'cols'),
      rows: dims?.rows === undefined ? session.dimensions.rows : dimension(dims.rows, 'rows'),
    };

    session.status = 'running';
    session.exitCode = undefined;
    session.stopRequested = false;
    const generation = session.generation;
    const cancellation = claimCancellation();
    session.claimCancellation = cancellation;

    try {
      await Promise.race([session.ready, cancellation.promise]);
      if (session.closed || session.generation !== generation) {
        throw new Error(`ClosedHandleError: terminal session ${id} is closed`);
      }
      const claimedOwner = owner;
      const exitCode = await claimedOwner.exec(id, input, {
        cols: session.dimensions.cols,
        rows: session.dimensions.rows,
        isTTY: true,
        onChunk: (chunk, stream) => {
          write(session, chunk, stream);
        },
        onStart: (rid) => {
          session.activeRid = rid;
          if (session.stopRequested) {
            claimedOwner.signal(id, rid);
            return;
          }
          queueMicrotask(() => flushPending(session, rid, claimedOwner, generation));
        },
      });
      session.exitCode = exitCode;
      return exitCode;
    } catch (error) {
      if (error instanceof TerminalRunStoppedError) {
        session.exitCode = 130;
        return 130;
      }
      throw error;
    } finally {
      if (session.generation === generation) {
        session.activeRid = null;
        session.status = 'idle';
        session.eofPromise = undefined;
        session.claimCancellation = undefined;
        session.stopRequested = false;
        rejectPending(session, new Error(`ClosedHandleError: terminal run ${id} settled`));
      }
    }
  }

  return {
    sessions(): TerminalSessionSnapshot[] {
      ensureNotDisposed();
      return Array.from(sessions.values(), toSnapshot);
    },
    snapshot(id: string): TerminalSessionSnapshot {
      return toSnapshot(getSession(id));
    },
    activeSessionId(): string {
      ensureNotDisposed();
      return activeId;
    },
    createSession(title?: string): TerminalSessionSnapshot {
      ensureNotDisposed();
      return toSnapshot(create(title));
    },
    select(id: string): void {
      getSession(id);
      activeId = id;
    },
    attachWriter(id: string, writer: TerminalWriter): void {
      getSession(id).writer = writer;
    },
    clear(id: string): void {
      // ANSI: erase display (2J) + scrollback (3J) + cursor home (H). A no-op
      // when no writer is attached yet (the boot's first clear may race mount).
      write(getSession(id), '\x1b[2J\x1b[3J\x1b[H');
    },
    freshConsole(id: string, banner?: string): void {
      // Clear, then re-greet: the banner survives the boot's fresh-console wipe.
      write(getSession(id), `\x1b[2J\x1b[3J\x1b[H${banner ? `${banner}\r\n` : ''}`);
    },
    writeStdin(id: string, data: TerminalRawInput): Promise<void> {
      const session = getSession(id);
      if (session.closed) {
        return Promise.reject(new Error(`ClosedHandleError: terminal session ${id} is closed`));
      }
      if (session.stopRequested) return Promise.reject(new TerminalRunStoppedError(id));
      if (session.eofPromise) {
        return Promise.reject(new Error(`StdinClosedError: stdin for ${id} has ended`));
      }
      const bytes = typeof data === 'string' ? enc.encode(data) : data;
      if (session.activeRid) {
        const claimedOwner = owner;
        const rid = session.activeRid;
        return forwarded(session, () => claimedOwner.writeStdin(id, rid, bytes));
      }
      if (session.status !== 'running') return Promise.resolve();
      const operation = pendingInput(session, 'data', bytes);
      session.pendingInput.push(operation);
      return operation.promise;
    },
    endStdin(id: string): Promise<void> {
      const session = getSession(id);
      if (session.closed) {
        return Promise.reject(new Error(`ClosedHandleError: terminal session ${id} is closed`));
      }
      if (session.stopRequested) return Promise.reject(new TerminalRunStoppedError(id));
      if (session.eofPromise) return session.eofPromise;
      if (session.activeRid) {
        const claimedOwner = owner;
        const rid = session.activeRid;
        session.eofPromise = forwarded(session, () => claimedOwner.endStdin(id, rid));
        return session.eofPromise;
      }
      if (session.status !== 'running') return Promise.resolve();
      const operation = pendingInput(session, 'eof');
      session.pendingInput.push(operation);
      session.eofPromise = operation.promise;
      return operation.promise;
    },
    resize(id: string, dims: TerminalDimensions): Promise<void> {
      const session = getSession(id);
      if (session.closed) {
        return Promise.reject(new Error(`ClosedHandleError: terminal session ${id} is closed`));
      }
      if (session.stopRequested) return Promise.reject(new TerminalRunStoppedError(id));
      session.dimensions = {
        cols: dimension(dims.cols, 'cols'),
        rows: dimension(dims.rows, 'rows'),
      };
      if (session.activeRid) {
        const claimedOwner = owner;
        const rid = session.activeRid;
        const dimensions = { ...session.dimensions };
        return forwarded(session, () =>
          claimedOwner.resize(id, rid, dimensions.cols, dimensions.rows),
        );
      }
      if (session.status !== 'running') return Promise.resolve();
      const waiter = controlWaiter(session);
      const pending = session.pendingResize ?? { waiters: [] };
      pending.waiters.push(waiter);
      session.pendingResize = pending;
      return waiter.promise;
    },
    runLine,
    async runSequence(
      id: string,
      lines: readonly string[],
      dims?: TerminalRunDimensions,
    ): Promise<number> {
      const session = getSession(id);
      let exitCode = 0;
      for (const line of lines) {
        write(session, `$ ${line}\n`);
        exitCode = await runLine(id, line, dims);
        if (exitCode !== 0) break;
      }
      return exitCode;
    },
    async rebindOwner(nextOwner: WorkspaceOwnerHandle): Promise<void> {
      ensureNotDisposed();
      owner = nextOwner;
      const ready: Promise<void>[] = [];
      for (const session of sessions.values()) {
        const error = new Error(`ClosedHandleError: terminal session ${session.id} owner rebound`);
        rejectPending(session, error);
        session.generation += 1;
        session.activeRid = null;
        session.status = 'idle';
        session.eofPromise = undefined;
        session.claimCancellation = undefined;
        session.stopRequested = false;
        if (session.closed) continue;
        session.ready = observedReady(openOwnerSession(nextOwner, session.id));
        ready.push(session.ready);
      }
      await Promise.all(ready);
    },
    stop(id: string): void {
      const session = getSession(id);
      if (session.status !== 'running' || session.stopRequested) return;
      session.stopRequested = true;
      const error = new TerminalRunStoppedError(id);
      rejectPending(session, error);
      if (session.activeRid) owner.signal(id, session.activeRid);
    },
    closeSession(id: string): Promise<void> {
      const session = getSession(id);
      if (session.closePromise) return session.closePromise;
      session.closed = true;
      session.generation += 1;
      session.writer = null;
      rejectPending(session, new Error(`ClosedHandleError: terminal session ${id} closed`));
      session.closePromise = owner.closeSession(id).then(() => {
        sessions.delete(id);
        session.writer = null;
        if (activeId === id) activeId = sessions.keys().next().value ?? '';
      });
      return session.closePromise;
    },
    dispose(): void {
      if (disposed) return; // idempotent — don't double-close owner sessions
      disposed = true;
      for (const session of sessions.values()) {
        if (session.closed) {
          session.writer = null;
          continue;
        }
        session.generation += 1;
        rejectPending(
          session,
          new Error(`ClosedHandleError: terminal manager disposed during ${session.id}`),
        );
        if (session.activeRid) owner.signal(session.id, session.activeRid);
        session.activeRid = null;
        session.stopRequested = false;
        session.closed = true;
        session.writer = null;
        void owner.closeSession(session.id).catch((error: unknown) => {
          console.error(`terminal session ${session.id} close failed during dispose`, error);
        });
      }
    },
  };
}
