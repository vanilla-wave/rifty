import { notifySubscribers, runCleanupSteps } from '../fault-boundary.ts';
import type {
  TerminalManager,
  TerminalRawInput,
  TerminalRunDimensions,
  TerminalSessionSnapshot,
  TerminalWriter,
} from '../glue/terminal-manager.ts';
import { type ProjectSpec, terminalBootLines } from '../project-spec.ts';

export interface TerminalControllerSnapshot {
  readonly activeSessionId: string;
  readonly sessions: readonly TerminalSessionSnapshot[];
}

export interface TerminalProject {
  readonly spec: ProjectSpec;
  readonly root: string;
  readonly setup: 'instant' | 'from-scratch';
}

export interface TerminalControllerOptions {
  readonly manager: TerminalManager;
  /** Getter form keeps one controller bound across a host-owned project/root switch. */
  readonly project: TerminalProject | (() => TerminalProject);
}

export interface TerminalController {
  snapshot(): TerminalControllerSnapshot;
  subscribe(listener: (snapshot: TerminalControllerSnapshot) => void): () => void;
  createSession(title?: string): TerminalSessionSnapshot;
  select(id: string): void;
  /** Attach streamed stdout/stderr; the returned function detaches this writer. */
  attach(id: string, writer: TerminalWriter): () => void;
  /** Write raw terminal input to the foreground PTY run. */
  write(id: string, data: TerminalRawInput): void;
  resize(id: string, cols: number, rows: number): void;
  run(id: string, line: string, dimensions?: TerminalRunDimensions): Promise<number>;
  runSequence(
    id: string,
    lines: readonly string[],
    dimensions?: TerminalRunDimensions,
  ): Promise<number>;
  /** Run the configured project's real install/dev command in this PTY. */
  runProject(id?: string, dimensions?: TerminalRunDimensions): Promise<number>;
  stop(id: string): void;
  clear(id: string): void;
  dispose(): void;
}

export function projectBootLines(project: TerminalProject): readonly string[] {
  return terminalBootLines(project.spec, project.root, project.setup);
}

function currentProject(project: TerminalControllerOptions['project']): TerminalProject {
  return typeof project === 'function' ? project() : project;
}

function copySession(session: TerminalSessionSnapshot): TerminalSessionSnapshot {
  return { ...session, env: { ...session.env } };
}

export function createTerminalController(options: TerminalControllerOptions): TerminalController {
  const { manager } = options;
  const listeners = new Set<(snapshot: TerminalControllerSnapshot) => void>();
  const writers = new Map<string, TerminalWriter>();
  const runningSessions = new Set<string>();
  let disposed = false;

  const assertAlive = (): void => {
    if (disposed) throw new Error('terminal controller disposed');
  };

  const readSnapshot = (): TerminalControllerSnapshot => ({
    activeSessionId: manager.activeSessionId(),
    sessions: manager.sessions().map(copySession),
  });

  const publish = (): void => {
    if (disposed) return;
    const snapshot = readSnapshot();
    notifySubscribers(listeners, snapshot);
  };

  const run = async (
    id: string,
    line: string,
    dimensions?: TerminalRunDimensions,
  ): Promise<number> => {
    assertAlive();
    runningSessions.add(id);
    const result = manager.runLine(id, line, dimensions);
    publish();
    try {
      return await result;
    } finally {
      runningSessions.delete(id);
      publish();
    }
  };

  return {
    snapshot() {
      assertAlive();
      return readSnapshot();
    },
    subscribe(listener) {
      assertAlive();
      listeners.add(listener);
      notifySubscribers([listener], readSnapshot());
      return () => listeners.delete(listener);
    },
    createSession(title) {
      assertAlive();
      const session = manager.createSession(title);
      publish();
      return copySession(session);
    },
    select(id) {
      assertAlive();
      manager.select(id);
      publish();
    },
    attach(id, writer) {
      assertAlive();
      writers.set(id, writer);
      manager.attachWriter(id, writer);
      return () => {
        if (writers.get(id) !== writer) return;
        writers.delete(id);
        if (!disposed) manager.attachWriter(id, null);
      };
    },
    write(id, data) {
      assertAlive();
      manager.writeStdin(id, data);
    },
    resize(id, cols, rows) {
      assertAlive();
      manager.resize(id, { cols, rows });
    },
    run,
    async runSequence(id, lines, dimensions) {
      assertAlive();
      let exitCode = 0;
      for (const line of lines) {
        exitCode = await run(id, line, dimensions);
        if (exitCode !== 0) break;
      }
      return exitCode;
    },
    runProject(id = manager.activeSessionId(), dimensions?: TerminalRunDimensions) {
      assertAlive();
      return this.runSequence(id, projectBootLines(currentProject(options.project)), dimensions);
    },
    stop(id) {
      assertAlive();
      manager.stop(id);
    },
    clear(id) {
      assertAlive();
      manager.clear(id);
    },
    dispose() {
      if (disposed) return;
      const running = [...runningSessions];
      disposed = true;
      runningSessions.clear();
      writers.clear();
      listeners.clear();
      runCleanupSteps(
        [...running.map((id) => () => manager.stop(id)), () => manager.dispose()],
        'terminal controller dispose failed',
      );
    },
  };
}
