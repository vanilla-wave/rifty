/**
 * Terminal-state persistence — headless core extracted from App.tsx (ADR-0197,
 * epic playground-testable-core, slice 4b). One terminal-state file holds
 * cwd/env AND the recorded dev command (reload-restore): each partial update
 * re-persists the WHOLE snapshot so a later cwd/env save never wipes the
 * recorded dev command (and vice versa).
 */
import type { TerminalDevCommand } from '@riftydev/terminal/state';

export interface TerminalShellState {
  readonly cwd: string;
  readonly env: Record<string, string>;
}

export interface TerminalStateSnapshot extends TerminalShellState {
  readonly devCommand?: TerminalDevCommand | undefined;
}

export interface TerminalStatePersistenceDeps {
  initialState: TerminalStateSnapshot;
  saveState(state: TerminalStateSnapshot): Promise<void> | void;
  /** Live session snapshot (cwd/env at command completion). */
  sessionState(id: string): TerminalShellState;
}

export interface TerminalStatePersistence {
  /** Persist a session's cwd/env; the recorded dev command rides along. */
  persistTerminalState(id: string): void;
  /** Record/clear the dev command; the last saved cwd/env ride along. */
  persistDevCommand(next: TerminalDevCommand | undefined): void;
}

export function createTerminalStatePersistence(
  deps: TerminalStatePersistenceDeps,
): TerminalStatePersistence {
  // Recorded dev command (reload-restore): the shell line that produced the
  // RUNNING dev server + its exec-time cwd. Persisted alongside cwd/env so a
  // reload relaunches the REAL command (a fork may have swapped vite for another
  // server), not the preset template's boot line.
  let savedDevCommand: TerminalDevCommand | undefined = deps.initialState.devCommand;
  let savedShellState: TerminalShellState = {
    cwd: deps.initialState.cwd,
    env: deps.initialState.env,
  };

  function persistTerminalSnapshot(): void {
    void deps.saveState({ ...savedShellState, devCommand: savedDevCommand });
  }

  function persistTerminalState(id: string): void {
    const session = deps.sessionState(id);
    savedShellState = { cwd: session.cwd, env: session.env };
    persistTerminalSnapshot();
  }

  function persistDevCommand(next: TerminalDevCommand | undefined): void {
    savedDevCommand = next;
    persistTerminalSnapshot();
  }

  return { persistTerminalState, persistDevCommand };
}
