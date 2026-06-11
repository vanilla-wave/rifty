import { type CommandContext, Shell, type StdinReader } from '@riftydev/shell';
import type { TerminalRawInput } from '@riftydev/terminal';

export type TerminalStatus = 'idle' | 'running';

export interface TerminalSessionSnapshot {
  readonly id: string;
  readonly title: string;
  readonly cwd: string;
  readonly env: Record<string, string>;
  readonly status: TerminalStatus;
  readonly exitCode?: number;
}

export interface TerminalCommandContext extends CommandContext {
  readonly sessionId: string;
}

export type TerminalCommand = (args: string[], ctx: TerminalCommandContext) => Promise<number>;

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
  shell: Shell;
  writer: TerminalWriter | null;
  active: AbortController | null;
  activeStdin: StdinQueue | null;
  activeRunToken: symbol | null;
  commandError: TerminalCommandError | null;
}

interface TerminalCommandError {
  readonly token: symbol;
  readonly error: unknown;
}

const DISPOSED_ERROR = 'Terminal manager is disposed';

export function createTerminalManager(opts: {
  cwd: string;
  env?: Record<string, string>;
  commands?: Record<string, TerminalCommand>;
}): TerminalManager {
  const commands = opts.commands ?? {};
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
      shell: new Shell({ cwd: opts.cwd, env: opts.env }),
      writer: null,
      active: null,
      activeStdin: null,
      activeRunToken: null,
      commandError: null,
    };
    for (const [name, command] of Object.entries(commands)) {
      session.shell.registerCommand(name, async (args, ctx) => {
        const runToken = session.activeRunToken;
        try {
          return await command(args, { ...ctx, sessionId: session.id });
        } catch (err) {
          if (runToken && session.activeRunToken === runToken) {
            session.commandError = { token: runToken, error: err };
          }
          throw err;
        }
      });
    }
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
    return {
      id: session.id,
      title: session.title,
      cwd: session.shell.cwd,
      env: session.shell.envSnapshot(),
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

  function commandError(session: TerminalSession): TerminalCommandError | null {
    return session.commandError;
  }

  async function runLine(id: string, input: string, dims?: TerminalRunDimensions): Promise<number> {
    const session = getSession(id);
    if (session.active) {
      write(session, 'terminal is busy\n', 'stderr');
      return 1;
    }

    const trimmed = input.trim();
    if (trimmed.length === 0) return 0;

    const controller = new AbortController();
    const stdin = new StdinQueue();
    const runToken = Symbol(session.id);
    session.active = controller;
    session.activeStdin = stdin;
    session.activeRunToken = runToken;
    session.status = 'running';
    session.exitCode = undefined;
    session.commandError = null;

    try {
      const result = await session.shell.run(input, {
        onChunk: (chunk, stream) => {
          write(session, chunk, stream);
        },
        signal: controller.signal,
        isTTY: true,
        cols: dims?.cols,
        rows: dims?.rows,
        stdin,
      });
      const error = commandError(session);
      if (error?.token === runToken) throw error.error;
      const exitCode = result.exitCode;
      session.exitCode = exitCode;
      return exitCode;
    } finally {
      if (session.active === controller) session.active = null;
      if (session.activeStdin === stdin) session.activeStdin = null;
      if (session.activeRunToken === runToken) session.activeRunToken = null;
      if (commandError(session)?.token === runToken) session.commandError = null;
      stdin.close();
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
    writeStdin(id: string, data: TerminalRawInput): void {
      getSession(id).activeStdin?.write(data);
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
      getSession(id).active?.abort();
    },
    dispose(): void {
      disposed = true;
      for (const session of sessions.values()) {
        const active = session.active;
        session.active = null;
        session.activeStdin?.close();
        session.activeStdin = null;
        session.activeRunToken = null;
        session.commandError = null;
        session.writer = null;
        active?.abort();
      }
    },
  };
}

class StdinQueue implements StdinReader {
  readonly #enc = new TextEncoder();
  readonly #chunks: Uint8Array[] = [];
  readonly #readers: Array<(chunk: Uint8Array | null) => void> = [];
  #closed = false;

  write(data: TerminalRawInput): void {
    if (this.#closed) return;
    const chunk = typeof data === 'string' ? this.#enc.encode(data) : data;
    const reader = this.#readers.shift();
    if (reader) {
      reader(chunk);
      return;
    }
    this.#chunks.push(chunk);
  }

  read(): Promise<Uint8Array | null> {
    const chunk = this.#chunks.shift();
    if (chunk) return Promise.resolve(chunk);
    if (this.#closed) return Promise.resolve(null);
    return new Promise((resolve) => {
      this.#readers.push(resolve);
    });
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const reader of this.#readers.splice(0)) reader(null);
  }
}
