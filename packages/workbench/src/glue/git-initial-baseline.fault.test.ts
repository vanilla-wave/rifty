/**
 * Faults: `ensureStarterInitialCommit` racing an instant-deps restore
 * (concurrent-same-key / torn-state at the seed boundary);
 * a materialized package tree without a host `.gitignore` entering Starter
 * provenance or an interrupted unborn index (provenance-lie / torn-state /
 * quota-perm-fail at the baseline boundary);
 * `createStarterBaselineFinalizer` vs durability rejection + drifted HEAD
 * (quota-perm-fail / provenance lie at the amend boundary).
 */
import { makeGit, vfsToGitFs } from '@riftydev/git';
import { Shell } from '@riftydev/shell';
import { VfsError, asyncVfs, dirname } from '@riftydev/vfs';
import { installMemoryFs, resetSyncMirror } from '@riftydev/vfs/internal';
import { describe, expect, it, vi } from 'vitest';
import {
  amendStarterGeneratedBaseline,
  createStarterBaselineFinalizer,
  ensureStarterInitialCommit,
} from './git-initial-baseline.ts';

const FINAL_LOCKFILE = '{"lockfileVersion":3,"packages":{}}\n';

function looseObjectPath(root: string, oid: string): string {
  return `${root}/.git/objects/${oid.slice(0, 2)}/${oid.slice(2)}`;
}

async function rejectedValue(run: Promise<unknown>): Promise<unknown> {
  return run.then(
    () => undefined,
    (error: unknown) => error,
  );
}

describe('starter initial commit ∥ instant-deps restore (fault: concurrent restore churn)', () => {
  it('commits a clean baseline while node_modules + lockfile land mid-walk; amend folds the final lockfile', async () => {
    installMemoryFs();
    try {
      const root = '/projects/race';
      const vfs = asyncVfs();
      if (!vfs) throw new Error('no async vfs');
      const files = {
        [`${root}/.gitignore`]: 'node_modules/\ndist/\n',
        [`${root}/package.json`]: '{"name":"starter"}\n',
        [`${root}/src/main.js`]: 'console.log("baseline");\n',
      };
      for (const [path, content] of Object.entries(files)) {
        await vfs.mkdir(dirname(path), { recursive: true });
        await vfs.writeFile(path, content);
      }

      const restore = (async () => {
        for (let i = 0; i < 120; i++) {
          const pkgDir = `${root}/node_modules/pkg-${i % 12}`;
          await vfs.mkdir(pkgDir, { recursive: true });
          await vfs.writeFile(`${pkgDir}/file-${i}.js`, `module.exports = ${i};\n`);
          if (i === 40) await vfs.writeFile(`${root}/package-lock.json`, '{"lockfileVer');
          if (i === 80) await vfs.writeFile(`${root}/package-lock.json`, FINAL_LOCKFILE);
        }
      })();
      const [initialOid] = await Promise.all([ensureStarterInitialCommit(vfs, root), restore]);
      if (initialOid === null) throw new Error('Expected a fresh Starter initial commit');
      await amendStarterGeneratedBaseline(
        vfs,
        root,
        initialOid,
        new TextEncoder().encode(FINAL_LOCKFILE),
      );

      const sh = new Shell({ cwd: root });
      expect((await sh.run('git log --oneline')).stdout.trim().split('\n')).toHaveLength(1);
      expect(await sh.run('git status --porcelain')).toMatchObject({
        exitCode: 0,
        stdout: '',
        stderr: '',
      });
      expect((await sh.run('git show HEAD:package-lock.json')).stdout).toBe(FINAL_LOCKFILE);
      expect((await sh.run('git show HEAD:node_modules/pkg-0/file-0.js')).exitCode).not.toBe(0);
    } finally {
      resetSyncMirror();
    }
  });

  it('excludes a large materialized node_modules tree without relying on a host .gitignore', async () => {
    installMemoryFs();
    try {
      const root = '/projects/no-gitignore';
      const vfs = asyncVfs();
      if (!vfs) throw new Error('no async vfs');
      await vfs.mkdir(`${root}/src`, { recursive: true });
      await vfs.writeFile(`${root}/package.json`, '{"name":"starter"}\n');
      await vfs.writeFile(`${root}/src/main.js`, 'console.log("baseline");\n');
      await vfs.mkdir(`${root}/node_modules-helpers`, { recursive: true });
      await vfs.writeFile(`${root}/node_modules-helpers/keep.js`, 'export {};\n');
      await vfs.mkdir(`${root}/packages/app/node_modules/nested`, { recursive: true });
      await vfs.writeFile(`${root}/packages/app/node_modules/nested/index.js`, 'nested package\n');
      for (let index = 0; index < 120; index += 1) {
        const pkgDir = `${root}/node_modules/pkg-${String(index).padStart(3, '0')}`;
        await vfs.mkdir(pkgDir, { recursive: true });
        await vfs.writeFile(`${pkgDir}/index.js`, `module.exports = ${String(index)};\n`);
      }
      const interrupted = makeGit({ fs: vfsToGitFs(vfs), dir: root });
      await interrupted.init();
      await interrupted.add('node_modules/pkg-000/index.js');
      await interrupted.add('packages/app/node_modules/nested/index.js');
      const writes = vi.spyOn(vfs, 'writeFile');

      const initialOid = await ensureStarterInitialCommit(vfs, root);
      if (initialOid === null) throw new Error('Expected a fresh Starter initial commit');
      const indexWrites = writes.mock.calls.filter(([path]) => path === `${root}/.git/index`);
      expect(indexWrites.length).toBeLessThanOrEqual(4);

      const sh = new Shell({ cwd: root });
      expect((await sh.run('git show HEAD:src/main.js')).stdout).toBe('console.log("baseline");\n');
      expect((await sh.run('git show HEAD:node_modules-helpers/keep.js')).stdout).toBe(
        'export {};\n',
      );
      expect((await sh.run('git show HEAD:node_modules/pkg-000/index.js')).exitCode).not.toBe(0);
      expect(
        (await sh.run('git show HEAD:packages/app/node_modules/nested/index.js')).exitCode,
      ).not.toBe(0);
      const statusLines = (await sh.run('git status --porcelain')).stdout.trim().split('\n');
      expect(statusLines).toHaveLength(121);
      expect(
        statusLines.every(
          (line) =>
            line.startsWith('?? node_modules/') ||
            line === '?? packages/app/node_modules/nested/index.js',
        ),
      ).toBe(true);
    } finally {
      resetSyncMirror();
    }
  });

  it('[fault: unbounded-read][fault: sibling-drift] preserves Git ignore pruning while staging the baseline', async () => {
    installMemoryFs();
    try {
      const root = '/projects/ignored-build-trees';
      const vfs = asyncVfs();
      if (!vfs) throw new Error('no async vfs');
      await vfs.mkdir(`${root}/src`, { recursive: true });
      await vfs.writeFile(`${root}/.gitignore`, 'dist/\npackages/app/.cache/\n*.log\n');
      await vfs.writeFile(`${root}/package.json`, '{"name":"starter"}\n');
      await vfs.writeFile(`${root}/src/main.js`, 'console.log("baseline");\n');
      for (let index = 0; index < 64; index += 1) {
        const suffix = String(index).padStart(2, '0');
        await vfs.mkdir(`${root}/dist/chunk-${suffix}`, { recursive: true });
        await vfs.writeFile(`${root}/dist/chunk-${suffix}/index.js`, 'ignored build output\n');
        await vfs.mkdir(`${root}/packages/app/.cache/${suffix}`, { recursive: true });
        await vfs.writeFile(`${root}/packages/app/.cache/${suffix}/entry`, 'ignored cache\n');
        await vfs.writeFile(`${root}/debug-${suffix}.log`, 'ignored log\n');
      }
      const reads = vi.spyOn(vfs, 'readFile');

      const initialOid = await ensureStarterInitialCommit(vfs, root);
      if (initialOid === null) throw new Error('Expected a fresh Starter initial commit');

      const indexReads = reads.mock.calls.filter(([path]) => path === `${root}/.git/index`);
      expect(indexReads.length).toBeLessThanOrEqual(8);
      const sh = new Shell({ cwd: root });
      expect((await sh.run('git show HEAD:src/main.js')).stdout).toBe('console.log("baseline");\n');
      expect(await sh.run('git status --porcelain')).toMatchObject({ exitCode: 0, stdout: '' });
    } finally {
      resetSyncMirror();
    }
  });

  it('fails loud when an interrupted unborn index cannot be reset', async () => {
    installMemoryFs();
    try {
      const root = '/projects/index-reset-failure';
      const vfs = asyncVfs();
      if (!vfs) throw new Error('no async vfs');
      await vfs.mkdir(root, { recursive: true });
      await vfs.writeFile(`${root}/main.js`, 'console.log("baseline");\n');
      const git = makeGit({ fs: vfsToGitFs(vfs), dir: root });
      await git.init();
      await git.add('main.js');
      vi.spyOn(vfs, 'rm').mockRejectedValueOnce(new Error('injected index permission failure'));

      await expect(ensureStarterInitialCommit(vfs, root)).rejects.toThrow(
        'injected index permission failure',
      );
      await expect(git.resolveRef('HEAD')).rejects.toThrow();
      await expect(vfs.readFileText(`${root}/main.js`)).resolves.toBe('console.log("baseline");\n');
    } finally {
      resetSyncMirror();
    }
  });

  it('[fault: quota-perm-fail][fault: provenance-lie] preserves existing history and staged state when the main ref read fails', async () => {
    installMemoryFs();
    try {
      const root = '/projects/existing-ref-read-failure';
      const vfs = asyncVfs();
      if (!vfs) throw new Error('no async vfs');
      await vfs.mkdir(`${root}/src`, { recursive: true });
      await vfs.writeFile(`${root}/src/main.js`, 'console.log("baseline");\n');
      const initialOid = await ensureStarterInitialCommit(vfs, root);
      if (initialOid === null) throw new Error('Expected a fresh Starter initial commit');
      const git = makeGit({ fs: vfsToGitFs(vfs), dir: root });
      await vfs.writeFile(`${root}/src/main.js`, 'console.log("user commit");\n');
      await git.add('src/main.js');
      const identity = {
        name: 'user',
        email: 'user@example.test',
        timestamp: 1_900_000_000,
        timezoneOffset: 0,
      };
      const userOid = await git.commit({
        message: 'User commit',
        author: identity,
        committer: identity,
      });
      await vfs.writeFile(`${root}/src/main.js`, 'console.log("staged edit");\n');
      await git.add('src/main.js');
      const indexBefore = (await vfs.readFile(`${root}/.git/index`)).slice();
      const historyBefore = (await git.log()).map(({ oid }) => oid);
      const failure = new VfsError(
        'EIO',
        `${root}/.git/refs/heads/main`,
        'injected main ref read failure',
      );
      const readFile = vfs.readFile.bind(vfs);
      const read = vi.spyOn(vfs, 'readFile').mockImplementation(async (path) => {
        if (path === failure.path) throw failure;
        return await readFile(path);
      });

      const rejected = await rejectedValue(ensureStarterInitialCommit(vfs, root));
      read.mockRestore();

      expect.soft(rejected).toBe(failure);
      expect(await git.resolveRef('HEAD')).toBe(userOid);
      expect((await git.log()).map(({ oid }) => oid)).toEqual(historyBefore);
      expect(await vfs.readFile(`${root}/.git/index`)).toEqual(indexBefore);
    } finally {
      resetSyncMirror();
    }
  });
});

async function seededStarter(root: string) {
  const vfs = asyncVfs();
  if (!vfs) throw new Error('no async vfs');
  const files = {
    [`${root}/.gitignore`]: 'node_modules/\ndist/\n',
    [`${root}/package.json`]: '{"name":"starter"}\n',
    [`${root}/src/main.js`]: 'console.log("baseline");\n',
  };
  for (const [path, content] of Object.entries(files)) {
    await vfs.mkdir(dirname(path), { recursive: true });
    await vfs.writeFile(path, content);
  }
  const initialOid = await ensureStarterInitialCommit(vfs, root);
  if (initialOid === null) throw new Error('Expected a fresh Starter initial commit');
  await vfs.writeFile(`${root}/package-lock.json`, FINAL_LOCKFILE);
  return { vfs, initialOid };
}

describe('starter baseline finalizer ∥ durability flush (fault: quota-perm-fail, provenance lie)', () => {
  it('[fault: quota-perm-fail][fault: sibling-drift] propagates a main ref read failure before amend', async () => {
    installMemoryFs();
    try {
      const root = '/projects/amend-ref-read-failure';
      const { vfs, initialOid } = await seededStarter(root);
      const git = makeGit({ fs: vfsToGitFs(vfs), dir: root });
      const indexBefore = (await vfs.readFile(`${root}/.git/index`)).slice();
      const failure = new VfsError(
        'EACCES',
        `${root}/.git/refs/heads/main`,
        'injected amend ref permission failure',
      );
      const readFile = vfs.readFile.bind(vfs);
      const read = vi.spyOn(vfs, 'readFile').mockImplementation(async (path) => {
        if (path === failure.path) throw failure;
        return await readFile(path);
      });

      const rejected = await rejectedValue(
        amendStarterGeneratedBaseline(
          vfs,
          root,
          initialOid,
          new TextEncoder().encode(FINAL_LOCKFILE),
        ),
      );
      read.mockRestore();

      expect.soft(rejected).toBe(failure);
      expect(await git.resolveRef('HEAD')).toBe(initialOid);
      expect(await vfs.readFile(`${root}/.git/index`)).toEqual(indexBefore);
    } finally {
      resetSyncMirror();
    }
  });

  it('[fault: quota-perm-fail][fault: sibling-drift] propagates an initial commit object read failure before amend', async () => {
    installMemoryFs();
    try {
      const root = '/projects/amend-commit-read-failure';
      const { vfs, initialOid } = await seededStarter(root);
      const git = makeGit({ fs: vfsToGitFs(vfs), dir: root });
      const indexBefore = (await vfs.readFile(`${root}/.git/index`)).slice();
      const failure = new VfsError(
        'EIO',
        looseObjectPath(root, initialOid),
        'injected initial commit object read failure',
      );
      const readFile = vfs.readFile.bind(vfs);
      const read = vi.spyOn(vfs, 'readFile').mockImplementation(async (path) => {
        if (path === failure.path) throw failure;
        return await readFile(path);
      });

      const rejected = await rejectedValue(
        amendStarterGeneratedBaseline(
          vfs,
          root,
          initialOid,
          new TextEncoder().encode(FINAL_LOCKFILE),
        ),
      );
      read.mockRestore();

      expect.soft(rejected).toBe(failure);
      expect(await git.resolveRef('HEAD')).toBe(initialOid);
      expect(await vfs.readFile(`${root}/.git/index`)).toEqual(indexBefore);
    } finally {
      resetSyncMirror();
    }
  });

  it('[fault: quota-perm-fail][fault: sibling-drift] propagates an initial tree object read failure before amend', async () => {
    installMemoryFs();
    try {
      const root = '/projects/amend-tree-read-failure';
      const { vfs, initialOid } = await seededStarter(root);
      const git = makeGit({ fs: vfsToGitFs(vfs), dir: root });
      const initial = (await git.log({ depth: 1 }))[0];
      if (initial === undefined) throw new Error('Expected a Starter initial commit');
      const indexBefore = (await vfs.readFile(`${root}/.git/index`)).slice();
      const failure = new VfsError(
        'EIO',
        looseObjectPath(root, initial.tree),
        'injected initial tree object read failure',
      );
      const readFile = vfs.readFile.bind(vfs);
      let injected = false;
      const read = vi.spyOn(vfs, 'readFile').mockImplementation(async (path) => {
        if (!injected && path === failure.path) {
          injected = true;
          throw failure;
        }
        return await readFile(path);
      });

      const rejected = await rejectedValue(
        amendStarterGeneratedBaseline(
          vfs,
          root,
          initialOid,
          new TextEncoder().encode(FINAL_LOCKFILE),
        ),
      );
      read.mockRestore();

      expect.soft(rejected).toBe(failure);
      expect(await git.resolveRef('HEAD')).toBe(initialOid);
      expect(await vfs.readFile(`${root}/.git/index`)).toEqual(indexBefore);
    } finally {
      resetSyncMirror();
    }
  });

  it('rejects loud when the flush fails after the real amend; repo stays one valid amended commit', async () => {
    installMemoryFs();
    try {
      const root = '/projects/flush-reject';
      const { vfs, initialOid } = await seededStarter(root);
      const finalize = createStarterBaselineFinalizer(
        vfs,
        new Map([[root, initialOid]]),
        async () => {
          throw new Error('owner VFS durability flush rejected');
        },
      );
      await expect(finalize(root, new TextEncoder().encode(FINAL_LOCKFILE))).rejects.toThrow(
        'owner VFS durability flush rejected',
      );

      const sh = new Shell({ cwd: root });
      expect((await sh.run('git log --oneline')).stdout.trim().split('\n')).toHaveLength(1);
      expect((await sh.run('git show HEAD:package-lock.json')).stdout).toBe(FINAL_LOCKFILE);
      expect(await sh.run('git status --porcelain')).toMatchObject({ exitCode: 0, stdout: '' });
    } finally {
      resetSyncMirror();
    }
  });

  it('declined amend (drifted HEAD) skips the flush and leaves the generated lock visible', async () => {
    installMemoryFs();
    try {
      const root = '/projects/flush-decline';
      const { vfs, initialOid } = await seededStarter(root);
      let flushes = 0;
      const finalize = createStarterBaselineFinalizer(
        vfs,
        new Map([[root, `${initialOid.slice(0, -6)}000000`]]),
        async () => {
          flushes += 1;
        },
      );
      await expect(finalize(root, new TextEncoder().encode(FINAL_LOCKFILE))).resolves.toBe(false);
      expect(flushes).toBe(0);

      const sh = new Shell({ cwd: root });
      expect((await sh.run('git status --porcelain')).stdout).toContain('?? package-lock.json');
      // Consumed OID: a retry can never spoof its way into the baseline.
      await expect(finalize(root, new TextEncoder().encode(FINAL_LOCKFILE))).resolves.toBe(false);
      expect(flushes).toBe(0);
    } finally {
      resetSyncMirror();
    }
  });
});
