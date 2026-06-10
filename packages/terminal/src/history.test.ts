import { describe, expect, it } from 'vitest';
import {
  TERMINAL_HISTORY_PATH,
  type TerminalHistoryFs,
  type TerminalHistoryRecord,
  type TerminalHistoryVfs,
  addTerminalHistoryRecord,
  loadTerminalHistory,
  loadTerminalHistoryAsync,
  saveTerminalHistory,
  saveTerminalHistoryAsync,
  searchTerminalHistory,
} from './history.ts';

const baseRecord: TerminalHistoryRecord = {
  command: 'echo one',
  cwd: '/workspace',
  mode: 'dev',
  sessionId: 'session-1',
  startedAt: '2026-06-09T20:00:00.000Z',
  finishedAt: '2026-06-09T20:00:00.010Z',
  durationMs: 10,
  exitCode: 0,
};

function record(command: string, startedAt: string, exitCode = 0): TerminalHistoryRecord {
  return { ...baseRecord, command, startedAt, finishedAt: startedAt, exitCode };
}

function fakeFs(): TerminalHistoryFs {
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
  };
}

function fakeVfs(): TerminalHistoryVfs {
  const fs = fakeFs();
  return {
    readFile: async (path) => fs.readFileBytesSync(path),
    writeFile: async (path, data) => fs.writeFileSync(path, data),
    mkdir: async (path, options) => fs.mkdirSync(path, options),
  };
}

describe('terminal history store', () => {
  it('loads empty history when the file is absent or malformed', () => {
    const fs = fakeFs();
    expect(loadTerminalHistory(fs)).toEqual([]);
    fs.mkdirSync('/workspace/.rifty', { recursive: true });
    fs.writeFileSync(TERMINAL_HISTORY_PATH, new TextEncoder().encode('{ nope'));
    expect(loadTerminalHistory(fs)).toEqual([]);
  });

  it('saves records under /workspace/.rifty and loads them back newest first', () => {
    const fs = fakeFs();
    const records = [
      record('npm test', '2026-06-09T20:02:00.000Z'),
      record('ls src', '2026-06-09T20:01:00.000Z'),
    ];
    saveTerminalHistory(fs, records);
    expect(loadTerminalHistory(fs)).toEqual(records);
  });

  it('round-trips through an async VFS store', async () => {
    const fs = fakeVfs();
    const records = [record('npm test', '2026-06-09T20:02:00.000Z')];
    await saveTerminalHistoryAsync(fs, records);
    expect(await loadTerminalHistoryAsync(fs)).toEqual(records);
  });

  it('adds non-empty records and truncates to the limit', () => {
    const records = addTerminalHistoryRecord(
      [record('old', '2026-06-09T20:01:00.000Z')],
      record('new', '2026-06-09T20:02:00.000Z'),
      1,
    );
    expect(records.map((item) => item.command)).toEqual(['new']);
    expect(addTerminalHistoryRecord(records, record('   ', '2026-06-09T20:03:00.000Z'))).toEqual(
      records,
    );
  });

  it('searches command/cwd/mode newest first', () => {
    const records = [
      record('npm test', '2026-06-09T20:03:00.000Z', 1),
      record('ls src', '2026-06-09T20:02:00.000Z'),
      { ...record('cat package.json', '2026-06-09T20:01:00.000Z'), cwd: '/tmp' },
    ];
    expect(searchTerminalHistory(records, 'npm')).toEqual([records[0]]);
    expect(searchTerminalHistory(records, '/tmp')).toEqual([records[2]]);
    expect(searchTerminalHistory(records, '', 2).map((item) => item.command)).toEqual([
      'npm test',
      'ls src',
    ]);
  });
});
