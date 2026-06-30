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

it('annotated tag commit-ish revspecs peel to the tagged commit', async () => {
  const { g } = await seededGit();
  const head = await g.resolveRef('HEAD');
  await g.createTag({
    name: 'v1',
    annotated: true,
    message: 'release\n',
    tagger: AUTHOR,
  });

  await expect(g.resolveRevision('v1')).resolves.toBe(head);
  await expect(g.resolveRevision('v1^0')).resolves.toBe(head);
  await expect(g.resolveRevision('v1~0')).resolves.toBe(head);
  const shown = await g.show('v1');
  expect(shown.type).toBe('tag');
});

it('reset rejects annotated tags whose target is not a commit without moving HEAD', async () => {
  const { g } = await seededGit();
  const head = await g.resolveRef('HEAD');
  const shown = await g.show('HEAD');
  expect(shown.type).toBe('commit');
  if (shown.type !== 'commit') throw new Error('expected commit');
  await g.createTag({
    name: 'tree-tag',
    object: shown.commit.tree,
    annotated: true,
    message: 'tree tag\n',
    tagger: AUTHOR,
  });

  await expect(g.reset({ target: 'tree-tag', mode: 'soft' })).rejects.toThrow('not a commit');
  await expect(g.resolveRef('HEAD')).resolves.toBe(head);
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

it('show :path returns the staged index blob, matching real git index revspecs', async () => {
  const { g, vfs } = await seededGit();
  await vfs.writeFile('/repo/a.txt', 'staged\n');
  await g.add('a.txt');
  await vfs.writeFile('/repo/a.txt', 'worktree\n');

  const object = await g.show(':a.txt');

  expect(object.type).toBe('blob');
  if (object.type !== 'blob') throw new Error('expected blob');
  expect(object.oid).toBe(await g.hashBlob('staged\n'));
});
