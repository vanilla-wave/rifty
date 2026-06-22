/**
 * checkout facade — switch/restore + listFiles proven over a real
 * {@link MemoryVfs} (no mocks). Covers branch switch, already-on, create (`-b`),
 * branch-exists guard, detached HEAD, restore-from-index, pathspec no-match, and
 * the conflicting-switch guard. State conformance only (the shell renders text).
 */
import { MemoryVfs } from '@riftydev/vfs';
import { beforeEach, expect, it } from 'vitest';
import { BranchExistsError, CheckoutConflictError, PathspecError } from '../src/errors.ts';
import { vfsToGitFs } from '../src/fs-adapter.ts';
import { type Git, makeGit } from '../src/git.ts';

const AUTHOR = {
  name: 'Test',
  email: 't@example.com',
  timestamp: 1_600_000_000,
  timezoneOffset: 0,
};

let vfs: MemoryVfs;
let g: Git;

/** /r repo: main has f.txt 'one\n'; feat has f.txt 'two\n'. HEAD back on main. */
beforeEach(async () => {
  vfs = new MemoryVfs();
  await vfs.mkdir('/r', { recursive: true });
  g = makeGit({ fs: vfsToGitFs(vfs), dir: '/r' });
  await g.init();
  await vfs.writeFile('/r/f.txt', 'one\n');
  await g.add('f.txt');
  await g.commit({ message: 'one', author: AUTHOR });
  await g.checkout({ op: 'switch', ref: 'feat', create: true });
  await vfs.writeFile('/r/f.txt', 'two\n');
  await g.add('f.txt');
  await g.commit({ message: 'two', author: AUTHOR });
  await g.checkout({ op: 'switch', ref: 'main' });
});

it('switches to an existing branch and updates the worktree', async () => {
  const r = await g.checkout({ op: 'switch', ref: 'feat' });
  expect(r).toMatchObject({
    op: 'switch',
    target: 'feat',
    detached: false,
    created: false,
    alreadyOn: false,
  });
  expect(await vfs.readFileText('/r/f.txt')).toBe('two\n');
  await g.checkout({ op: 'switch', ref: 'main' });
  expect(await vfs.readFileText('/r/f.txt')).toBe('one\n');
});

it('reports already-on when switching to the current branch', async () => {
  const r = await g.checkout({ op: 'switch', ref: 'main' });
  expect(r).toMatchObject({ op: 'switch', alreadyOn: true, target: 'main' });
});

it('creates a branch with -b and switches to it', async () => {
  const r = await g.checkout({ op: 'switch', ref: 'topic', create: true });
  expect(r).toMatchObject({
    op: 'switch',
    created: true,
    target: 'topic',
    detached: false,
  });
  expect(await g.currentBranch()).toBe('topic');
});

it('rejects creating a branch that already exists', async () => {
  await expect(g.checkout({ op: 'switch', ref: 'feat', create: true })).rejects.toThrow(
    BranchExistsError,
  );
});

it('detaches HEAD when checking out a raw oid', async () => {
  const oid = await g.resolveRef('feat');
  const r = await g.checkout({ op: 'switch', ref: oid });
  expect(r).toMatchObject({ op: 'switch', detached: true, target: undefined });
  expect(await g.currentBranch()).toBeUndefined();
  expect(await g.resolveRef('HEAD')).toBe(oid);
});

it('restores a path from the index, discarding the worktree change', async () => {
  await vfs.writeFile('/r/f.txt', 'STAGED\n');
  await g.add('f.txt');
  await vfs.writeFile('/r/f.txt', 'DIRTY\n');
  const r = await g.checkout({ op: 'restore', pathspecs: ['f.txt'] });
  expect(r).toEqual({ op: 'restore', restored: ['f.txt'] });
  expect(await vfs.readFileText('/r/f.txt')).toBe('STAGED\n');
});

it('rejects a restore pathspec that matches nothing', async () => {
  await expect(g.checkout({ op: 'restore', pathspecs: ['nope.txt'] })).rejects.toThrow(
    PathspecError,
  );
});

it('rejects a conflicting branch switch', async () => {
  await vfs.writeFile('/r/f.txt', 'LOCALMOD\n');
  await expect(g.checkout({ op: 'switch', ref: 'feat' })).rejects.toThrow(CheckoutConflictError);
});

it('listFiles includes a tracked path', async () => {
  expect(await g.listFiles()).toContain('f.txt');
});

// C1 — restore from a SYMBOLIC tree-ish (branch / HEAD / tag), not just a raw sha.
it('restores a path from a branch source, updating worktree + index, HEAD unchanged', async () => {
  // On main f.txt='one'; restore from `feat` (f.txt='two').
  const r = await g.checkout({ op: 'restore', pathspecs: ['f.txt'], source: 'feat' });
  expect(r).toEqual({ op: 'restore', restored: ['f.txt'] });
  expect(await vfs.readFileText('/r/f.txt')).toBe('two\n'); // worktree = tree-ish content
  expect(await g.currentBranch()).toBe('main'); // HEAD unchanged
  // I3 — the index is updated to the tree-ish blob (staged), not just the worktree.
  // statusMatrix row for f.txt: HEAD='one'(1), workdir='two'(2), stage='two'(2) → '122'.
  const row = (await g.status()).find((s) => s.filepath === 'f.txt');
  expect(row?.status).toBe('122');
});

it('restores a path from HEAD as a symbolic source', async () => {
  await vfs.writeFile('/r/f.txt', 'DIRTY\n');
  const r = await g.checkout({ op: 'restore', pathspecs: ['f.txt'], source: 'HEAD' });
  expect(r).toEqual({ op: 'restore', restored: ['f.txt'] });
  expect(await vfs.readFileText('/r/f.txt')).toBe('one\n'); // HEAD's blob
  expect(await g.currentBranch()).toBe('main');
});

// C2 — a directory-prefix pathspec restores every file under it (recursive), not a crash.
it('restores all files under a directory pathspec (index source)', async () => {
  await vfs.mkdir('/r/d', { recursive: true });
  await vfs.writeFile('/r/d/a.txt', 'A\n');
  await vfs.writeFile('/r/d/b.txt', 'B\n');
  await g.add('d/a.txt');
  await g.add('d/b.txt');
  await vfs.writeFile('/r/d/a.txt', 'dirtyA\n');
  await vfs.writeFile('/r/d/b.txt', 'dirtyB\n');
  const r = await g.checkout({ op: 'restore', pathspecs: ['d'] });
  expect(r.op).toBe('restore');
  if (r.op === 'restore') expect(r.restored.sort()).toEqual(['d/a.txt', 'd/b.txt']);
  expect(await vfs.readFileText('/r/d/a.txt')).toBe('A\n');
  expect(await vfs.readFileText('/r/d/b.txt')).toBe('B\n');
});

// C3 — multi-pathspec restore is ALL-OR-NOTHING: one unmatched → throw, write nothing.
it('multi-pathspec restore from index is all-or-nothing on an unmatched spec', async () => {
  await vfs.writeFile('/r/f.txt', 'STAGED\n');
  await g.add('f.txt');
  await vfs.writeFile('/r/f.txt', 'DIRTY\n');
  await expect(g.checkout({ op: 'restore', pathspecs: ['f.txt', 'zzz.txt'] })).rejects.toThrow(
    PathspecError,
  );
  // The matched file is NOT modified (nothing written).
  expect(await vfs.readFileText('/r/f.txt')).toBe('DIRTY\n');
});

it('multi-pathspec restore from a tree-ish is all-or-nothing on an unmatched spec', async () => {
  await vfs.writeFile('/r/f.txt', 'DIRTY\n');
  await expect(
    g.checkout({ op: 'restore', pathspecs: ['f.txt', 'zzz.txt'], source: 'feat' }),
  ).rejects.toThrow(PathspecError);
  expect(await vfs.readFileText('/r/f.txt')).toBe('DIRTY\n'); // unchanged
});

// I3 — `-b <new> <start>` points the new branch at <start>, not HEAD.
it('creates a branch at an explicit start-point, not HEAD', async () => {
  // HEAD is on main; create `topic` starting at `feat`.
  await g.checkout({ op: 'switch', ref: 'topic', create: true, startPoint: 'feat' });
  expect(await g.resolveRef('topic')).toBe(await g.resolveRef('feat'));
  expect(await g.resolveRef('topic')).not.toBe(await g.resolveRef('main'));
});
