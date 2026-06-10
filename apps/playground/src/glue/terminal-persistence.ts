import { OpfsVfs, syncMirror } from '@riftydev/vfs';
import {
  type TerminalHistoryFs,
  type TerminalHistoryRecord,
  type TerminalHistoryVfs,
  loadTerminalHistory,
  loadTerminalHistoryAsync,
  saveTerminalHistory,
  saveTerminalHistoryAsync,
} from './terminal-history.ts';
import {
  type TerminalState,
  type TerminalStateFs,
  type TerminalStateVfs,
  loadTerminalState,
  loadTerminalStateAsync,
  saveTerminalState,
  saveTerminalStateAsync,
} from './terminal-state.ts';

export interface TerminalPersistence {
  readonly backend: 'opfs' | 'memory';
  readonly initialHistory: readonly TerminalHistoryRecord[];
  readonly initialState: TerminalState;
  saveHistory(records: readonly TerminalHistoryRecord[]): Promise<void>;
  saveState(state: TerminalState): Promise<void>;
}

export interface TerminalPersistenceDeps {
  createOpfs?: () => Promise<TerminalHistoryVfs & TerminalStateVfs>;
  syncFs?: () => TerminalHistoryFs & TerminalStateFs;
}

async function createOpfsStore(): Promise<TerminalHistoryVfs & TerminalStateVfs> {
  const opfs = new OpfsVfs();
  await opfs.init();
  return opfs;
}

export async function createTerminalPersistence(
  defaultCwd: string,
  deps: TerminalPersistenceDeps = {},
): Promise<TerminalPersistence> {
  try {
    const opfs = await (deps.createOpfs ?? createOpfsStore)();
    return {
      backend: 'opfs',
      initialHistory: await loadTerminalHistoryAsync(opfs),
      initialState: await loadTerminalStateAsync(opfs, defaultCwd),
      saveHistory: (records) => saveTerminalHistoryAsync(opfs, records),
      saveState: (state) => saveTerminalStateAsync(opfs, state),
    };
  } catch {
    const fs = (deps.syncFs ?? syncMirror)();
    return {
      backend: 'memory',
      initialHistory: loadTerminalHistory(fs),
      initialState: loadTerminalState(fs, defaultCwd),
      saveHistory: async (records) => saveTerminalHistory(fs, records),
      saveState: async (state) => saveTerminalState(fs, state),
    };
  }
}
