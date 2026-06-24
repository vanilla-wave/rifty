/**
 * diff() — unstaged per-file changes (index ↔ working dir, like bare `git diff`),
 * proven over a real {@link MemoryVfs} (no mocks). Structured (not byte-exact
 * git-diff text). UNTRACKED and IGNORED files are NOT shown (real git diff never
 * shows them). lineDiff is exercised directly as a pure string→hunks unit.
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

it('does NOT show an untracked file (bare git diff = index ↔ workdir)', async () => {
  const vfs = new MemoryVfs();
  await vfs.mkdir('/repo', { recursive: true });
  const g = makeGit({ fs: vfsToGitFs(vfs), dir: '/repo' });
  await g.init();
  await vfs.writeFile('/repo/base.txt', 'base\n');
  await g.add('base.txt');
  await g.commit({ message: 'first', author: AUTHOR });

  // A brand-new file that was never `git add`ed is untracked → real `git diff`
  // shows nothing for it.
  await vfs.writeFile('/repo/new.txt', 'alpha\nbeta\n');

  const d = await g.diff();
  expect(d.find((e) => e.filepath === 'new.txt')).toBeUndefined();
});

it('does NOT show a .gitignore-ignored file', async () => {
  const vfs = new MemoryVfs();
  await vfs.mkdir('/repo', { recursive: true });
  const g = makeGit({ fs: vfsToGitFs(vfs), dir: '/repo' });
  await g.init();
  await vfs.writeFile('/repo/.gitignore', 'node_modules/\n');
  await g.add('.gitignore');
  await g.commit({ message: 'first', author: AUTHOR });

  await vfs.mkdir('/repo/node_modules', { recursive: true });
  await vfs.writeFile('/repo/node_modules/dep.js', 'module.exports = 1\n');

  const d = await g.diff();
  expect(d.some((e) => e.filepath.startsWith('node_modules/'))).toBe(false);
});

it('shows a staged-then-further-edited file as the UNSTAGED delta only', async () => {
  const vfs = new MemoryVfs();
  await vfs.mkdir('/repo', { recursive: true });
  const g = makeGit({ fs: vfsToGitFs(vfs), dir: '/repo' });
  await g.init();
  await vfs.writeFile('/repo/f.txt', 'v1\n');
  await g.add('f.txt');
  await g.commit({ message: 'first', author: AUTHOR });

  // stage v2, then edit the worktree to v3 — bare git diff = index(v2) ↔ workdir(v3).
  await vfs.writeFile('/repo/f.txt', 'v2\n');
  await g.add('f.txt');
  await vfs.writeFile('/repo/f.txt', 'v3\n');

  const d = await g.diff();
  const entry = d.find((e) => e.filepath === 'f.txt');
  expect(entry?.change).toBe('modify');
  const lines = allLines(entry?.hunks ?? []);
  expect(lines).toContain('-v2');
  expect(lines).toContain('+v3');
  expect(lines).not.toContain('-v1'); // v1 is committed+staged-over — not in the unstaged delta
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

it('head-workdir diff reports an index deletion even if the file remains untracked on disk', async () => {
  const vfs = new MemoryVfs();
  await vfs.mkdir('/repo', { recursive: true });
  const g = makeGit({ fs: vfsToGitFs(vfs), dir: '/repo' });
  await g.init();
  await vfs.writeFile('/repo/a.txt', 'tracked\n');
  await g.add('a.txt');
  await g.commit({ message: 'first', author: AUTHOR });

  await g.remove('a.txt');

  const d = await g.diff({ kind: 'head-workdir' });
  const deleted = d.find((e) => e.filepath === 'a.txt');
  expect(deleted?.change).toBe('delete');
  expect(allLines(deleted?.hunks ?? [])).toEqual(['-tracked']);
  expect(await vfs.readFile('/repo/a.txt')).toEqual(new TextEncoder().encode('tracked\n'));
});

it('diff with a missing pathspec is an empty diff, not a pathspec error', async () => {
  const vfs = new MemoryVfs();
  await vfs.mkdir('/repo', { recursive: true });
  const g = makeGit({ fs: vfsToGitFs(vfs), dir: '/repo' });
  await g.init();
  await vfs.writeFile('/repo/a.txt', 'tracked\n');
  await g.add('a.txt');
  await g.commit({ message: 'first', author: AUTHOR });

  await vfs.writeFile('/repo/a.txt', 'changed\n');
  await g.add('a.txt');

  await expect(g.diff({ kind: 'unstaged', pathspecs: ['missing.txt'] })).resolves.toEqual([]);
  await expect(g.diff({ kind: 'staged', pathspecs: ['missing.txt'] })).resolves.toEqual([]);
});

it('diff pathspecs accept a directory with a trailing slash', async () => {
  const vfs = new MemoryVfs();
  await vfs.mkdir('/repo/d', { recursive: true });
  const g = makeGit({ fs: vfsToGitFs(vfs), dir: '/repo' });
  await g.init();
  await vfs.writeFile('/repo/d/a.txt', 'one\n');
  await g.add('d/a.txt');
  await g.commit({ message: 'first', author: AUTHOR });

  await vfs.writeFile('/repo/d/a.txt', 'two\n');

  const d = await g.diff({ kind: 'head-workdir', pathspecs: ['d/'] });
  expect(d.map((e) => e.filepath)).toEqual(['d/a.txt']);
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

it('reports a changed BINARY file as binary (no mojibake line-diff)', async () => {
  const vfs = new MemoryVfs();
  await vfs.mkdir('/repo', { recursive: true });
  const g = makeGit({ fs: vfsToGitFs(vfs), dir: '/repo' });
  await g.init();
  // A blob with a NUL byte is binary (git's heuristic).
  await vfs.writeFile('/repo/img.bin', new Uint8Array([0x89, 0x50, 0x00, 0x01, 0xff]));
  await g.add('img.bin');
  await g.commit({ message: 'first', author: AUTHOR });
  await vfs.writeFile('/repo/img.bin', new Uint8Array([0x89, 0x50, 0x00, 0x02, 0xfe]));

  const d = await g.diff();
  const entry = d.find((e) => e.filepath === 'img.bin');
  expect(entry?.change).toBe('modify');
  expect(entry?.binary).toBe(true);
  expect(entry?.hunks).toEqual([]); // never a lossy text hunk
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
