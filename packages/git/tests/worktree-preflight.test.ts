/**
 * Git worktree mutations publish their complete path set before touching bytes.
 * The host owns the reserved-path policy; this package only owns the operation
 * planning seam.
 */
import { MemoryVfs } from '@riftydev/vfs';
import { expect, it } from 'vitest';
import { vfsToGitFs } from '../src/fs-adapter.ts';
import { type Git, makeGit } from '../src/git.ts';

const AUTHOR = {
  name: 'Test',
  email: 't@example.com',
  timestamp: 1_600_000_000,
  timezoneOffset: 0,
};
const CLAIM = 'node_modules/.rifty-install-stamp.json';

function eperm(path: string): Error & { code: string } {
  return Object.assign(new Error(`EPERM: reserved install claim, '${path}'`), { code: 'EPERM' });
}

function guardedGit(vfs: MemoryVfs, calls: string[][] = []): Git {
  return makeGit({
    fs: vfsToGitFs(vfs),
    dir: '/r',
    assertPortablePaths(paths) {
      calls.push([...paths]);
      const claim = paths.find((path) => path.endsWith(`/${CLAIM}`));
      if (claim !== undefined) throw eperm(claim);
    },
  });
}

async function branchWithClaim(): Promise<{
  vfs: MemoryVfs;
  guarded: Git;
  main: string;
  feat: string;
  calls: string[][];
}> {
  const vfs = new MemoryVfs();
  await vfs.mkdir('/r', { recursive: true });
  const git = makeGit({ fs: vfsToGitFs(vfs), dir: '/r' });
  await git.init();
  await vfs.writeFile('/r/a.txt', 'main\n');
  await git.add('a.txt');
  const main = await git.commit({ message: 'main', author: AUTHOR });

  await git.checkout({ op: 'switch', ref: 'feat', create: true });
  await vfs.writeFile('/r/a.txt', 'feat\n');
  await vfs.mkdir('/r/node_modules', { recursive: true });
  await vfs.writeFile(`/r/${CLAIM}`, 'foreign claim\n');
  await git.add('a.txt');
  await git.add(CLAIM, { force: true });
  const feat = await git.commit({ message: 'feat', author: AUTHOR });
  await git.checkout({ op: 'switch', ref: 'main' });

  const calls: string[][] = [];
  return { vfs, guarded: guardedGit(vfs, calls), main, feat, calls };
}

it('hard reset rejects the complete target set before an earlier ordinary path mutates', async () => {
  const { vfs, guarded, main, feat, calls } = await branchWithClaim();

  await expect(guarded.reset({ target: feat, mode: 'hard' })).rejects.toMatchObject({
    code: 'EPERM',
  });

  expect(await vfs.readFileText('/r/a.txt')).toBe('main\n');
  expect(await vfs.exists(`/r/${CLAIM}`)).toBe(false);
  expect(await guarded.resolveRef('HEAD')).toBe(main);
  expect(calls).toContainEqual(['/r/a.txt', `/r/${CLAIM}`]);
});

it('multi-path restore rejects before its first worktree write', async () => {
  const { vfs, guarded } = await branchWithClaim();

  await expect(
    guarded.checkout({ op: 'restore', source: 'feat', pathspecs: ['a.txt', CLAIM] }),
  ).rejects.toMatchObject({ code: 'EPERM' });

  expect(await vfs.readFileText('/r/a.txt')).toBe('main\n');
  expect(await vfs.exists(`/r/${CLAIM}`)).toBe(false);
});

it('index restore publishes every staged path before restoring the first one', async () => {
  const { vfs, guarded } = await branchWithClaim();
  const unguarded = makeGit({ fs: vfsToGitFs(vfs), dir: '/r' });
  await unguarded.checkout({ op: 'restore', source: 'feat', pathspecs: ['a.txt', CLAIM] });
  await vfs.writeFile('/r/a.txt', 'dirty after stage\n');

  await expect(
    guarded.checkout({ op: 'restore', pathspecs: ['a.txt', CLAIM] }),
  ).rejects.toMatchObject({ code: 'EPERM' });

  expect(await vfs.readFileText('/r/a.txt')).toBe('dirty after stage\n');
  expect(await vfs.readFileText(`/r/${CLAIM}`)).toBe('foreign claim\n');
});

it('branch switch rejects before changing HEAD or worktree bytes', async () => {
  const { vfs, guarded, main } = await branchWithClaim();

  await expect(guarded.checkout({ op: 'switch', ref: 'feat' })).rejects.toMatchObject({
    code: 'EPERM',
  });

  expect(await vfs.readFileText('/r/a.txt')).toBe('main\n');
  expect(await vfs.exists(`/r/${CLAIM}`)).toBe(false);
  expect(await guarded.resolveRef('HEAD')).toBe(main);
});

it('branch creation at a rejected start-point creates neither ref nor worktree bytes', async () => {
  const { vfs, guarded, main } = await branchWithClaim();

  await expect(
    guarded.checkout({ op: 'switch', ref: 'topic', create: true, startPoint: 'feat' }),
  ).rejects.toMatchObject({ code: 'EPERM' });

  expect(await vfs.readFileText('/r/a.txt')).toBe('main\n');
  expect(await vfs.exists(`/r/${CLAIM}`)).toBe(false);
  expect(await guarded.resolveRef('HEAD')).toBe(main);
  expect(await guarded.listBranches()).not.toContain('topic');
});

it('merge rejects its conservative merged-tree set before changing HEAD or worktree', async () => {
  const { vfs, guarded, main } = await branchWithClaim();

  await expect(guarded.merge({ theirs: 'feat', author: AUTHOR })).rejects.toMatchObject({
    code: 'EPERM',
  });

  expect(await vfs.readFileText('/r/a.txt')).toBe('main\n');
  expect(await vfs.exists(`/r/${CLAIM}`)).toBe(false);
  expect(await guarded.resolveRef('HEAD')).toBe(main);
});

it('cherry-pick rejects before its earlier ordinary tree change', async () => {
  const { vfs, guarded, main, feat } = await branchWithClaim();

  await expect(guarded.cherryPick({ oid: feat, committer: AUTHOR })).rejects.toMatchObject({
    code: 'EPERM',
  });

  expect(await vfs.readFileText('/r/a.txt')).toBe('main\n');
  expect(await vfs.exists(`/r/${CLAIM}`)).toBe(false);
  expect(await guarded.resolveRef('HEAD')).toBe(main);
});

async function dirtyTrackedClaim(): Promise<{ vfs: MemoryVfs; guarded: Git }> {
  const vfs = new MemoryVfs();
  await vfs.mkdir('/r/node_modules', { recursive: true });
  const git = makeGit({ fs: vfsToGitFs(vfs), dir: '/r' });
  await git.init();
  await vfs.writeFile('/r/a.txt', 'clean\n');
  await vfs.writeFile(`/r/${CLAIM}`, 'clean claim\n');
  await git.add('a.txt');
  await git.add(CLAIM, { force: true });
  await git.commit({ message: 'base', author: AUTHOR });
  await git.setConfig('user.name', AUTHOR.name);
  await git.setConfig('user.email', AUTHOR.email);
  await vfs.writeFile('/r/a.txt', 'dirty\n');
  await vfs.writeFile(`/r/${CLAIM}`, 'dirty claim\n');
  return { vfs, guarded: guardedGit(vfs) };
}

it('stash push preflights the tracked reset tree before cleaning worktree bytes', async () => {
  const { vfs, guarded } = await dirtyTrackedClaim();

  await expect(guarded.stash('push')).rejects.toMatchObject({ code: 'EPERM' });

  expect(await vfs.readFileText('/r/a.txt')).toBe('dirty\n');
  expect(await vfs.readFileText(`/r/${CLAIM}`)).toBe('dirty claim\n');
});

async function stashWithClaim(): Promise<{ vfs: MemoryVfs; guarded: Git }> {
  const vfs = new MemoryVfs();
  await vfs.mkdir('/r', { recursive: true });
  const git = makeGit({ fs: vfsToGitFs(vfs), dir: '/r' });
  await git.init();
  await vfs.writeFile('/r/a.txt', 'clean\n');
  await git.add('a.txt');
  await git.commit({ message: 'base', author: AUTHOR });
  await git.setConfig('user.name', AUTHOR.name);
  await git.setConfig('user.email', AUTHOR.email);
  await vfs.writeFile('/r/a.txt', 'stashed\n');
  await vfs.mkdir('/r/node_modules', { recursive: true });
  await vfs.writeFile(`/r/${CLAIM}`, 'stashed claim\n');
  await git.add('a.txt');
  await git.add(CLAIM, { force: true });
  await git.stash('push');
  return { vfs, guarded: guardedGit(vfs) };
}

it.each(['apply', 'pop'] as const)(
  'stash %s rejects its full selected entry before applying ordinary bytes',
  async (op) => {
    const { vfs, guarded } = await stashWithClaim();

    await expect(guarded.stash(op)).rejects.toMatchObject({ code: 'EPERM' });

    expect(await vfs.readFileText('/r/a.txt')).toBe('clean\n');
    expect(await vfs.exists(`/r/${CLAIM}`)).toBe(false);
  },
);

it('stash apply preflights the selected older reflog entry, not only refs/stash', async () => {
  const { vfs, guarded } = await stashWithClaim();
  const unguarded = makeGit({ fs: vfsToGitFs(vfs), dir: '/r' });
  await vfs.writeFile('/r/a.txt', 'newest stash\n');
  await unguarded.add('a.txt');
  await unguarded.stash('push');

  await expect(guarded.stash('apply', undefined, 1)).rejects.toMatchObject({ code: 'EPERM' });

  expect(await vfs.readFileText('/r/a.txt')).toBe('clean\n');
  expect(await vfs.exists(`/r/${CLAIM}`)).toBe(false);
});
