/**
 * Fidelity guard (ADR-0167): a same-BYTE-LENGTH content edit after commit MUST be
 * reported by status/diff — never silently dropped by isomorphic-git's racy-clean
 * index stat shortcut. This is the realistic fast-agent path (toggling a flag,
 * fixing an equal-length typo). End-to-end over a real MemoryVfs.
 *
 * DETERMINISTIC: we FREEZE the clock (fake Date) so the staged write and the
 * post-commit overwrite land in the SAME tick — the exact race the fix targets.
 * Only the VFS's strictly-monotonic write mtime (+ the mtime-derived ino) makes
 * the same-tick, same-size edit visible. Revert that fix and this test goes RED
 * (no reliance on the wall clock advancing). The lower-level invariant is also
 * guarded directly in packages/vfs/src/mtime-monotonic.test.ts.
 */
import { MemoryVfs } from '@riftydev/vfs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { vfsToGitFs } from '../src/fs-adapter.ts';
import { makeGit } from '../src/git.ts';

const ID = { name: 'Test', email: 't@example.com', timestamp: 1_600_000_000, timezoneOffset: 0 };

// Freeze ONLY Date (leave timers real so iso-git's promise plumbing is unaffected).
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

it('a same-size content edit after commit is reported as modified (status + diff)', async () => {
  const vfs = new MemoryVfs();
  await vfs.mkdir('/r', { recursive: true });
  const g = makeGit({ fs: vfsToGitFs(vfs), dir: '/r' });
  await g.init();
  await vfs.writeFile('/r/x.txt', 'one\n');
  await g.add('x.txt');
  await g.commit({ message: 'first', author: ID, committer: ID });

  // Clock is FROZEN → this same-byte-length overwrite shares the staged write's
  // mtime tick. Without the strictly-monotonic mtime bump it would collide and
  // iso-git's racy-clean shortcut would trust the stale index (silent data loss).
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
