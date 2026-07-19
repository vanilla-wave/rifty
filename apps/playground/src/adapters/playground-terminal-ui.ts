import { type ProcessExit, shellCommandExitCode } from '@riftydev/shell';
import type { TerminalRawInput } from '@riftydev/terminal';
import type {
  ProjectRun,
  ProjectSession,
  ProjectTerminal,
  ProjectTerminalRun,
} from '../workbench/public.ts';

export interface TerminalSessionSnapshot {
  readonly id: string;
  readonly title: string;
  readonly cwd: string;
  readonly env: Record<string, string>;
  readonly status: 'idle' | 'running';
  readonly exitCode?: number;
}

const MAX_PENDING_CHARS = 1_000_000;
const OMITTED_OUTPUT = '[earlier terminal output omitted before the panel mounted]\n';

type ActiveRun = Pick<ProjectTerminalRun, 'exited' | 'stop' | 'close'>;

interface UiTerminal {
  readonly id: string;
  readonly title: string;
  readonly terminal: ProjectTerminal;
  readonly detach: () => void;
  writer: ((chunk: string, stream?: 'stdout' | 'stderr') => void) | null;
  pending: { readonly chunk: string; readonly stream: 'stdout' | 'stderr' }[];
  pendingChars: number;
  status: 'idle' | 'running';
  exitCode?: number;
  activeRun: ActiveRun | null;
  closed: boolean;
}

export interface PlaygroundProjectRunUi {
  readonly id: string;
  readonly ready: Promise<unknown>;
  readonly exited: Promise<ProcessExit>;
}

export type PlaygroundProjectLifecyclePresentation = {
  readonly kind: 'node-cli';
  readonly displayName: string;
};

export interface PlaygroundTerminalUi {
  sessions(): readonly TerminalSessionSnapshot[];
  subscribe(listener: (sessions: readonly TerminalSessionSnapshot[]) => void): () => void;
  activeSessionId(): string;
  select(id: string): void;
  startProject(
    title?: string,
    lifecycle?: PlaygroundProjectLifecyclePresentation,
  ): PlaygroundProjectRunUi;
  stopProject(): Promise<ProcessExit | undefined>;
  createSession(title?: string): TerminalSessionSnapshot;
  attach(id: string, writer: (chunk: string, stream?: 'stdout' | 'stderr') => void): void;
  runLine(
    id: string,
    line: string,
    dimensions?: { readonly cols?: number; readonly rows?: number },
  ): Promise<number>;
  write(id: string, data: TerminalRawInput): Promise<void>;
  resize(id: string, cols: number, rows: number): Promise<void>;
  stop(id: string): Promise<ProcessExit | undefined>;
  closeSession(id: string): Promise<void>;
  dispose(): Promise<void>;
}

function positiveDimension(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`Terminal ${label} must be a positive safe integer`);
  }
  return value;
}

/** UI state only; PTY, shell, cwd and process lifetime remain inside ProjectTerminal. */
export function createPlaygroundTerminalUi(session: ProjectSession<unknown>): PlaygroundTerminalUi {
  const terminals = new Map<string, UiTerminal>();
  const listeners = new Set<(sessions: readonly TerminalSessionSnapshot[]) => void>();
  let nextId = 1;
  let nextTitle = 1;
  let activeId = '';
  let disposed = false;
  let disposePromise: Promise<void> | null = null;
  let primaryRun: ProjectRun<unknown> | null = null;

  const snapshot = (terminal: UiTerminal): TerminalSessionSnapshot => {
    const ownerState = terminal.terminal.snapshot();
    return {
      id: terminal.id,
      title: terminal.title,
      cwd: ownerState.cwd,
      env: { ...ownerState.env },
      status: terminal.status,
      ...(terminal.exitCode === undefined ? {} : { exitCode: terminal.exitCode }),
    };
  };

  const snapshots = (): readonly TerminalSessionSnapshot[] =>
    Object.freeze([...terminals.values()].filter(({ closed }) => !closed).map(snapshot));

  const publish = (): void => {
    const current = snapshots();
    for (const listener of [...listeners]) {
      try {
        listener(current);
      } catch (error) {
        globalThis.reportError?.(error);
      }
    }
  };

  const assertOpen = (): void => {
    if (disposed) throw new Error('Playground terminal UI is closed');
  };

  const get = (id: string): UiTerminal => {
    assertOpen();
    const terminal = terminals.get(id);
    if (terminal === undefined || terminal.closed) throw new Error(`Unknown terminal ${id}`);
    return terminal;
  };

  const buffer = (state: UiTerminal, chunk: string, stream: 'stdout' | 'stderr'): void => {
    if (state.writer !== null) {
      state.writer(chunk, stream);
      return;
    }
    state.pending.push({ chunk, stream });
    state.pendingChars += chunk.length;
    let omitted = false;
    while (state.pendingChars > MAX_PENDING_CHARS && state.pending.length > 0) {
      const removed = state.pending.shift();
      if (removed === undefined) break;
      state.pendingChars -= removed.chunk.length;
      omitted = true;
    }
    if (omitted && state.pending[0]?.chunk !== OMITTED_OUTPUT) {
      state.pending.unshift({ chunk: OMITTED_OUTPUT, stream: 'stderr' });
      state.pendingChars += OMITTED_OUTPUT.length;
    }
  };

  const add = (terminal: ProjectTerminal, title?: string, initialOutput = ''): UiTerminal => {
    assertOpen();
    const id = `project-terminal-${String(nextId++)}`;
    const state = {
      id,
      title: title ?? `Terminal ${String(nextTitle++)}`,
      terminal,
      detach: () => {},
      writer: null,
      pending: initialOutput === '' ? [] : [{ chunk: initialOutput, stream: 'stdout' as const }],
      pendingChars: initialOutput.length,
      status: 'idle' as const,
      activeRun: null,
      closed: false,
    } satisfies UiTerminal;
    const detach = terminal.attach((chunk, stream) => buffer(state, chunk, stream));
    Object.defineProperty(state, 'detach', { value: detach, enumerable: true });
    terminals.set(id, state);
    if (activeId === '') activeId = id;
    publish();
    return state;
  };

  const settle = async (
    state: UiTerminal,
    run: ActiveRun,
    exited: Promise<ProcessExit>,
    lifecycle?: PlaygroundProjectLifecyclePresentation,
  ): Promise<ProcessExit> => {
    let exit: ProcessExit;
    try {
      exit = await exited;
      if (lifecycle?.kind === 'node-cli') {
        buffer(
          state,
          `[cli] completed with exit code ${String(shellCommandExitCode(exit))}\n`,
          'stdout',
        );
      }
    } finally {
      try {
        await run.close();
      } finally {
        if (state.activeRun === run) {
          state.activeRun = null;
          state.status = 'idle';
          publish();
        }
      }
    }
    state.exitCode = exit.code ?? undefined;
    publish();
    return exit;
  };

  const ui: PlaygroundTerminalUi = {
    sessions: snapshots,

    subscribe(listener) {
      assertOpen();
      listeners.add(listener);
      listener(snapshots());
      return () => listeners.delete(listener);
    },

    activeSessionId: () => activeId,

    select(id) {
      get(id);
      activeId = id;
      publish();
    },

    startProject(title, lifecycle) {
      assertOpen();
      const run: ProjectRun<unknown> = session.run();
      primaryRun = run;
      const initialOutput =
        lifecycle?.kind === 'node-cli' ? `cli: running ${lifecycle.displayName}\n` : '';
      const state = add(run.terminal, title ?? 'Project', initialOutput);
      state.status = 'running';
      state.activeRun = run;
      activeId = state.id;
      publish();
      const exited = settle(state, run, run.exited, lifecycle);
      void exited.catch(() => {});
      return Object.freeze({ id: state.id, ready: run.ready, exited });
    },

    stopProject() {
      assertOpen();
      return primaryRun === null ? Promise.resolve(undefined) : primaryRun.stop();
    },

    createSession(title) {
      const state = add(session.terminals.open(), title);
      activeId = state.id;
      publish();
      return snapshot(state);
    },

    attach(id, writer) {
      const state = get(id);
      state.writer = writer;
      for (const item of state.pending) writer(item.chunk, item.stream);
      state.pending = [];
      state.pendingChars = 0;
    },

    async runLine(id, line, dimensions = {}) {
      const state = get(id);
      if (line.trim().length === 0) return 0;
      if (state.activeRun !== null) throw new Error(`Terminal ${id} is busy`);
      const cols = dimensions.cols ?? 80;
      const rows = dimensions.rows ?? 24;
      await state.terminal.resize(positiveDimension(cols, 'cols'), positiveDimension(rows, 'rows'));
      const run = state.terminal.run(line);
      state.activeRun = run;
      state.status = 'running';
      state.exitCode = undefined;
      publish();
      const exit = await settle(
        state,
        run,
        run.ready.then(() => run.exited),
      );
      return exit.code ?? (exit.signal === null ? 0 : 1);
    },

    write: (id, data) => get(id).terminal.write(data),

    resize: (id, cols, rows) =>
      get(id).terminal.resize(positiveDimension(cols, 'cols'), positiveDimension(rows, 'rows')),

    stop(id) {
      const run = get(id).activeRun;
      return run === null ? Promise.resolve(undefined) : run.stop();
    },

    async closeSession(id) {
      const state = get(id);
      if (state.activeRun !== null) throw new Error(`Terminal ${id} is running`);
      const visualOrder = [...terminals.values()]
        .filter(({ closed }) => !closed)
        .map((terminal) => terminal.id);
      const closingIndex = visualOrder.indexOf(id);
      const fallbackOrder = [
        ...visualOrder.slice(0, closingIndex).reverse(),
        ...visualOrder.slice(closingIndex + 1),
      ];
      state.closed = true;
      state.detach();
      terminals.delete(id);
      if (activeId === id) {
        activeId =
          fallbackOrder.find((candidate) => terminals.get(candidate)?.closed === false) ??
          [...terminals.values()].find(({ closed }) => !closed)?.id ??
          '';
      }
      publish();
      await state.terminal.close();
    },

    dispose() {
      if (disposePromise !== null) return disposePromise;
      disposed = true;
      for (const state of terminals.values()) {
        state.detach();
        state.writer = null;
        state.pending = [];
        state.pendingChars = 0;
        state.activeRun = null;
        state.closed = true;
      }
      terminals.clear();
      listeners.clear();
      primaryRun = null;
      activeId = '';
      disposePromise = Promise.resolve();
      return disposePromise;
    },
  };

  return Object.freeze(ui);
}
