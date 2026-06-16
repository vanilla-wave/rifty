import type {
  TerminalHistoryFs,
  TerminalHistoryRecord,
  TerminalHistoryVfs,
} from '@riftydev/terminal/history';
import type { TerminalStateFs, TerminalStateVfs } from '@riftydev/terminal/state';
import { describe, expect, it } from 'vitest';
import { createTerminalPersistence } from './terminal-persistence.ts';

type TestStore = TerminalHistoryFs &
  TerminalStateFs &
  TerminalHistoryVfs &
  TerminalStateVfs & {
    statSync(path: string): { isDirectory: boolean };
  };

function fakeStore(): TestStore {
  const files = new Map<string, Uint8Array>();
  const dirs = new Set(['/']);
  return {
    existsSync: (path) => files.has(path) || dirs.has(path),
    statSync: (path) => {
      if (dirs.has(path)) return { isDirectory: true };
      if (files.has(path)) return { isDirectory: false };
      throw new Error(`ENOENT ${path}`);
    },
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
    const workspace = fakeStore();
    workspace.mkdirSync('/workspace/app', { recursive: true });
    const persistence = await createTerminalPersistence('/workspace', {
      createOpfs: async () => opfs,
      syncFs: () => workspace,
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
      syncFs: () => workspace,
    });
    expect(reloaded.initialState).toEqual({
      cwd: '/workspace/app',
      env: { FOO: 'bar' },
    });
    expect(reloaded.initialHistory.map((item) => item.command)).toEqual(['pwd']);
  });

  it('serializes saves so a slow earlier write cannot clobber a later one (P5 / OPFS race)', async () => {
    // Regression (ADR-0148 P5): the OPFS owner's write-through adds OPFS I/O load
    // that can REORDER the page's fire-and-forget history saves — an earlier
    // save(records=[a]) landing AFTER a later save(records=[a,b]) drops `b`
    // (e2e `terminal-persistence … OPFS after reload` flaked, dropping `pwd`).
    // The adapter must serialize writes so the latest save wins.
    const opfs = fakeStore();
    const workspace = fakeStore();
    // Force the FIRST history write to resolve LAST (the reorder pressure the
    // owner's OPFS traffic creates in the real browser).
    const realWrite = opfs.writeFile;
    let writeCall = 0;
    opfs.writeFile = (path, data) => {
      const slow = writeCall++ === 0;
      return new Promise<void>((resolve) => {
        setTimeout(
          () => {
            void realWrite(path, data);
            resolve();
          },
          slow ? 25 : 0,
        );
      });
    };
    const persistence = await createTerminalPersistence('/workspace', {
      createOpfs: async () => opfs,
      syncFs: () => workspace,
    });
    const rec = (command: string): TerminalHistoryRecord => ({
      command,
      cwd: '/workspace',
      mode: 'dev',
      sessionId: 's',
      startedAt: '2026-06-15T00:00:00.000Z',
      finishedAt: '2026-06-15T00:00:00.010Z',
      durationMs: 10,
      exitCode: 0,
    });
    // Two near-simultaneous fire-and-forget saves (the App.tsx call pattern).
    const p1 = persistence.saveHistory([rec('first')]);
    const p2 = persistence.saveHistory([rec('first'), rec('second')]);
    await Promise.all([p1, p2]);

    const reloaded = await createTerminalPersistence('/workspace', {
      createOpfs: async () => opfs,
      syncFs: () => workspace,
    });
    // Unserialized: the slow first write (['first']) lands last and clobbers
    // ['first','second']. Serialized: the latest array survives.
    expect(reloaded.initialHistory.map((item) => item.command)).toEqual(['first', 'second']);
  });

  it('passes the persisted cwd through as-is (cwd validation moved to the owner, A1/A2)', async () => {
    // The PAGE no longer holds a store to validate against; the OWNER resets an
    // unreachable cwd on session open (see `reachable-cwd` + makeShell). So the
    // adapter must preserve the persisted cwd verbatim, not pre-reset it.
    const opfs = fakeStore();
    const persistence = await createTerminalPersistence('/workspace', {
      createOpfs: async () => opfs,
    });
    await persistence.saveState({ cwd: '/workspace/stale', env: { FOO: 'bar' } });

    const reloaded = await createTerminalPersistence('/workspace', {
      createOpfs: async () => opfs,
    });

    expect(reloaded.initialState).toEqual({
      cwd: '/workspace/stale',
      env: { FOO: 'bar' },
    });
  });

  it('falls back to the sync mirror when OPFS initialization fails', async () => {
    const sync = fakeStore();
    sync.mkdirSync('/workspace/fallback', { recursive: true });
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
