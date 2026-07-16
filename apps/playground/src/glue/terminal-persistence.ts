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
  readonly initialStateSource: 'legacy-absolute' | 'project-rooted';
  saveHistory(records: readonly TerminalHistoryRecord[]): Promise<void>;
  saveState(state: TerminalState): Promise<void>;
}

type TerminalWorkspaceFs = TerminalHistoryFs & TerminalStateFs;
type InitialTerminalState = Pick<TerminalPersistence, 'initialState' | 'initialStateSource'>;

const PROJECT_ROOTED_TERMINAL_STATE_PATH = '/workspace/.rifty/project-terminal-state.json';

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
 * (owner OPFS persistence, ADR-0148) can land an earlier full-array write AFTER a later one, dropping
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

async function loadInitialStateAsync(
  store: TerminalStateVfs,
  legacyDefaultCwd: string,
): Promise<InitialTerminalState> {
  try {
    await store.readFile(PROJECT_ROOTED_TERMINAL_STATE_PATH);
  } catch {
    return {
      initialState: await loadTerminalStateAsync(store, legacyDefaultCwd),
      initialStateSource: 'legacy-absolute',
    };
  }
  return {
    initialState: await loadTerminalStateAsync(store, '/', PROJECT_ROOTED_TERMINAL_STATE_PATH),
    initialStateSource: 'project-rooted',
  };
}

function loadInitialState(store: TerminalStateFs, legacyDefaultCwd: string): InitialTerminalState {
  if (!store.existsSync(PROJECT_ROOTED_TERMINAL_STATE_PATH)) {
    return {
      initialState: loadTerminalState(store, legacyDefaultCwd),
      initialStateSource: 'legacy-absolute',
    };
  }
  return {
    initialState: loadTerminalState(store, '/', PROJECT_ROOTED_TERMINAL_STATE_PATH),
    initialStateSource: 'project-rooted',
  };
}

export async function createTerminalPersistence(
  defaultCwd: string,
  deps: TerminalPersistenceDeps = {},
): Promise<TerminalPersistence> {
  const enqueue = createWriteQueue();
  try {
    const opfs = await (deps.createOpfs ?? createOpfsStore)();
    const initial = await loadInitialStateAsync(opfs, defaultCwd);
    return {
      backend: 'opfs',
      initialHistory: await loadTerminalHistoryAsync(opfs),
      ...initial,
      saveHistory: (records) => enqueue(() => saveTerminalHistoryAsync(opfs, records)),
      saveState: (state) =>
        enqueue(() => saveTerminalStateAsync(opfs, state, PROJECT_ROOTED_TERMINAL_STATE_PATH)),
    };
  } catch {
    // OPFS unavailable → degraded, session-local history only. The page holds no
    // authoritative store (single store owner; the page reads through ports), so
    // this reads the empty lazy-default mirror;
    // nothing persists across reload (honestly reported as `backend: 'memory'`).
    const workspaceFs = (deps.syncFs ?? syncMirror)();
    const initial = loadInitialState(workspaceFs, defaultCwd);
    return {
      backend: 'memory',
      initialHistory: loadTerminalHistory(workspaceFs),
      ...initial,
      saveHistory: (records) => enqueue(async () => saveTerminalHistory(workspaceFs, records)),
      saveState: (state) =>
        enqueue(async () =>
          saveTerminalState(workspaceFs, state, PROJECT_ROOTED_TERMINAL_STATE_PATH),
        ),
    };
  }
}
