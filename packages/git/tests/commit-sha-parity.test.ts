/**
 * Gold fidelity anchor: makeGit's commit() must produce the EXACT canonical git
 * SHA-1 for identical inputs (isomorphic-git writes canonical git objects).
 *
 * EXPECTED_SHA is a frozen reference computed once from real git 2.50.1:
 *   tmp=$(mktemp -d); cd "$tmp"; git init -q -b main
 *   printf 'hello\n' > a.txt; git add a.txt
 *   GIT_AUTHOR_NAME=Test GIT_AUTHOR_EMAIL=t@example.com GIT_AUTHOR_DATE='1600000000 +0000' \
 *   GIT_COMMITTER_NAME=Test GIT_COMMITTER_EMAIL=t@example.com GIT_COMMITTER_DATE='1600000000 +0000' \
 *   git commit -q -m first
 *   git rev-parse HEAD   # → 54276705f178d8b238806c5df4808092c8b73729
 *
 * Do NOT weaken this assertion. A divergence here means object fidelity is
 * broken (line endings, tz handling, tree ordering) — investigate, never relax.
 */
import { MemoryVfs } from '@riftydev/vfs';
import { expect, it } from 'vitest';
import { vfsToGitFs } from '../src/fs-adapter.ts';
import { makeGit } from '../src/git.ts';

const EXPECTED_SHA = '54276705f178d8b238806c5df4808092c8b73729';
const ID = { name: 'Test', email: 't@example.com', timestamp: 1_600_000_000, timezoneOffset: 0 };

it('produces the SAME commit SHA-1 as canonical git (object fidelity)', async () => {
  const vfs = new MemoryVfs();
  await vfs.mkdir('/r', { recursive: true });
  const g = makeGit({ fs: vfsToGitFs(vfs), dir: '/r' });
  await g.init();
  await vfs.writeFile('/r/a.txt', 'hello\n');
  await g.add('a.txt');
  const oid = await g.commit({ message: 'first', author: ID, committer: ID });
  expect(oid).toBe(EXPECTED_SHA);
});
