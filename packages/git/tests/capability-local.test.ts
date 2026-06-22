/**
 * makeGit facade — LOCAL porcelain proven over a real {@link MemoryVfs} (no
 * mocks). init→add→commit→log round-trips, status reflects untracked/staged,
 * and the NETWORK verbs (clone/fetch/pull/push) loud-throw NotImplementedError
 * (transport lands in a later phase).
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

it('init→add→commit→log round-trips over the VFS', async () => {
  const vfs = new MemoryVfs();
  await vfs.mkdir('/repo', { recursive: true });
  const g = makeGit({ fs: vfsToGitFs(vfs), dir: '/repo' });
  await g.init();
  await vfs.writeFile('/repo/a.txt', 'hello\n');
  await g.add('a.txt');
  const oid = await g.commit({ message: 'first', author: AUTHOR });
  expect(oid).toMatch(/^[0-9a-f]{40}$/);
  const log = await g.log();
  expect(log).toHaveLength(1);
  const [head] = log;
  expect(head?.message.trim()).toBe('first');
  expect(head?.oid).toBe(oid);
  expect(await g.currentBranch()).toBe('main');
});

it('status reflects an untracked then staged file', async () => {
  const vfs = new MemoryVfs();
  await vfs.mkdir('/r', { recursive: true });
  const g = makeGit({ fs: vfsToGitFs(vfs), dir: '/r' });
  await g.init();
  await vfs.writeFile('/r/n.txt', 'x');
  const before = await g.status();
  expect(before.find((e) => e.filepath === 'n.txt')).toBeTruthy();
  await g.add('n.txt');
  const after = await g.status();
  expect(after.find((e) => e.filepath === 'n.txt')).toBeTruthy();
});

it('clone/fetch/pull/push throw NotImplementedError', async () => {
  const vfs = new MemoryVfs();
  await vfs.mkdir('/r', { recursive: true });
  const g = makeGit({ fs: vfsToGitFs(vfs), dir: '/r' });
  const net = g as unknown as Record<string, () => unknown>;
  for (const verb of ['clone', 'fetch', 'pull', 'push'] as const) {
    expect(() => net[verb]?.()).toThrow(/Not implemented: git\./);
  }
});
