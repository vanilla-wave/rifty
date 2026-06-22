/**
 * Fidelity guard (ADR-0167): a same-BYTE-LENGTH content edit after commit MUST be
 * reported by status/diff — never silently dropped by isomorphic-git's racy-clean
 * index stat shortcut. This is the realistic fast-agent path (toggling a flag,
 * fixing an equal-length typo). End-to-end over a real MemoryVfs; the deterministic
 * invariant it relies on (strictly-monotonic write mtime) is guarded in
 * packages/vfs/src/mtime-monotonic.test.ts.
 */
import { MemoryVfs } from '@riftydev/vfs';
import { expect, it } from 'vitest';
import { vfsToGitFs } from '../src/fs-adapter.ts';
import { makeGit } from '../src/git.ts';

const ID = { name: 'Test', email: 't@example.com', timestamp: 1_600_000_000, timezoneOffset: 0 };

it('a same-size content edit after commit is reported as modified (status + diff)', async () => {
  const vfs = new MemoryVfs();
  await vfs.mkdir('/r', { recursive: true });
  const g = makeGit({ fs: vfsToGitFs(vfs), dir: '/r' });
  await g.init();
  await vfs.writeFile('/r/x.txt', 'one\n');
  await g.add('x.txt');
  await g.commit({ message: 'first', author: ID, committer: ID });

  // Overwrite with the SAME byte length (4 bytes), no commit.
  await vfs.writeFile('/r/x.txt', 'two\n');

  const entry = (await g.status()).find((e) => e.filepath === 'x.txt');
  expect(entry).toBeDefined();
  expect(entry?.status).not.toBe('111'); // 111 == unchanged — must NOT look clean

  const fileDiff = (await g.diff()).find((d) => d.filepath === 'x.txt');
  expect(fileDiff?.change).toBe('modify');
  const lines = fileDiff?.hunks.flatMap((h) => h.lines) ?? [];
  expect(lines).toContain('-one');
  expect(lines).toContain('+two');
});
