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

interface CwdValidator {
  statSync(path: string): { isDirectory: boolean };
}

type TerminalWorkspaceFs = TerminalHistoryFs & TerminalStateFs & CwdValidator;

export interface TerminalPersistenceDeps {
  createOpfs?: () => Promise<TerminalHistoryVfs & TerminalStateVfs>;
  syncFs?: () => TerminalWorkspaceFs;
}

async function createOpfsStore(): Promise<TerminalHistoryVfs & TerminalStateVfs> {
  const opfs = new OpfsVfs();
  await opfs.init();
  return opfs;
}

function validCwd(fs: CwdValidator, cwd: string): boolean {
  try {
    return fs.statSync(cwd).isDirectory;
  } catch {
    return false;
  }
}

function withReachableCwd(
  state: TerminalState,
  defaultCwd: string,
  fs: CwdValidator,
): TerminalState {
  return validCwd(fs, state.cwd) ? state : { ...state, cwd: defaultCwd };
}

export async function createTerminalPersistence(
  defaultCwd: string,
  deps: TerminalPersistenceDeps = {},
): Promise<TerminalPersistence> {
  const workspaceFs = (deps.syncFs ?? syncMirror)();
  try {
    const opfs = await (deps.createOpfs ?? createOpfsStore)();
    const initialState = await loadTerminalStateAsync(opfs, defaultCwd);
    return {
      backend: 'opfs',
      initialHistory: await loadTerminalHistoryAsync(opfs),
      initialState: withReachableCwd(initialState, defaultCwd, workspaceFs),
      saveHistory: (records) => saveTerminalHistoryAsync(opfs, records),
      saveState: (state) => saveTerminalStateAsync(opfs, state),
    };
  } catch {
    return {
      backend: 'memory',
      initialHistory: loadTerminalHistory(workspaceFs),
      initialState: withReachableCwd(
        loadTerminalState(workspaceFs, defaultCwd),
        defaultCwd,
        workspaceFs,
      ),
      saveHistory: async (records) => saveTerminalHistory(workspaceFs, records),
      saveState: async (state) => saveTerminalState(workspaceFs, state),
    };
  }
}
