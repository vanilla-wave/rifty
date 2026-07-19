import { Shell } from '@riftydev/shell';
import { type Vfs, dirname } from '@riftydev/vfs';
import { createMemoryFs } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import {
  amendStarterGeneratedBaseline,
  ensureStarterInitialCommit,
} from './git-initial-baseline.ts';

async function seed(vfs: Vfs, root: string): Promise<void> {
  const files = {
    [`${root}/.gitignore`]: 'node_modules/\ndist/\n',
    [`${root}/src/main.js`]: 'console.log("baseline");\n',
  };
  for (const [path, content] of Object.entries(files)) {
    await vfs.mkdir(dirname(path), { recursive: true });
    await vfs.writeFile(path, content);
  }
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

    await ensureStarterInitialCommit(vfs, root);
    await ensureStarterInitialCommit(vfs, root);

    const sh = new Shell({ cwd: root, fileSystem: fsSync });
    expect(await sh.run('git status --porcelain')).toMatchObject({
      exitCode: 0,
      stdout: '',
      stderr: '',
    });
    expect((await sh.run('git log --oneline')).stdout).toMatch(
      /^[0-9a-f]{7} Initial commit\n$/,
    );

    await vfs.writeFile(`${root}/src/main.js`, 'console.log("edited");\n');
    const dirty = await sh.run('git status --porcelain');
    expect(dirty.stdout).toContain(' M src/main.js');
    expect(dirty.stdout).not.toContain('node_modules/');
    expect(dirty.stdout).not.toContain('dist/');
  });

  it('commits against the supplied VFS without an ambient mirror', async () => {
    const { vfs } = createMemoryFs();
    const root = '/isolated';
    await seed(vfs, root);

    await ensureStarterInitialCommit(vfs, root);

    expect(await vfs.readFileText(`${root}/.git/refs/heads/main`)).toMatch(
      /^[0-9a-f]{40}\n$/,
    );
  });

  it('folds a generated lockfile into the single initial commit', async () => {
    const { vfs, fsSync } = createMemoryFs();
    const root = '/project';
    await seed(vfs, root);
    await ensureStarterInitialCommit(vfs, root);
    await vfs.writeFile(`${root}/package-lock.json`, '{"lockfileVersion":3}\n');

    await amendStarterGeneratedBaseline(vfs, root);

    const sh = new Shell({ cwd: root, fileSystem: fsSync });
    expect(await sh.run('git status --porcelain')).toMatchObject({
      exitCode: 0,
      stdout: '',
      stderr: '',
    });
    expect((await sh.run('git log --oneline')).stdout).toMatch(
      /^[0-9a-f]{7} Initial commit\n$/,
    );
    expect((await sh.run('git show HEAD:package-lock.json')).stdout).toBe(
      '{"lockfileVersion":3}\n',
    );
  });
});
