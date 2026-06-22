/**
 * diff() — per-file changes between the HEAD tree and the working dir, proven
 * over a real {@link MemoryVfs} (no mocks). Structured (not byte-exact git-diff
 * text). lineDiff is exercised directly as a pure string→hunks unit.
 */
import { MemoryVfs } from '@riftydev/vfs';
import { expect, it } from 'vitest';
import { vfsToGitFs } from '../src/fs-adapter.ts';
import { makeGit } from '../src/git.ts';
import { lineDiff } from '../src/line-diff.ts';

const AUTHOR = {
  name: 'Test',
  email: 't@example.com',
  timestamp: 1_600_000_000,
  timezoneOffset: 0,
};

/** All hunk lines of an entry, flattened, for membership asserts. */
function allLines(hunks: { lines: string[] }[]): string[] {
  return hunks.flatMap((h) => h.lines);
}

it('reports a modified file with line-level changes + context', async () => {
  const vfs = new MemoryVfs();
  await vfs.mkdir('/repo', { recursive: true });
  const g = makeGit({ fs: vfsToGitFs(vfs), dir: '/repo' });
  await g.init();
  await vfs.writeFile('/repo/a.txt', 'one\ntwo\nthree\n');
  await g.add('a.txt');
  await g.commit({ message: 'first', author: AUTHOR });

  await vfs.writeFile('/repo/a.txt', 'one\nTWO\nthree\nfour\n');

  const d = await g.diff();
  expect(d).toHaveLength(1);
  const [entry] = d;
  expect(entry?.filepath).toBe('a.txt');
  expect(entry?.change).toBe('modify');
  const lines = allLines(entry?.hunks ?? []);
  expect(lines).toContain('-two');
  expect(lines).toContain('+TWO');
  expect(lines).toContain('+four');
  expect(lines).toContain(' one');
});

it('reports an added (committed-then-new) file as all + lines', async () => {
  const vfs = new MemoryVfs();
  await vfs.mkdir('/repo', { recursive: true });
  const g = makeGit({ fs: vfsToGitFs(vfs), dir: '/repo' });
  await g.init();
  await vfs.writeFile('/repo/base.txt', 'base\n');
  await g.add('base.txt');
  await g.commit({ message: 'first', author: AUTHOR });

  await vfs.writeFile('/repo/new.txt', 'alpha\nbeta\n');

  const d = await g.diff();
  const added = d.find((e) => e.filepath === 'new.txt');
  expect(added?.change).toBe('add');
  const lines = allLines(added?.hunks ?? []);
  expect(lines).toEqual(['+alpha', '+beta']);
});

it('reports a deleted (committed-then-removed) file as all - lines', async () => {
  const vfs = new MemoryVfs();
  await vfs.mkdir('/repo', { recursive: true });
  const g = makeGit({ fs: vfsToGitFs(vfs), dir: '/repo' });
  await g.init();
  await vfs.writeFile('/repo/gone.txt', 'x\ny\n');
  await g.add('gone.txt');
  await g.commit({ message: 'first', author: AUTHOR });

  await vfs.rm('/repo/gone.txt');

  const d = await g.diff();
  const deleted = d.find((e) => e.filepath === 'gone.txt');
  expect(deleted?.change).toBe('delete');
  const lines = allLines(deleted?.hunks ?? []);
  expect(lines).toEqual(['-x', '-y']);
});

it('emits no entry for an unchanged committed file', async () => {
  const vfs = new MemoryVfs();
  await vfs.mkdir('/repo', { recursive: true });
  const g = makeGit({ fs: vfsToGitFs(vfs), dir: '/repo' });
  await g.init();
  await vfs.writeFile('/repo/same.txt', 'unchanged\n');
  await g.add('same.txt');
  await g.commit({ message: 'first', author: AUTHOR });

  const d = await g.diff();
  expect(d).toHaveLength(0);
});

// --- lineDiff unit: pure string → hunks ---

it('lineDiff distinguishes a changed middle line from surrounding context', () => {
  const hunks = lineDiff('a\nb\nc\n', 'a\nB\nc\n');
  expect(hunks).toHaveLength(1);
  const [h] = hunks;
  expect(h?.lines).toEqual([' a', '-b', '+B', ' c']);
  expect(h?.oldStart).toBe(1);
  expect(h?.newStart).toBe(1);
  expect(h?.oldLines).toBe(3);
  expect(h?.newLines).toBe(3);
});

it('lineDiff on identical text yields no hunks', () => {
  expect(lineDiff('a\nb\n', 'a\nb\n')).toEqual([]);
});

it('lineDiff appends new trailing lines with leading context', () => {
  const hunks = lineDiff('a\nb\n', 'a\nb\nc\n');
  expect(hunks).toHaveLength(1);
  const [h] = hunks;
  expect(h?.lines).toEqual([' a', ' b', '+c']);
});
