/**
 * Regression guard (review fix): `.gitignore` MUST be honored. isomorphic-git's
 * ignore manager reads `.gitignore` via `fs.readFile(path, 'utf8')` — the STRING
 * encoding form. The VFS fs-adapter previously only handled the OBJECT form
 * (`{ encoding: 'utf8' }`), so the ignore file came back as raw bytes, rules
 * never parsed, and ignored files (node_modules, build output) leaked into
 * `git status` and `git add .`. Revert the fs-adapter encoding fix and this goes
 * RED. Proven over a real MemoryVfs (no mocks).
 */
import { MemoryVfs } from '@riftydev/vfs';
import { expect, it } from 'vitest';
import { vfsToGitFs } from '../src/fs-adapter.ts';
import { makeGit } from '../src/git.ts';

const ID = { name: 'T', email: 't@e.com', timestamp: 1_600_000_000, timezoneOffset: 0 };

it('status() excludes .gitignore-ignored files (node_modules, *.log, a named file)', async () => {
  const vfs = new MemoryVfs();
  await vfs.mkdir('/r', { recursive: true });
  const g = makeGit({ fs: vfsToGitFs(vfs), dir: '/r' });
  await g.init();
  await vfs.writeFile('/r/.gitignore', 'node_modules/\n*.log\nsecret.txt\n');
  await g.add('.gitignore');
  await g.commit({ message: 'ignore', author: ID, committer: ID });

  await vfs.mkdir('/r/node_modules', { recursive: true });
  await vfs.writeFile('/r/node_modules/dep.js', 'module.exports = 1\n');
  await vfs.writeFile('/r/app.log', 'noise\n');
  await vfs.writeFile('/r/secret.txt', 'shh\n');
  await vfs.writeFile('/r/keep.txt', 'tracked-me\n');

  const paths = (await g.status()).map((e) => e.filepath);
  // The only untracked path surfaced is the non-ignored one.
  expect(paths).toContain('keep.txt');
  expect(paths).not.toContain('app.log');
  expect(paths).not.toContain('secret.txt');
  expect(paths.some((p) => p.startsWith('node_modules/'))).toBe(false);
});
