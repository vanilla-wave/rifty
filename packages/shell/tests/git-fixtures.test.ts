/**
 * Conformance: the rifty `git` builtin's output must equal FROZEN real-git
 * 2.50.1 output BYTE-FOR-BYTE for `status --porcelain` and `log --oneline`.
 *
 * Oracle policy (ADR-0093): these surfaces have NO Node analog, so the oracle is
 * a frozen golden fixture — captured ONCE from real git by
 * `tools/git-fixtures/generate.mjs`, committed under packages/git/fixtures/ with
 * a `#`-prefixed provenance header. We assert only the BODY (drop the header
 * line). The test NEVER spawns git; regeneration is a deliberate manual act.
 *
 * Why byte-exact is reachable: isomorphic-git writes CANONICAL git objects, so
 * with the SAME fixed identity + dates the commit SHAs are bit-identical to git
 * (proven in packages/git/tests/commit-sha-parity.test.ts) — hence `log
 * --oneline`'s 7-hex abbreviations match. `git status --porcelain` sorts by
 * path; isomorphic-git's statusMatrix already yields paths sorted, so the
 * builtin's emission order matches without re-sorting (asserted as-is).
 *
 * Placement: this asserts the USER-FACING shell `git` command, which lives in
 * tier-3 `@riftydev/shell` and already imports tier-0 `@riftydev/git`. The test
 * therefore sits in packages/shell/tests/ (shell→git is a legal import; git
 * could never import shell). We seed the SAME MemoryVfs tree real git saw.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { asyncVfs } from '@riftydev/vfs';
import { installMemoryFs, resetSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { git } from '../src/commands/git.ts';
import { makeCtx } from './_ctx.ts';

/**
 * Fixed identity + dates — IDENTICAL to the generator's GIT_*_DATE (epoch
 * 1600000000, +0000). Drives canonical SHAs that match real git's, so the
 * abbreviations in `log --oneline` line up byte-for-byte.
 */
const ENV: Record<string, string> = {
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 't@example.com',
  GIT_AUTHOR_DATE: '1600000000',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 't@example.com',
  GIT_COMMITTER_DATE: '1600000000',
};

const REPO = '/repo';

/** Read a fixture's BODY (drop the leading `#` provenance line). */
function fixtureBody(name: string): string {
  const path = fileURLToPath(new URL(`../../git/fixtures/${name}`, import.meta.url));
  const raw = readFileSync(path, 'utf8');
  const nl = raw.indexOf('\n');
  return raw.slice(nl + 1);
}

async function writeFile(path: string, content: string): Promise<void> {
  const vfs = asyncVfs();
  if (!vfs) throw new Error('no async vfs');
  await vfs.writeFile(path, content);
}

async function rm(path: string): Promise<void> {
  const vfs = asyncVfs();
  if (!vfs) throw new Error('no async vfs');
  await vfs.rm(path);
}

/** Run a `git` subcommand against REPO, return captured stdout, assert exit 0. */
async function runGit(args: string[]): Promise<string> {
  const { ctx, out } = makeCtx({ cwd: REPO, env: ENV });
  const code = await git(args, ctx);
  expect(code).toBe(0);
  return out();
}

async function initRepo(): Promise<void> {
  const vfs = asyncVfs();
  if (!vfs) throw new Error('no async vfs after installMemoryFs');
  await vfs.mkdir(REPO, { recursive: true });
  await runGit(['init']);
}

beforeEach(() => {
  installMemoryFs();
});
afterEach(() => resetSyncMirror());

it('status --porcelain: 2 untracked files matches real git byte-for-byte', async () => {
  await initRepo();
  await writeFile(`${REPO}/a.txt`, 'alpha\n');
  await writeFile(`${REPO}/b.txt`, 'beta\n');
  expect(await runGit(['status', '--porcelain'])).toBe(fixtureBody('status-untracked.porcelain'));
});

it('status --porcelain: 2 staged-new files matches real git byte-for-byte', async () => {
  await initRepo();
  await writeFile(`${REPO}/a.txt`, 'alpha\n');
  await writeFile(`${REPO}/b.txt`, 'beta\n');
  await runGit(['add', 'a.txt']);
  await runGit(['add', 'b.txt']);
  expect(await runGit(['status', '--porcelain'])).toBe(fixtureBody('status-staged.porcelain'));
});

it('status --porcelain: mixed (modified/staged-new/untracked/deleted) matches real git', async () => {
  await initRepo();
  // Commit the two files we will later modify / delete.
  await writeFile(`${REPO}/tracked.txt`, 'v1\n');
  await writeFile(`${REPO}/doomed.txt`, 'bye\n');
  await runGit(['add', 'tracked.txt']);
  await runGit(['add', 'doomed.txt']);
  await runGit(['commit', '-m', 'base']);
  // committed+modified (unstaged worktree change → ` M`).
  await writeFile(`${REPO}/tracked.txt`, 'v2\n');
  // staged-new (→ `A `).
  await writeFile(`${REPO}/staged-new.txt`, 'fresh\n');
  await runGit(['add', 'staged-new.txt']);
  // untracked (→ `??`).
  await writeFile(`${REPO}/untracked.txt`, 'loose\n');
  // committed-then-deleted in the worktree (unstaged → ` D`).
  await rm(`${REPO}/doomed.txt`);
  expect(await runGit(['status', '--porcelain'])).toBe(fixtureBody('status-mixed.porcelain'));
});

it('log --oneline: 2 commits matches real git byte-for-byte (canonical SHAs)', async () => {
  await initRepo();
  await writeFile(`${REPO}/a.txt`, 'alpha\n');
  await runGit(['add', 'a.txt']);
  await runGit(['commit', '-m', 'first']);
  await writeFile(`${REPO}/b.txt`, 'beta\n');
  await runGit(['add', 'b.txt']);
  await runGit(['commit', '-m', 'second']);
  expect(await runGit(['log', '--oneline'])).toBe(fixtureBody('log-oneline.txt'));
});
