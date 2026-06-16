import {
  type TerminalHistoryFs,
  type TerminalHistoryRecord,
  type TerminalHistoryVfs,
  loadTerminalHistory,
  loadTerminalHistoryAsync,
  saveTerminalHistory,
  saveTerminalHistoryAsync,
} from '@riftydev/terminal/history';
import {
  type TerminalState,
  type TerminalStateFs,
  type TerminalStateVfs,
  loadTerminalState,
  loadTerminalStateAsync,
  saveTerminalState,
  saveTerminalStateAsync,
} from '@riftydev/terminal/state';
import { OpfsVfs, syncMirror } from '@riftydev/vfs';

export interface TerminalPersistence {
  readonly backend: 'opfs' | 'memory';
  readonly initialHistory: readonly TerminalHistoryRecord[];
  readonly initialState: TerminalState;
  saveHistory(records: readonly TerminalHistoryRecord[]): Promise<void>;
  saveState(state: TerminalState): Promise<void>;
}

type TerminalWorkspaceFs = TerminalHistoryFs & TerminalStateFs;

export interface TerminalPersistenceDeps {
  createOpfs?: () => Promise<TerminalHistoryVfs & TerminalStateVfs>;
  syncFs?: () => TerminalWorkspaceFs;
}

async function createOpfsStore(): Promise<TerminalHistoryVfs & TerminalStateVfs> {
  const opfs = new OpfsVfs();
  await opfs.init();
  return opfs;
}

/**
 * Serialize fire-and-forget writes onto a tail promise so they apply in call
 * order. The page saves history/state best-effort (`void saveHistory(...)`) on
 * every command; without ordering, OPFS I/O load from the co-resident owner
 * (P5, ADR-0148) can land an earlier full-array write AFTER a later one, dropping
 * the most recent command. Each persistence instance gets one queue so history
 * and state writes (sharing the `.rifty/` dir) never race each other either.
 */
function createWriteQueue(): (task: () => Promise<void>) => Promise<void> {
  let tail: Promise<void> = Promise.resolve();
  return (task) => {
    const run = tail.then(task, task);
    tail = run.catch(() => {});
    return run;
  };
}

export async function createTerminalPersistence(
  defaultCwd: string,
  deps: TerminalPersistenceDeps = {},
): Promise<TerminalPersistence> {
  const enqueue = createWriteQueue();
  try {
    const opfs = await (deps.createOpfs ?? createOpfsStore)();
    return {
      backend: 'opfs',
      initialHistory: await loadTerminalHistoryAsync(opfs),
      // cwd is passed through as-is; the OWNER validates it against its tree on
      // session open (A1/A2: the page holds no store to check — see reachableCwd
      // in real-vite-bootstrap's makeShell).
      initialState: await loadTerminalStateAsync(opfs, defaultCwd),
      saveHistory: (records) => enqueue(() => saveTerminalHistoryAsync(opfs, records)),
      saveState: (state) => enqueue(() => saveTerminalStateAsync(opfs, state)),
    };
  } catch {
    // OPFS unavailable → degraded, session-local history only. The page holds no
    // authoritative store (A1/A2), so this reads the empty lazy-default mirror;
    // nothing persists across reload (honestly reported as `backend: 'memory'`).
    const workspaceFs = (deps.syncFs ?? syncMirror)();
    return {
      backend: 'memory',
      initialHistory: loadTerminalHistory(workspaceFs),
      initialState: loadTerminalState(workspaceFs, defaultCwd),
      saveHistory: (records) => enqueue(async () => saveTerminalHistory(workspaceFs, records)),
      saveState: (state) => enqueue(async () => saveTerminalState(workspaceFs, state)),
    };
  }
}
