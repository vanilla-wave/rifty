import { describe, expect, it } from 'vitest';
import type { TerminalHistoryFs, TerminalHistoryVfs } from './terminal-history.ts';
import { createTerminalPersistence } from './terminal-persistence.ts';
import type { TerminalStateFs, TerminalStateVfs } from './terminal-state.ts';

type TestStore = TerminalHistoryFs & TerminalStateFs & TerminalHistoryVfs & TerminalStateVfs;

function fakeStore(): TestStore {
  const files = new Map<string, Uint8Array>();
  const dirs = new Set(['/']);
  return {
    existsSync: (path) => files.has(path) || dirs.has(path),
    readFileBytesSync: (path) => {
      const bytes = files.get(path);
      if (!bytes) throw new Error(`ENOENT ${path}`);
      return bytes;
    },
    writeFileSync: (path, data) => {
      files.set(path, data);
    },
    mkdirSync: (path) => {
      dirs.add(path);
    },
    readFile: async (path) => {
      const bytes = files.get(path);
      if (!bytes) throw new Error(`ENOENT ${path}`);
      return bytes;
    },
    writeFile: async (path, data) => {
      files.set(path, data);
    },
    mkdir: async (path) => {
      dirs.add(path);
    },
  };
}

describe('terminal persistence adapter', () => {
  it('prefers the async OPFS store when it initializes', async () => {
    const opfs = fakeStore();
    const persistence = await createTerminalPersistence('/workspace', {
      createOpfs: async () => opfs,
      syncFs: () => fakeStore(),
    });

    expect(persistence.backend).toBe('opfs');
    await persistence.saveState({ cwd: '/workspace/app', env: { FOO: 'bar' } });
    await persistence.saveHistory([
      {
        command: 'pwd',
        cwd: '/workspace/app',
        mode: 'dev',
        sessionId: 'session-1',
        startedAt: '2026-06-09T20:00:00.000Z',
        finishedAt: '2026-06-09T20:00:00.010Z',
        durationMs: 10,
        exitCode: 0,
      },
    ]);
    const reloaded = await createTerminalPersistence('/workspace', {
      createOpfs: async () => opfs,
      syncFs: () => fakeStore(),
    });
    expect(reloaded.initialState).toEqual({
      cwd: '/workspace/app',
      env: { FOO: 'bar' },
    });
    expect(reloaded.initialHistory.map((item) => item.command)).toEqual(['pwd']);
  });

  it('falls back to the sync mirror when OPFS initialization fails', async () => {
    const sync = fakeStore();
    const persistence = await createTerminalPersistence('/workspace', {
      createOpfs: async () => {
        throw new Error('no opfs');
      },
      syncFs: () => sync,
    });

    expect(persistence.backend).toBe('memory');
    await persistence.saveState({ cwd: '/workspace/fallback', env: {} });
    const reloaded = await createTerminalPersistence('/workspace', {
      createOpfs: async () => {
        throw new Error('no opfs');
      },
      syncFs: () => sync,
    });
    expect(reloaded.initialState.cwd).toBe('/workspace/fallback');
  });
});
