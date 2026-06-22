/**
 * Facade primitives for the shell's `commit --amend`, `git config`, and
 * `git restore --staged` — proven over a real {@link MemoryVfs} (no mocks).
 *   - amend    → `commit({amend:true})` replaces HEAD (oid changes, log length 1).
 *   - config   → `setConfig`/`getConfig` round-trip; unset → undefined.
 *   - unstage  → `unstage(path)` moves a staged file back to unstaged (stage code).
 */
import { MemoryVfs } from '@riftydev/vfs';
import { expect, it } from 'vitest';
import { vfsToGitFs } from '../src/fs-adapter.ts';
import { makeGit } from '../src/git.ts';

const AUTHOR = {
  name: 'Test',
  email: 't@example.com',
  timestamp: 1_600_000_000,
  timezoneOffset: 0,
};

it('commit --amend replaces HEAD (log length unchanged, oid changes)', async () => {
  const vfs = new MemoryVfs();
  await vfs.mkdir('/repo', { recursive: true });
  const g = makeGit({ fs: vfsToGitFs(vfs), dir: '/repo' });
  await g.init();
  await vfs.writeFile('/repo/a.txt', 'hello\n');
  await g.add('a.txt');
  const first = await g.commit({ message: 'first', author: AUTHOR, committer: AUTHOR });

  const amended = await g.commit({
    message: 'amended',
    author: AUTHOR,
    committer: AUTHOR,
    amend: true,
  });
  const log = await g.log();
  expect(log).toHaveLength(1);
  expect(log[0]?.message.startsWith('amended')).toBe(true);
  expect(amended).not.toBe(first);
});

it('setConfig/getConfig round-trips; unset key → undefined', async () => {
  const vfs = new MemoryVfs();
  await vfs.mkdir('/r', { recursive: true });
  const g = makeGit({ fs: vfsToGitFs(vfs), dir: '/r' });
  await g.init();
  await g.setConfig('user.name', 'Ada');
  expect(await g.getConfig('user.name')).toBe('Ada');
  expect(await g.getConfig('no.such')).toBeUndefined();
});

it('unstage moves a staged file back to unstaged', async () => {
  const vfs = new MemoryVfs();
  await vfs.mkdir('/r', { recursive: true });
  const g = makeGit({ fs: vfsToGitFs(vfs), dir: '/r' });
  await g.init();
  await vfs.writeFile('/r/x.txt', 'x');
  await g.add('x.txt');
  const staged = (await g.status()).find((e) => e.filepath === 'x.txt');
  await g.unstage('x.txt');
  const unstaged = (await g.status()).find((e) => e.filepath === 'x.txt');
  // The stage digit (3rd code char) must change from staged → unstaged.
  expect(staged?.status).toBeDefined();
  expect(unstaged?.status).toBeDefined();
  expect(unstaged?.status).not.toBe(staged?.status);
});
