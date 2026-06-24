import { NotImplementedError } from '@riftydev/io';
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

async function seededGit(): Promise<{ g: ReturnType<typeof makeGit>; vfs: MemoryVfs }> {
  const vfs = new MemoryVfs();
  await vfs.mkdir('/repo', { recursive: true });
  const g = makeGit({ fs: vfsToGitFs(vfs), dir: '/repo' });
  await g.init();
  await vfs.writeFile('/repo/a.txt', 'first\n');
  await g.add('a.txt');
  await g.commit({ message: 'first', author: AUTHOR });
  await vfs.writeFile('/repo/a.txt', 'second\n');
  await g.add('a.txt');
  await g.commit({ message: 'second', author: AUTHOR });
  return { g, vfs };
}

it('unsupported reflog and extended revspecs are NotImplementedError ceilings', async () => {
  const { g } = await seededGit();

  await expect(g.resolveRevision('HEAD@{1}')).rejects.toBeInstanceOf(NotImplementedError);
  await expect(g.resolveRevision('HEAD^{tree}')).rejects.toBeInstanceOf(NotImplementedError);
});

it('HEAD^0 resolves to the current commit without walking to a parent', async () => {
  const { g } = await seededGit();

  await expect(g.resolveRevision('HEAD^0')).resolves.toBe(await g.resolveRevision('HEAD'));
});

it('log depth 0 returns no commits', async () => {
  const { g } = await seededGit();

  await expect(g.log({ depth: 0 })).resolves.toEqual([]);
});

it('show REV:path returns the selected blob oid, not the commit oid', async () => {
  const { g } = await seededGit();
  const object = await g.show('HEAD:a.txt');

  expect(object.type).toBe('blob');
  if (object.type !== 'blob') throw new Error('expected blob');
  expect(object.oid).toBe(await g.hashBlob('second\n'));
});
