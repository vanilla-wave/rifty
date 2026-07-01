import { MemoryVfs } from '@riftydev/vfs';
import { expect, it } from 'vitest';
import { vfsToGitFs } from '../src/fs-adapter.ts';
import { makeGit } from '../src/git.ts';
import { porcelainXY } from '../src/index.ts';

const AUTHOR = { name: 'T', email: 't@e.com', timestamp: 1_600_000_000, timezoneOffset: 0 };

async function seeded(): Promise<{ g: ReturnType<typeof makeGit>; vfs: MemoryVfs }> {
  const vfs = new MemoryVfs();
  await vfs.mkdir('/repo', { recursive: true });
  const g = makeGit({ fs: vfsToGitFs(vfs), dir: '/repo' });
  await g.init();
  await vfs.writeFile('/repo/a.txt', 'first\n');
  await g.add('a.txt');
  await g.commit({ message: 'first', author: AUTHOR });
  return { g, vfs };
}

async function xyFor(g: ReturnType<typeof makeGit>, file: string): Promise<string | null> {
  const entry = (await g.status()).find((e) => e.filepath === file);
  return entry ? porcelainXY(entry.status) : null;
}

it('maps statusMatrix codes to porcelain XY', () => {
  expect(porcelainXY('111')).toBeNull();
  expect(porcelainXY('020')).toBe('??');
  expect(porcelainXY('022')).toBe('A ');
  expect(porcelainXY('003')).toBe('AD');
  expect(porcelainXY('121')).toBe(' M');
  expect(porcelainXY('122')).toBe('M ');
  expect(porcelainXY('123')).toBe('MM');
  expect(porcelainXY('101')).toBe(' D');
  expect(porcelainXY('100')).toBe('D ');
  expect(porcelainXY('999')).toBe('999');
});

it('maps the staged+worktree combos that older code dropped as raw', () => {
  expect(porcelainXY('023')).toBe('AM'); // staged-new then edited again
  expect(porcelainXY('103')).toBe('MD'); // staged-modified then deleted on disk
  expect(porcelainXY('113')).toBe('MM'); // staged-modified then reverted in worktree
});

it('AM is reachable: stage a new file, then keep editing it', async () => {
  const { g, vfs } = await seeded();
  await vfs.writeFile('/repo/new.txt', 'added\n');
  await g.add('new.txt');
  await vfs.writeFile('/repo/new.txt', 'added then edited\n');
  expect(await xyFor(g, 'new.txt')).toBe('AM');
});

it('MD is reachable: stage a modification, then delete the file on disk', async () => {
  const { g, vfs } = await seeded();
  await vfs.writeFile('/repo/a.txt', 'changed\n');
  await g.add('a.txt');
  await vfs.rm('/repo/a.txt');
  expect(await xyFor(g, 'a.txt')).toBe('MD');
});
