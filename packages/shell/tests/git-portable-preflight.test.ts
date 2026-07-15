/** Terminal Git publishes exact worktree paths inside the outer mutation FIFO. */
import { makeGit, vfsToGitFs } from '@riftydev/git';
import { type VfsMutationGuard, type VfsMutationIntent, asyncVfs } from '@riftydev/vfs';
import { installMemoryFs, resetSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { Shell, type ShellOptions } from '../src/index.ts';

const ENV: Record<string, string> = {
  GIT_AUTHOR_NAME: 'rifty',
  GIT_AUTHOR_EMAIL: 'rifty@localhost',
  GIT_AUTHOR_DATE: '1600000000',
  GIT_COMMITTER_NAME: 'rifty',
  GIT_COMMITTER_EMAIL: 'rifty@localhost',
  GIT_COMMITTER_DATE: '1600000000',
};
const CLAIM = 'node_modules/.rifty-install-stamp.json';
const REPO_REPLACEMENT_BATCH: VfsMutationIntent[][] = [
  [
    { kind: 'write', path: '/repo/.git' },
    { kind: 'replace', path: '/repo' },
  ],
];

function eperm(path: string): Error & { code: string } {
  return Object.assign(new Error(`EPERM: reserved install claim, '${path}'`), { code: 'EPERM' });
}

function rejectingShell(): {
  shell: Shell;
  calls: string[][];
  batches: VfsMutationIntent[][];
} {
  const calls: string[][] = [];
  const batches: VfsMutationIntent[][] = [];
  const mutationGuard: VfsMutationGuard = async (intents, apply) => {
    batches.push([...intents]);
    return await apply();
  };
  const options: ShellOptions = {
    cwd: '/repo',
    env: ENV,
    mutationGuard,
    assertPortablePaths(paths) {
      calls.push([...paths]);
      const claim = paths.find((path) => path.endsWith(`/${CLAIM}`) || path.includes(`/${CLAIM}/`));
      if (claim !== undefined) throw eperm(claim);
    },
  };
  return { shell: new Shell(options), calls, batches };
}

async function client() {
  const vfs = asyncVfs();
  if (!vfs) throw new Error('no async vfs');
  return makeGit({ fs: vfsToGitFs(vfs), dir: '/repo' });
}

async function seedBranchWithClaim(claimPath = CLAIM): Promise<{ feature: string }> {
  const vfs = asyncVfs();
  if (!vfs) throw new Error('no async vfs');
  await vfs.mkdir('/repo', { recursive: true });
  const shell = new Shell({ cwd: '/repo', env: ENV });
  expect((await shell.run('git init')).exitCode).toBe(0);
  await vfs.writeFile('/repo/a.txt', 'main\n');
  expect((await shell.run('git add a.txt')).exitCode).toBe(0);
  expect((await shell.run('git commit -m main')).exitCode).toBe(0);
  expect((await shell.run('git checkout -b feature')).exitCode).toBe(0);
  await vfs.writeFile('/repo/a.txt', 'feature\n');
  await vfs.mkdir(`/repo/${claimPath.slice(0, claimPath.lastIndexOf('/'))}`, {
    recursive: true,
  });
  await vfs.writeFile(`/repo/${claimPath}`, 'foreign claim\n');
  expect((await shell.run(`git add -f a.txt ${claimPath}`)).exitCode).toBe(0);
  expect((await shell.run('git commit -m feature')).exitCode).toBe(0);
  const feature = await (await client()).resolveRef('feature');
  expect((await shell.run('git checkout main')).exitCode).toBe(0);
  return { feature };
}

async function expectMainUnchanged(head: string, claimPath = CLAIM): Promise<void> {
  const vfs = asyncVfs();
  if (!vfs) throw new Error('no async vfs');
  const git = await client();
  expect(await vfs.readFileText('/repo/a.txt')).toBe('main\n');
  expect(await vfs.exists(`/repo/${claimPath}`)).toBe(false);
  expect(await git.resolveRef('HEAD')).toBe(head);
  expect(await git.listFiles()).toEqual(['a.txt']);
}

beforeEach(() => installMemoryFs());
afterEach(() => resetSyncMirror());

it.each([
  'checkout feature',
  'switch feature',
  'restore --source feature -- .',
  'reset --hard feature',
  'merge feature',
])(
  'git %s rejects its complete target before ordinary worktree bytes and inside one outer guard',
  async (args) => {
    await seedBranchWithClaim();
    const git = await client();
    const head = await git.resolveRef('HEAD');
    const { shell, calls, batches } = rejectingShell();

    const result = await shell.run(`git ${args}`);

    expect(result.exitCode).toBe(128);
    expect(result.stderr).toContain('EPERM');
    expect(calls).toEqual([['/repo/a.txt', `/repo/${CLAIM}`]]);
    expect(batches).toEqual(REPO_REPLACEMENT_BATCH);
    await expectMainUnchanged(head);
  },
);

it('git checkout rejects a reserved-claim descendant before ordinary bytes, index, or HEAD', async () => {
  const descendant = `${CLAIM}/payload`;
  await seedBranchWithClaim(descendant);
  const git = await client();
  const head = await git.resolveRef('HEAD');
  const { shell, calls, batches } = rejectingShell();

  const result = await shell.run('git checkout feature');

  expect(result.exitCode).toBe(128);
  expect(result.stderr).toContain('EPERM');
  expect(calls).toEqual([['/repo/a.txt', `/repo/${descendant}`]]);
  expect(batches).toEqual(REPO_REPLACEMENT_BATCH);
  await expectMainUnchanged(head, descendant);
});

it('git cherry-pick wiring rejects before changing HEAD, index, or its first ordinary path', async () => {
  const { feature } = await seedBranchWithClaim();
  const git = await client();
  const head = await git.resolveRef('HEAD');
  const { shell, calls, batches } = rejectingShell();

  const result = await shell.run(`git cherry-pick ${feature}`);

  expect(result.exitCode).toBe(128);
  expect(result.stderr).toContain('EPERM');
  expect(calls).toEqual([['/repo/a.txt', `/repo/${CLAIM}`]]);
  expect(batches).toEqual(REPO_REPLACEMENT_BATCH);
  await expectMainUnchanged(head);
});

it('git stash push preflights before temporary config, index, or worktree mutation', async () => {
  await seedBranchWithClaim();
  const setup = new Shell({ cwd: '/repo', env: ENV });
  expect((await setup.run('git checkout feature')).exitCode).toBe(0);
  const vfs = asyncVfs();
  if (!vfs) throw new Error('no async vfs');
  await vfs.writeFile('/repo/a.txt', 'dirty ordinary\n');
  await vfs.writeFile(`/repo/${CLAIM}`, 'dirty claim\n');
  const git = await client();
  const head = await git.resolveRef('HEAD');
  const status = await git.status();
  const { shell, calls, batches } = rejectingShell();

  const result = await shell.run('git stash push');

  expect(result.exitCode).toBe(128);
  expect(result.stderr).toContain('EPERM');
  expect(calls).toEqual([['/repo/a.txt', `/repo/${CLAIM}`]]);
  expect(batches).toEqual(REPO_REPLACEMENT_BATCH);
  expect(await vfs.readFileText('/repo/a.txt')).toBe('dirty ordinary\n');
  expect(await vfs.readFileText(`/repo/${CLAIM}`)).toBe('dirty claim\n');
  expect(await git.resolveRef('HEAD')).toBe(head);
  expect(await git.status()).toEqual(status);
});

it.each(['apply', 'pop'])(
  'git stash %s wiring rejects before worktree, index, or stash-list mutation',
  async (operation) => {
    await seedBranchWithClaim();
    const setup = new Shell({ cwd: '/repo', env: ENV });
    expect((await setup.run('git checkout feature')).exitCode).toBe(0);
    const vfs = asyncVfs();
    if (!vfs) throw new Error('no async vfs');
    await vfs.writeFile('/repo/a.txt', 'stashed ordinary\n');
    await vfs.writeFile(`/repo/${CLAIM}`, 'stashed claim\n');
    expect((await setup.run('git stash push')).exitCode).toBe(0);

    const git = await client();
    const head = await git.resolveRef('HEAD');
    const status = await git.status();
    const stashBefore = await git.stash('list');
    const { shell, calls, batches } = rejectingShell();

    const result = await shell.run(`git stash ${operation}`);

    expect(result.exitCode).toBe(128);
    expect(result.stderr).toContain('EPERM');
    expect(calls).toEqual([['/repo/a.txt', `/repo/${CLAIM}`]]);
    expect(batches).toEqual(REPO_REPLACEMENT_BATCH);
    expect(await vfs.readFileText('/repo/a.txt')).toBe('feature\n');
    expect(await vfs.readFileText(`/repo/${CLAIM}`)).toBe('foreign claim\n');
    expect(await git.resolveRef('HEAD')).toBe(head);
    expect(await git.status()).toEqual(status);
    expect(await git.stash('list')).toEqual(stashBefore);
  },
);

it('git apply rejects all planned patch targets before applying its earlier ordinary hunk', async () => {
  await seedBranchWithClaim();
  const vfs = asyncVfs();
  if (!vfs) throw new Error('no async vfs');
  await vfs.writeFile(
    '/repo/change.patch',
    [
      'diff --git a/a.txt b/a.txt',
      '--- a/a.txt',
      '+++ b/a.txt',
      '@@ -1 +1 @@',
      '-main',
      '+patched',
      `diff --git a/${CLAIM} b/${CLAIM}`,
      'new file mode 100644',
      '--- /dev/null',
      `+++ b/${CLAIM}`,
      '@@ -0,0 +1 @@',
      '+foreign claim',
      '',
    ].join('\n'),
  );
  const git = await client();
  const head = await git.resolveRef('HEAD');
  const before = await git.status();
  const { shell, calls, batches } = rejectingShell();

  const result = await shell.run('git apply change.patch');

  expect(result.exitCode).toBe(128);
  expect(result.stderr).toContain('EPERM');
  expect(calls).toEqual([['/repo/a.txt', `/repo/${CLAIM}`]]);
  expect(batches).toEqual(REPO_REPLACEMENT_BATCH);
  expect(await vfs.readFileText('/repo/a.txt')).toBe('main\n');
  expect(await vfs.exists(`/repo/${CLAIM}`)).toBe(false);
  expect(await git.resolveRef('HEAD')).toBe(head);
  expect(await git.status()).toEqual(before);
});

it('git revert rejects its full inverse before ordinary bytes, index, or HEAD mutate', async () => {
  await seedBranchWithClaim();
  const setup = new Shell({ cwd: '/repo', env: ENV });
  expect((await setup.run('git checkout feature')).exitCode).toBe(0);
  const vfs = asyncVfs();
  if (!vfs) throw new Error('no async vfs');
  const git = await client();
  const head = await git.resolveRef('HEAD');
  const before = await git.status();
  const { shell, calls, batches } = rejectingShell();

  const result = await shell.run('git revert HEAD');

  expect(result.exitCode).toBe(128);
  expect(result.stderr).toContain('EPERM');
  expect(calls).toEqual([['/repo/a.txt', `/repo/${CLAIM}`]]);
  expect(batches).toEqual(REPO_REPLACEMENT_BATCH);
  expect(await vfs.readFileText('/repo/a.txt')).toBe('feature\n');
  expect(await vfs.readFileText(`/repo/${CLAIM}`)).toBe('foreign claim\n');
  expect(await git.resolveRef('HEAD')).toBe(head);
  expect(await git.status()).toEqual(before);
});

it('git rm expands a recursive pathspec and rejects before worktree or index mutation', async () => {
  await seedBranchWithClaim();
  const setup = new Shell({ cwd: '/repo', env: ENV });
  expect((await setup.run('git checkout feature')).exitCode).toBe(0);
  const vfs = asyncVfs();
  if (!vfs) throw new Error('no async vfs');
  const git = await client();
  const before = await git.status();
  const { shell, calls, batches } = rejectingShell();

  const result = await shell.run('git rm -rf .');

  expect(result.exitCode).toBe(128);
  expect(result.stderr).toContain('EPERM');
  expect(result.stdout).toBe('');
  expect(calls).toEqual([['/repo/a.txt', `/repo/${CLAIM}`]]);
  expect(batches).toEqual([
    [
      { kind: 'write', path: '/repo/.git' },
      { kind: 'rm', path: '/repo' },
    ],
  ]);
  expect(await vfs.readFileText('/repo/a.txt')).toBe('feature\n');
  expect(await vfs.readFileText(`/repo/${CLAIM}`)).toBe('foreign claim\n');
  expect(await git.status()).toEqual(before);
});

it('git mv preflights its exact source and resolved destination before writing', async () => {
  await seedBranchWithClaim();
  const vfs = asyncVfs();
  if (!vfs) throw new Error('no async vfs');
  const git = await client();
  const before = await git.status();
  const { shell, calls, batches } = rejectingShell();

  const result = await shell.run(`git mv a.txt ${CLAIM}`);

  expect(result.exitCode).toBe(128);
  expect(result.stderr).toContain('EPERM');
  expect(calls).toEqual([['/repo/a.txt', `/repo/${CLAIM}`]]);
  expect(batches).toEqual([
    [
      { kind: 'write', path: '/repo/.git' },
      { kind: 'rename', sourcePath: '/repo/a.txt', targetPath: `/repo/${CLAIM}` },
    ],
  ]);
  expect(await vfs.readFileText('/repo/a.txt')).toBe('main\n');
  expect(await vfs.exists(`/repo/${CLAIM}`)).toBe(false);
  expect(await git.status()).toEqual(before);
});
