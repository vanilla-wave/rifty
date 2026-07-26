import { makeGit, vfsToGitFs } from '@riftydev/git';
import { Shell } from '@riftydev/shell';
import { type Vfs, dirname } from '@riftydev/vfs';
import { createMemoryFs } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import {
  amendStarterGeneratedBaseline,
  ensureStarterInitialCommit,
} from './git-initial-baseline.ts';

const encoder = new TextEncoder();
const LOCKFILE_TEXT = '{"lockfileVersion":3,"packages":{}}\n';
const lockfile = encoder.encode(LOCKFILE_TEXT);

async function seed(vfs: Vfs, root: string): Promise<void> {
  const files = {
    [`${root}/.gitignore`]: 'node_modules/\ndist/\n',
    [`${root}/package.json`]: '{"name":"starter","private":true}\n',
    [`${root}/src/main.js`]: 'console.log("baseline");\n',
  };
  for (const [path, content] of Object.entries(files)) {
    await vfs.mkdir(dirname(path), { recursive: true });
    await vfs.writeFile(path, content);
  }
}

async function initialize(vfs: Vfs, root: string): Promise<string> {
  const oid = await ensureStarterInitialCommit(vfs, root);
  if (oid === null) throw new Error('Expected a fresh Starter initial commit');
  return oid;
}

describe('starter git baseline', () => {
  it('commits one clean initial tree, ignores generated trees, and stays idempotent', async () => {
    const { vfs, fsSync } = createMemoryFs();
    const root = '/project';
    await seed(vfs, root);
    await vfs.mkdir(`${root}/node_modules/pkg`, { recursive: true });
    await vfs.writeFile(`${root}/node_modules/pkg/index.js`, 'generated dependency\n');
    await vfs.mkdir(`${root}/dist`, { recursive: true });
    await vfs.writeFile(`${root}/dist/bundle.js`, 'generated build output\n');

    await expect(ensureStarterInitialCommit(vfs, root)).resolves.toMatch(/^[0-9a-f]{40}$/u);
    await expect(ensureStarterInitialCommit(vfs, root)).resolves.toBeNull();

    const sh = new Shell({ cwd: root, fileSystem: fsSync });
    expect(await sh.run('git status --porcelain')).toMatchObject({
      exitCode: 0,
      stdout: '',
      stderr: '',
    });
    expect((await sh.run('git log --oneline')).stdout).toMatch(/^[0-9a-f]{7} Initial commit\n$/);
  });

  it('folds the exact generated lock into the single initial commit', async () => {
    const { vfs, fsSync } = createMemoryFs();
    const root = '/project';
    await seed(vfs, root);
    const initialOid = await initialize(vfs, root);
    const git = makeGit({ fs: vfsToGitFs(vfs), dir: root });
    await vfs.writeFile(`${root}/package-lock.json`, lockfile);

    await expect(amendStarterGeneratedBaseline(vfs, root, initialOid, lockfile)).resolves.toBe(
      true,
    );

    const sh = new Shell({ cwd: root, fileSystem: fsSync });
    expect((await sh.run('git status --porcelain')).stdout).toBe('');
    expect((await sh.run('git log --oneline')).stdout.trim().split('\n')).toHaveLength(1);
    expect((await sh.run('git show HEAD:package-lock.json')).stdout).toBe(LOCKFILE_TEXT);
    expect(await git.resolveRef('HEAD')).not.toBe(initialOid);
  });

  it('leaves a lock visible when its bytes do not match install provenance', async () => {
    const { vfs, fsSync } = createMemoryFs();
    const root = '/mismatched-lock';
    await seed(vfs, root);
    const initialOid = await initialize(vfs, root);
    await vfs.writeFile(`${root}/package-lock.json`, '{"lockfileVersion":3,"user":true}\n');

    await expect(amendStarterGeneratedBaseline(vfs, root, initialOid, lockfile)).resolves.toBe(
      false,
    );

    const sh = new Shell({ cwd: root, fileSystem: fsSync });
    expect((await sh.run('git status --porcelain')).stdout).toContain('?? package-lock.json');
    expect((await sh.run('git show HEAD:package-lock.json')).exitCode).not.toBe(0);
  });

  it('does not absorb staged user state', async () => {
    const { vfs, fsSync } = createMemoryFs();
    const root = '/staged-user-state';
    await seed(vfs, root);
    const initialOid = await initialize(vfs, root);
    const git = makeGit({ fs: vfsToGitFs(vfs), dir: root });
    await vfs.writeFile(`${root}/src/main.js`, 'console.log("staged user edit");\n');
    await git.add('src/main.js');
    await vfs.writeFile(`${root}/package-lock.json`, lockfile);

    await expect(amendStarterGeneratedBaseline(vfs, root, initialOid, lockfile)).resolves.toBe(
      false,
    );

    const sh = new Shell({ cwd: root, fileSystem: fsSync });
    expect((await sh.run('git status --porcelain')).stdout).toContain('M  src/main.js');
    expect((await sh.run('git status --porcelain')).stdout).toContain('?? package-lock.json');
  });

  it('does not fold a lock beside a changed workspace manifest', async () => {
    const { vfs, fsSync } = createMemoryFs();
    const root = '/manifest-drift';
    await seed(vfs, root);
    const initialOid = await initialize(vfs, root);
    await vfs.writeFile(`${root}/package.json`, '{"name":"user-edit"}\n');
    await vfs.writeFile(`${root}/package-lock.json`, lockfile);

    await expect(amendStarterGeneratedBaseline(vfs, root, initialOid, lockfile)).resolves.toBe(
      false,
    );

    const status = (
      await new Shell({ cwd: root, fileSystem: fsSync }).run('git status --porcelain')
    ).stdout;
    expect(status).toContain(' M package.json');
    expect(status).toContain('?? package-lock.json');
  });

  it('ignores dependency package manifests when validating the workspace manifest', async () => {
    const { vfs, fsSync } = createMemoryFs();
    const root = '/dependency-manifest';
    await vfs.mkdir(`${root}/src`, { recursive: true });
    await vfs.writeFile(`${root}/package.json`, '{"name":"starter","private":true}\n');
    await vfs.writeFile(`${root}/src/main.js`, 'console.log("baseline");\n');
    const initialOid = await initialize(vfs, root);
    await vfs.mkdir(`${root}/node_modules/dependency`, { recursive: true });
    await vfs.writeFile(`${root}/node_modules/dependency/package.json`, '{"name":"dependency"}\n');
    await vfs.writeFile(`${root}/package-lock.json`, lockfile);

    await expect(amendStarterGeneratedBaseline(vfs, root, initialOid, lockfile)).resolves.toBe(
      true,
    );

    const sh = new Shell({ cwd: root, fileSystem: fsSync });
    const status = (await sh.run('git status --porcelain')).stdout;
    expect(status).toContain('?? node_modules/');
    expect(status).not.toContain('package-lock.json');
    expect((await sh.run('git show HEAD:package-lock.json')).stdout).toBe(LOCKFILE_TEXT);
  });

  it('preserves an unstaged source edit while folding the generated lock', async () => {
    const { vfs, fsSync } = createMemoryFs();
    const root = '/unstaged-source';
    await seed(vfs, root);
    const initialOid = await initialize(vfs, root);
    await vfs.writeFile(`${root}/src/main.js`, 'console.log("user edit");\n');
    await vfs.writeFile(`${root}/package-lock.json`, lockfile);

    await expect(amendStarterGeneratedBaseline(vfs, root, initialOid, lockfile)).resolves.toBe(
      true,
    );

    const sh = new Shell({ cwd: root, fileSystem: fsSync });
    expect((await sh.run('git status --porcelain')).stdout).toBe(' M src/main.js\n');
    expect((await sh.run('git show HEAD:src/main.js')).stdout).toBe('console.log("baseline");\n');
  });

  it('leaves the lock visible after HEAD moves beyond the Starter root', async () => {
    const { vfs, fsSync } = createMemoryFs();
    const root = '/head-drift';
    await seed(vfs, root);
    const initialOid = await initialize(vfs, root);
    const git = makeGit({ fs: vfsToGitFs(vfs), dir: root });
    await vfs.writeFile(`${root}/src/main.js`, 'console.log("user commit");\n');
    await git.add('src/main.js');
    const identity = {
      name: 'user',
      email: 'user@example.test',
      timestamp: 1_700_000_000,
      timezoneOffset: 0,
    };
    const userOid = await git.commit({
      message: 'User commit',
      author: identity,
      committer: identity,
    });
    await vfs.writeFile(`${root}/package-lock.json`, lockfile);

    await expect(amendStarterGeneratedBaseline(vfs, root, initialOid, lockfile)).resolves.toBe(
      false,
    );

    expect(await git.resolveRef('HEAD')).toBe(userOid);
    const sh = new Shell({ cwd: root, fileSystem: fsSync });
    expect((await sh.run('git status --porcelain')).stdout).toContain('?? package-lock.json');
  });

  it('does not adopt a user-amended root that mimics the Starter identity and message', async () => {
    const { vfs, fsSync } = createMemoryFs();
    const root = '/spoofed-root';
    await seed(vfs, root);
    const initialOid = await initialize(vfs, root);
    const git = makeGit({ fs: vfsToGitFs(vfs), dir: root });
    await vfs.writeFile(`${root}/src/main.js`, 'console.log("user root");\n');
    await git.add('src/main.js');
    const identity = {
      name: 'rifty',
      email: 'rifty@localhost',
      timestamp: 1_800_000_100,
      timezoneOffset: 0,
    };
    const userRootOid = await git.commit({
      message: 'Initial commit',
      author: identity,
      committer: identity,
      amend: true,
    });
    await vfs.writeFile(`${root}/package-lock.json`, lockfile);

    await expect(amendStarterGeneratedBaseline(vfs, root, initialOid, lockfile)).resolves.toBe(
      false,
    );

    expect(userRootOid).not.toBe(initialOid);
    expect(await git.resolveRef('HEAD')).toBe(userRootOid);
    const sh = new Shell({ cwd: root, fileSystem: fsSync });
    expect((await sh.run('git show HEAD:package-lock.json')).exitCode).not.toBe(0);
    expect((await sh.run('git status --porcelain')).stdout).toContain('?? package-lock.json');
  });

  it('amends main without touching an existing user side branch', async () => {
    const { vfs } = createMemoryFs();
    const root = '/side-branch';
    await seed(vfs, root);
    const initialOid = await initialize(vfs, root);
    const git = makeGit({ fs: vfsToGitFs(vfs), dir: root });
    await git.checkout({ op: 'switch', ref: 'user-side', create: true });
    await vfs.writeFile(`${root}/side.txt`, 'user-owned\n');
    await git.add('side.txt');
    const identity = {
      name: 'user',
      email: 'user@example.test',
      timestamp: 1_800_000_000,
      timezoneOffset: 0,
    };
    const sideOid = await git.commit({
      message: 'User side commit',
      author: identity,
      committer: identity,
    });
    await git.checkout({ op: 'switch', ref: 'main' });
    await vfs.writeFile(`${root}/package-lock.json`, lockfile);

    await expect(amendStarterGeneratedBaseline(vfs, root, initialOid, lockfile)).resolves.toBe(
      true,
    );

    expect(await git.resolveRef('refs/heads/user-side')).toBe(sideOid);
    expect((await git.show(`${sideOid}:side.txt`)).type).toBe('blob');
  });
});
