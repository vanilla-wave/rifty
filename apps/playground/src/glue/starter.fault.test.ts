/**
 * Fault: `ensureStarterInitialCommit` racing an instant-deps restore
 * (concurrent-same-key / torn-state at the seed boundary). The owner boot
 * overlaps the initial commit with the baked node_modules restore — the commit's
 * status walk must tolerate ignored-tree churn mid-walk, and a lockfile the
 * restore lands mid-commit must be folded by the follow-up amend either way.
 */
import { Shell } from '@riftydev/shell';
import { asyncVfs, dirname } from '@riftydev/vfs';
import { installMemoryFs, resetSyncMirror } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import {
  amendStarterGeneratedBaseline,
  ensureStarterInitialCommit,
} from './git-initial-baseline.ts';
import { seedFilesForStarter, starterById } from './starter.ts';

const FINAL_LOCKFILE = '{"lockfileVersion":3,"packages":{}}\n';

describe('starter initial commit ∥ instant-deps restore (fault: concurrent restore churn)', () => {
  it('commits a clean baseline while node_modules + lockfile land mid-walk; amend folds the final lockfile', async () => {
    installMemoryFs();
    try {
      const root = '/projects/race';
      const vfs = asyncVfs();
      if (!vfs) throw new Error('no async vfs');
      const files = seedFilesForStarter(starterById('project-files'), root);
      for (const [path, content] of Object.entries(files)) {
        await vfs.mkdir(dirname(path), { recursive: true });
        await vfs.writeFile(path, content);
      }

      // Restore-like writer: many small files under the ignored node_modules
      // tree, yielding per write so the commit's status walk interleaves; the
      // lockfile lands mid-stream (torn vs the FINAL content on purpose), then
      // is rewritten to final — mirroring a snapshot restore.
      const restore = (async () => {
        for (let i = 0; i < 120; i++) {
          const pkgDir = `${root}/node_modules/pkg-${i % 12}`;
          await vfs.mkdir(pkgDir, { recursive: true });
          await vfs.writeFile(`${pkgDir}/file-${i}.js`, `module.exports = ${i};\n`);
          if (i === 40) await vfs.writeFile(`${root}/package-lock.json`, '{"lockfileVer');
          if (i === 80) await vfs.writeFile(`${root}/package-lock.json`, FINAL_LOCKFILE);
        }
      })();
      await Promise.all([ensureStarterInitialCommit(vfs, root), restore]);
      await amendStarterGeneratedBaseline(vfs, root);

      const sh = new Shell({ cwd: root });
      // Single Initial commit, worktree clean — regardless of where the walk
      // caught the restore.
      const log = await sh.run('git log --oneline');
      expect(log.exitCode).toBe(0);
      expect(log.stdout.trim().split('\n')).toHaveLength(1);
      expect(log.stdout).toMatch(/^[0-9a-f]{7} Initial commit\n$/);
      const status = await sh.run('git status --porcelain');
      expect(status).toMatchObject({ exitCode: 0, stdout: '', stderr: '' });

      // The baseline folded the FINAL lockfile (never the torn mid-stream one)
      // and never staged the ignored node_modules tree.
      const lock = await sh.run('git show HEAD:package-lock.json');
      expect(lock.exitCode).toBe(0);
      expect(lock.stdout).toBe(FINAL_LOCKFILE);
      const ignoredInTree = await sh.run('git show HEAD:node_modules/pkg-0/file-0.js');
      expect(ignoredInTree.exitCode).not.toBe(0);
    } finally {
      resetSyncMirror();
    }
  });
});
