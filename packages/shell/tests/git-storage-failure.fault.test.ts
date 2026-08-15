/**
 * Faults: storage read failures under shell `git` probes (quota-perm-fail /
 * provenance-lie at the facade→CLI boundary). The facade surfaces the exact
 * `VfsError` (ADR-0357); the command layer must not re-collapse it into a
 * native-looking diagnostic ("nothing to amend", a fabricated branch name,
 * "pathspec did not match") — absence classifies, storage failures rethrow to
 * the shell's loud generic path with repo state untouched.
 */
import { VfsError, asyncVfs } from '@riftydev/vfs';
import { installMemoryFs, resetSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { git } from '../src/commands/git.ts';
import { makeCtx } from './_ctx.ts';

const ENV: Record<string, string> = {
  GIT_AUTHOR_NAME: 'rifty',
  GIT_AUTHOR_EMAIL: 'rifty@localhost',
  GIT_AUTHOR_DATE: '1600000000',
  GIT_COMMITTER_NAME: 'rifty',
  GIT_COMMITTER_EMAIL: 'rifty@localhost',
  GIT_COMMITTER_DATE: '1600000000',
};

function vfsOrThrow(): NonNullable<ReturnType<typeof asyncVfs>> {
  const vfs = asyncVfs();
  if (!vfs) throw new Error('no async vfs after installMemoryFs');
  return vfs;
}

async function seedCommittedRepo(): Promise<void> {
  const vfs = vfsOrThrow();
  await vfs.mkdir('/repo', { recursive: true });
  await vfs.writeFile('/repo/a.txt', 'hi\n');
  await git(['init'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  await git(['add', 'a.txt'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  const commit = makeCtx({ cwd: '/repo', env: ENV });
  if ((await git(['commit', '-m', 'one'], commit.ctx)) !== 0) {
    throw new Error(`seed commit failed: ${commit.err()}`);
  }
}

beforeEach(() => {
  installMemoryFs();
});
afterEach(() => {
  vi.restoreAllMocks();
  resetSyncMirror();
});

it('[fault: quota-perm-fail][fault: provenance-lie] commit --amend surfaces a commit-object read failure instead of "nothing to amend"', async () => {
  await seedCommittedRepo();
  const vfs = vfsOrThrow();
  const refBefore = await vfs.readFileText('/repo/.git/refs/heads/main');
  const indexBefore = (await vfs.readFile('/repo/.git/index')).slice();
  const head = refBefore.trim();
  const failure = new VfsError(
    'EIO',
    `/repo/.git/objects/${head.slice(0, 2)}/${head.slice(2)}`,
    'injected amend object read failure',
  );
  const readFile = vfs.readFile.bind(vfs);
  vi.spyOn(vfs, 'readFile').mockImplementation(async (path) => {
    if (path === failure.path) throw failure;
    return await readFile(path);
  });

  const amend = makeCtx({ cwd: '/repo', env: ENV });
  await expect(git(['commit', '--amend', '-m', 'two'], amend.ctx)).rejects.toBe(failure);
  vi.restoreAllMocks();

  expect.soft(amend.err()).not.toContain('You have nothing to amend.');
  expect.soft(await vfs.readFileText('/repo/.git/refs/heads/main')).toBe(refBefore);
  expect(await vfs.readFile('/repo/.git/index')).toEqual(indexBefore);
});

it('[fault: quota-perm-fail][fault: provenance-lie] log on an unborn branch surfaces a HEAD read failure instead of fabricating the branch name', async () => {
  const vfs = vfsOrThrow();
  await vfs.mkdir('/repo', { recursive: true });
  await git(['init'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  const failure = new VfsError('EIO', '/repo/.git/HEAD', 'injected HEAD read failure');
  const readFile = vfs.readFile.bind(vfs);
  let headReads = 0;
  // Read #1 (g.log's unborn resolveRef) stays a PROVEN absence; the secondary
  // currentBranch lookup for the diagnostic hits the storage failure.
  vi.spyOn(vfs, 'readFile').mockImplementation(async (path) => {
    if (path === failure.path && ++headReads >= 2) throw failure;
    return await readFile(path);
  });

  const log = makeCtx({ cwd: '/repo', env: ENV });
  await expect(git(['log'], log.ctx)).rejects.toBe(failure);
  expect(log.err()).not.toContain('does not have any commits yet');
});

it('[fault: quota-perm-fail][fault: provenance-lie] checkout surfaces a branch ref read failure instead of "pathspec did not match"', async () => {
  await seedCommittedRepo();
  const vfs = vfsOrThrow();
  expect(await git(['branch', 'feature-x'], makeCtx({ cwd: '/repo', env: ENV }).ctx)).toBe(0);
  const failure = new VfsError(
    'EIO',
    '/repo/.git/refs/heads/feature-x',
    'injected branch ref read failure',
  );
  const readFile = vfs.readFile.bind(vfs);
  vi.spyOn(vfs, 'readFile').mockImplementation(async (path) => {
    if (path === failure.path) throw failure;
    return await readFile(path);
  });

  const co = makeCtx({ cwd: '/repo', env: ENV });
  await expect(git(['checkout', 'feature-x'], co.ctx)).rejects.toBe(failure);
  vi.restoreAllMocks();

  expect.soft(co.err()).not.toContain('did not match');
  expect(await vfs.readFileText('/repo/a.txt')).toBe('hi\n');
});
