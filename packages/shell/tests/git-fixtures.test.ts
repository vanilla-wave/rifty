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

async function readFile(path: string): Promise<string> {
  const vfs = asyncVfs();
  if (!vfs) throw new Error('no async vfs');
  const buf = await vfs.readFile(path);
  return typeof buf === 'string' ? buf : new TextDecoder().decode(buf);
}

/** Run a `git` subcommand against REPO, return captured stdout, assert exit 0. */
async function runGit(args: string[]): Promise<string> {
  const { ctx, out } = makeCtx({ cwd: REPO, env: ENV });
  const code = await git(args, ctx);
  expect(code).toBe(0);
  return out();
}

/** Run a `git` subcommand, return BOTH streams + exit (no exit assertion). */
async function runGitFull(args: string[]): Promise<{ out: string; err: string; code: number }> {
  const { ctx, out, err } = makeCtx({ cwd: REPO, env: ENV });
  const code = await git(args, ctx);
  return { out: out(), err: err(), code };
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

/**
 * Build the SAME repo real git used to capture the checkout fixtures, so commit
 * SHAs are bit-identical (the detached fixture pins 7fdebb4...). main holds
 * a.txt='one'; `other` adds a.txt='two' ('second' commit); HEAD back on main.
 * If the canonical SHA drifts the detached test fails loudly — that's correct.
 */
async function twoBranchRepo(): Promise<void> {
  await initRepo();
  await writeFile(`${REPO}/a.txt`, 'one\n');
  await runGit(['add', 'a.txt']);
  await runGit(['commit', '-m', 'first']);
  await runGit(['checkout', '-b', 'other']);
  await writeFile(`${REPO}/a.txt`, 'two\n');
  await runGit(['add', 'a.txt']);
  await runGit(['commit', '-m', 'second']);
  await runGit(['checkout', 'main']);
}

it('checkout <branch>: switch to existing branch — byte-exact stderr (stdout empty)', async () => {
  await twoBranchRepo();
  const { out, err, code } = await runGitFull(['checkout', 'other']);
  expect(code).toBe(0);
  expect(out).toBe(fixtureBody('checkout-switch.out'));
  expect(err).toBe(fixtureBody('checkout-switch.err'));
});

it('checkout -b <name>: create + switch — byte-exact stderr (stdout empty)', async () => {
  await twoBranchRepo();
  const { out, err, code } = await runGitFull(['checkout', '-b', 'feature']);
  expect(code).toBe(0);
  expect(out).toBe(fixtureBody('checkout-create.out'));
  expect(err).toBe(fixtureBody('checkout-create.err'));
});

it('checkout <current>: already on branch — byte-exact stderr (stdout empty)', async () => {
  await twoBranchRepo();
  const { out, err, code } = await runGitFull(['checkout', 'main']);
  expect(code).toBe(0);
  expect(out).toBe(fixtureBody('checkout-already.out'));
  expect(err).toBe(fixtureBody('checkout-already.err'));
});

it('checkout <branch>: dirty-tree conflict refusal — byte-exact stderr, exit 1', async () => {
  await twoBranchRepo();
  await writeFile(`${REPO}/a.txt`, 'dirty\n');
  const { out, err, code } = await runGitFull(['checkout', 'other']);
  expect(code).toBe(1);
  expect(out).toBe(fixtureBody('checkout-conflict.out'));
  expect(err).toBe(fixtureBody('checkout-conflict.err'));
});

it('checkout <full-sha>: detached HEAD advisory — byte-exact (canonical SHA 7fdebb4...)', async () => {
  await twoBranchRepo();
  // other's tip = the 'second' commit; resolve its FULL sha via the facade-backed CLI.
  const { ctx } = makeCtx({ cwd: REPO, env: ENV });
  void ctx; // resolve via the public git package facade through the shell's makeGit path
  const sha = await otherTipSha();
  const { out, err, code } = await runGitFull(['checkout', sha]);
  expect(code).toBe(0);
  expect(out).toBe(fixtureBody('checkout-detached.out'));
  expect(err).toBe(fixtureBody('checkout-detached.err'));
});

it('checkout -- <path>: restore from index — silent (both streams empty), reverts content', async () => {
  await twoBranchRepo();
  // On main a.txt='one'; dirty it, then restore from index → back to 'one'.
  await writeFile(`${REPO}/a.txt`, 'dirty\n');
  const { out, err, code } = await runGitFull(['checkout', '--', 'a.txt']);
  expect(code).toBe(0);
  expect(out).toBe(fixtureBody('checkout-restore.out'));
  expect(err).toBe(fixtureBody('checkout-restore.err'));
  expect(await readFile(`${REPO}/a.txt`)).toBe('one\n');
});

/** Full sha of `other`'s tip (the 'second' commit) via the git facade. */
async function otherTipSha(): Promise<string> {
  const { makeGit, vfsToGitFs } = await import('@riftydev/git');
  const vfs = asyncVfs();
  if (!vfs) throw new Error('no async vfs');
  const g = makeGit({ fs: vfsToGitFs(vfs), dir: REPO });
  return g.resolveRef('other');
}
