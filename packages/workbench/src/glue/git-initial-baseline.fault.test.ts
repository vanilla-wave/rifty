/**
 * Faults: `ensureStarterInitialCommit` racing an instant-deps restore
 * (concurrent-same-key / torn-state at the seed boundary);
 * `createStarterBaselineFinalizer` vs durability rejection + drifted HEAD
 * (quota-perm-fail / provenance lie at the amend boundary).
 */
import { Shell } from '@riftydev/shell';
import { asyncVfs, dirname } from '@riftydev/vfs';
import { installMemoryFs, resetSyncMirror } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import {
  amendStarterGeneratedBaseline,
  createStarterBaselineFinalizer,
  ensureStarterInitialCommit,
} from './git-initial-baseline.ts';

const FINAL_LOCKFILE = '{"lockfileVersion":3,"packages":{}}\n';

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
