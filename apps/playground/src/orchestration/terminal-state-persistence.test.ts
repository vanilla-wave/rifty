import { describe, expect, it, vi } from 'vitest';
import { createTerminalStatePersistence } from './terminal-state-persistence.ts';

// Behavioral heirs of the retired App.test terminal-env greps (epic
// playground-testable-core, slice 4b): ONE terminal-state file, partial
// updates never wipe the other half.

const DEV_CMD = { line: 'node server.js', cwd: '/scratch' };

function harness(devCommand?: typeof DEV_CMD) {
  const saveState = vi.fn();
  const flow = createTerminalStatePersistence({
    initialState: { cwd: '/', env: { A: '1' }, devCommand },
    saveState,
    sessionState: () => ({ cwd: '/scratch/src', env: { PATH: '/bin', FOO: 'bar' } }),
  });
  return { saveState, flow };
}

describe('terminal-state persistence (single snapshot file)', () => {
  it('persists the live session cwd AND env — never an emptied env', () => {
    const h = harness();
    h.flow.persistTerminalState('t1');
    expect(h.saveState).toHaveBeenCalledWith({
      cwd: '/scratch/src',
      env: { PATH: '/bin', FOO: 'bar' },
      devCommand: undefined,
    });
  });

  it('a cwd/env save carries the recorded dev command along (reload-restore survives)', () => {
    const h = harness(DEV_CMD);
    h.flow.persistTerminalState('t1');
    expect(h.saveState).toHaveBeenCalledWith(expect.objectContaining({ devCommand: DEV_CMD }));
  });

  it('recording a dev command carries the LAST saved cwd/env along', () => {
    const h = harness();
    h.flow.persistTerminalState('t1');
    h.flow.persistDevCommand(DEV_CMD);
    expect(h.saveState).toHaveBeenLastCalledWith({
      cwd: '/scratch/src',
      env: { PATH: '/bin', FOO: 'bar' },
      devCommand: DEV_CMD,
    });
  });

  it('clearing the dev command persists the clear without touching cwd/env', () => {
    const h = harness(DEV_CMD);
    h.flow.persistDevCommand(undefined);
    expect(h.saveState).toHaveBeenCalledWith({
      cwd: '/',
      env: { A: '1' },
      devCommand: undefined,
    });
  });
});
