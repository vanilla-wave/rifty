import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MemoryVfs } from '@riftydev/vfs';
import isoGit from 'isomorphic-git';
import { expect, it, vi } from 'vitest';
import { vfsToGitFs } from '../src/fs-adapter.ts';
import { makeGit } from '../src/git.ts';
import {
  type GitStatusMatrixCode,
  porcelainStatusLines,
  requireSupportedStatusEntries,
} from '../src/index.ts';
import { inspectGitStatusMatrixCode } from '../src/status.ts';

const AUTHOR = { name: 'T', email: 't@e.com', timestamp: 1_600_000_000, timezoneOffset: 0 };

const MATRIX_CODES = [
  '000',
  '003',
  '020',
  '022',
  '023',
  '100',
  '101',
  '103',
  '110',
  '111',
  '113',
  '120',
  '121',
  '122',
  '123',
] as const satisfies readonly GitStatusMatrixCode[];

type MatrixSetupOperation =
  | 'seed-head'
  | 'write-head'
  | 'write-index'
  | 'write-worktree'
  | 'add'
  | 'remove-index'
  | 'fs-rm';

interface StatusMatrixOracleCase {
  code: string;
  setup: MatrixSetupOperation[];
  porcelain: string;
}

interface StatusMatrixOracle {
  provenance: {
    gitVersion: string;
    locale: string;
    command: string;
  };
  cases: StatusMatrixOracleCase[];
}

function statusMatrixOracle(): StatusMatrixOracle {
  const path = fileURLToPath(new URL('../fixtures/status-matrix.json', import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as StatusMatrixOracle;
}

async function fresh(): Promise<{ g: ReturnType<typeof makeGit>; vfs: MemoryVfs }> {
  const vfs = new MemoryVfs();
  await vfs.mkdir('/repo', { recursive: true });
  const g = makeGit({ fs: vfsToGitFs(vfs), dir: '/repo' });
  await g.init();
  return { g, vfs };
}

async function replayMatrixSetup(
  setup: readonly MatrixSetupOperation[],
): Promise<{ g: ReturnType<typeof makeGit>; vfs: MemoryVfs }> {
  const { g, vfs } = await fresh();
  for (const operation of setup) {
    switch (operation) {
      case 'seed-head':
        await vfs.writeFile('/repo/a.txt', 'head\n');
        await g.add('a.txt');
        await g.commit({ message: 'base', author: AUTHOR });
        break;
      case 'write-head':
        await vfs.writeFile('/repo/a.txt', 'head\n');
        break;
      case 'write-index':
        await vfs.writeFile('/repo/a.txt', 'index\n');
        break;
      case 'write-worktree':
        await vfs.writeFile('/repo/a.txt', 'worktree\n');
        break;
      case 'add':
        await g.add('a.txt');
        break;
      case 'remove-index':
        await g.remove('a.txt');
        break;
      case 'fs-rm':
        await vfs.rm('/repo/a.txt');
        break;
    }
  }
  return { g, vfs };
}

async function seeded(): Promise<{ g: ReturnType<typeof makeGit>; vfs: MemoryVfs }> {
  const vfs = new MemoryVfs();
  await vfs.mkdir('/repo', { recursive: true });
  const g = makeGit({ fs: vfsToGitFs(vfs), dir: '/repo' });
  await g.init();
  await vfs.writeFile('/repo/a.txt', 'first\n');
  await g.add('a.txt');
  await g.commit({ message: 'first', author: AUTHOR });
  return { g, vfs };
}

async function linesFor(g: ReturnType<typeof makeGit>, file: string): Promise<readonly string[]> {
  const entry = requireSupportedStatusEntries(await g.status()).find((e) => e.filepath === file);
  return entry ? porcelainStatusLines(entry.status) : [];
}

// Fault classes: frozen-assumption + sibling-drift + lossy-aggregate.
it('maps every statusMatrix code to its frozen real-Git porcelain oracle', async () => {
  const oracle = statusMatrixOracle();
  expect(oracle.provenance).toEqual({
    gitVersion: '2.50.1',
    locale: 'C',
    command: 'git status --porcelain -- a.txt',
  });
  expect(oracle.cases.map(({ code }) => code)).toEqual(MATRIX_CODES);

  for (const oracleCase of oracle.cases) {
    const code = inspectGitStatusMatrixCode(oracleCase.code);
    const classifierBody = porcelainStatusLines(code)
      .map((xy) => `${xy} a.txt\n`)
      .join('');
    expect(classifierBody, code).toBe(oracleCase.porcelain);

    const { g } = await replayMatrixSetup(oracleCase.setup);
    const entry = requireSupportedStatusEntries(await g.status()).find(
      ({ filepath }) => filepath === 'a.txt',
    );
    if (code === '000') {
      expect(entry, code).toBeUndefined();
    } else {
      expect(entry?.status, code).toBe(code);
      expect(
        (entry === undefined ? [] : porcelainStatusLines(entry.status))
          .map((xy) => `${xy} a.txt\n`)
          .join(''),
        code,
      ).toBe(oracleCase.porcelain);
    }
  }

  expect(() => porcelainStatusLines('999' as GitStatusMatrixCode)).toThrow(
    /git\.status-matrix\.999/,
  );
});

// Fault class: false-fallback. One future upstream code is path-local and must
// not erase the supported siblings returned by the same statusMatrix read.
it('preserves every path when one statusMatrix entry is unsupported', async () => {
  const { g } = await fresh();
  const statusMatrix = vi.spyOn(isoGit, 'statusMatrix').mockResolvedValue([
    ['edited.txt', 1, 2, 1],
    ['future.txt', 9, 9, 9],
    ['new.txt', 0, 2, 0],
  ] as never);

  try {
    const entries = await g.status();
    expect(entries).toEqual([
      { kind: 'supported', filepath: 'edited.txt', status: '121' },
      { kind: 'unsupported', filepath: 'future.txt', rawStatusMatrixCode: '999' },
      { kind: 'supported', filepath: 'new.txt', status: '020' },
    ]);
    expect(() => requireSupportedStatusEntries(entries)).toThrow(/git\.status-matrix\.999/);
  } finally {
    statusMatrix.mockRestore();
  }
});

it.each([
  ['110', 'first\n'],
  ['120', 'recreated\n'],
] as const)('%s is reachable after staged delete plus same-path recreation', async (code, text) => {
  const { g, vfs } = await seeded();
  await g.remove('a.txt');
  await vfs.writeFile('/repo/a.txt', text);

  const entry = requireSupportedStatusEntries(await g.status()).find(
    (candidate) => candidate.filepath === 'a.txt',
  );
  expect(entry?.status).toBe(code);
  expect(entry === undefined ? [] : porcelainStatusLines(entry.status)).toEqual(['D ', '??']);
});

it('AM is reachable: stage a new file, then keep editing it', async () => {
  const { g, vfs } = await seeded();
  await vfs.writeFile('/repo/new.txt', 'added\n');
  await g.add('new.txt');
  await vfs.writeFile('/repo/new.txt', 'added then edited\n');
  expect(await linesFor(g, 'new.txt')).toEqual(['AM']);
});

it('MD is reachable: stage a modification, then delete the file on disk', async () => {
  const { g, vfs } = await seeded();
  await vfs.writeFile('/repo/a.txt', 'changed\n');
  await g.add('a.txt');
  await vfs.rm('/repo/a.txt');
  expect(await linesFor(g, 'a.txt')).toEqual(['MD']);
});

it('status is byte-read-only with respect to the Git index', async () => {
  const { g, vfs } = await seeded();
  const before = await vfs.readFile('/repo/.git/index');
  // Archive replacement can rewrite an unchanged tracked file with fresh stat
  // metadata. Status must compare it without refreshing the index cache.
  await vfs.writeFile('/repo/a.txt', 'first\n');

  expect(await linesFor(g, 'a.txt')).toEqual([]);
  expect(await vfs.readFile('/repo/.git/index')).toEqual(before);
});
