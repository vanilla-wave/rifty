/**
 * Terminal session manager — PAGE-side pty port client (ADR-0146 P2).
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

export type TerminalWriter = (chunk: string, stream?: 'stdout' | 'stderr') => void;

export interface TerminalManager {
  sessions(): TerminalSessionSnapshot[];
  snapshot(id: string): TerminalSessionSnapshot;
  activeSessionId(): string;
  createSession(title?: string): TerminalSessionSnapshot;
  select(id: string): void;
  attachWriter(id: string, writer: TerminalWriter): void;
  /** Wipe the session's screen + scrollback (e.g. when switching projects). */
  clear(id: string): void;
  writeStdin(id: string, data: TerminalRawInput): void;
  runLine(id: string, input: string, dims?: TerminalRunDimensions): Promise<number>;
  runSequence(id: string, lines: readonly string[], dims?: TerminalRunDimensions): Promise<number>;
  stop(id: string): void;
  dispose(): void;
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
}

const DISPOSED_ERROR = 'Terminal manager is disposed';
const enc = new TextEncoder();

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
  const owner = opts.owner;
  const sessions = new Map<string, TerminalSession>();
  let nextSessionNumber = 1;
  let nextDefaultTitleNumber = 1;
  let activeId = '';
  let disposed = false;

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
      ready: owner.openSession(id, opts.initialState),
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

  async function runLine(id: string, input: string, dims?: TerminalRunDimensions): Promise<number> {
    const session = getSession(id);
    if (session.activeRid) {
      write(session, 'terminal is busy\n', 'stderr');
      return 1;
    }

    const trimmed = input.trim();
    if (trimmed.length === 0) return 0;

    session.status = 'running';
    session.exitCode = undefined;

    await session.ready;
    try {
      const exitCode = await owner.exec(id, input, {
        cols: dims?.cols ?? 80,
        rows: dims?.rows ?? 24,
        isTTY: true,
        onChunk: (chunk, stream) => {
          write(session, chunk, stream);
        },
        onStart: (rid) => {
          session.activeRid = rid;
        },
      });
      session.exitCode = exitCode;
      return exitCode;
    } finally {
      session.activeRid = null;
      session.status = 'idle';
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
    writeStdin(id: string, data: TerminalRawInput): void {
      const session = getSession(id);
      if (!session.activeRid) return;
      const bytes = typeof data === 'string' ? enc.encode(data) : data;
      owner.writeStdin(id, session.activeRid, bytes);
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
    stop(id: string): void {
      const session = getSession(id);
      if (session.activeRid) owner.signal(id, session.activeRid);
    },
    dispose(): void {
      if (disposed) return; // idempotent — don't double-close owner sessions
      disposed = true;
      for (const session of sessions.values()) {
        if (session.activeRid) owner.signal(session.id, session.activeRid);
        session.activeRid = null;
        session.writer = null;
        owner.closeSession(session.id);
      }
    },
  };
}
