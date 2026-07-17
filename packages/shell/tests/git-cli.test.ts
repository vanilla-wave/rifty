/**
 * `git` builtin over the real {@link @riftydev/git} facade + the ambient async
 * VFS (no mocks). We seed the shared MemoryVfs via `installMemoryFs()` (wires
 * both the sync mirror AND `asyncVfs()`, which the command reads), then drive
 * init → status → add → commit → log through the CLI surface.
 *
 * Porcelain XY codes were cross-checked against real git 2.50.1 (see git.ts).
 * Commits are made deterministic by pinning identity + dates via env.
 */
import { asyncVfs } from '@riftydev/vfs';
import { installMemoryFs, resetSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { cloneDestination, git } from '../src/commands/git.ts';
import { makeCtx } from './_ctx.ts';

/** Fixed identity + dates → reproducible oids. */
const ENV: Record<string, string> = {
  GIT_AUTHOR_NAME: 'rifty',
  GIT_AUTHOR_EMAIL: 'rifty@localhost',
  GIT_AUTHOR_DATE: '1600000000',
  GIT_COMMITTER_NAME: 'rifty',
  GIT_COMMITTER_EMAIL: 'rifty@localhost',
  GIT_COMMITTER_DATE: '1600000000',
};

async function seedRepoDir(): Promise<void> {
  const vfs = asyncVfs();
  if (!vfs) throw new Error('no async vfs after installMemoryFs');
  await vfs.mkdir('/repo', { recursive: true });
}

async function writeFile(path: string, content: string): Promise<void> {
  const vfs = asyncVfs();
  if (!vfs) throw new Error('no async vfs');
  await vfs.writeFile(path, content);
}

beforeEach(() => {
  installMemoryFs();
});
afterEach(() => resetSyncMirror());

it('init then status --porcelain shows an untracked file', async () => {
  await seedRepoDir();
  await writeFile('/repo/a.txt', 'hi\n');
  const init = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['init'], init.ctx)).toBe(0);
  expect(init.out()).toContain('Initialized empty Git repository');

  const st = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['status', '--porcelain'], st.ctx)).toBe(0);
  expect(st.out()).toContain('?? a.txt');
});

it('after add, status --porcelain shows a staged-new file', async () => {
  await seedRepoDir();
  await writeFile('/repo/a.txt', 'hi\n');
  await git(['init'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  expect(await git(['add', 'a.txt'], makeCtx({ cwd: '/repo', env: ENV }).ctx)).toBe(0);

  const st = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['status', '--porcelain'], st.ctx)).toBe(0);
  // Real git 2.50.1: a freshly-added (index, no HEAD) file is `A ` + filepath.
  expect(st.out()).toContain('A  a.txt');
});

it('commit then log --oneline prints one short-oid + message line', async () => {
  await seedRepoDir();
  await writeFile('/repo/a.txt', 'hi\n');
  await git(['init'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  await git(['add', 'a.txt'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  const commit = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['commit', '-m', 'msg'], commit.ctx)).toBe(0);

  const log = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['log', '--oneline'], log.ctx)).toBe(0);
  const lines = log
    .out()
    .split('\n')
    .filter((l) => l.length > 0);
  expect(lines).toHaveLength(1);
  expect(lines[0]).toMatch(/^[0-9a-f]{7} msg$/);
});

it('unknown subcommand exits 1 and reports it is not a git command', async () => {
  await seedRepoDir();
  const { ctx, err } = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['frobnicate'], ctx)).toBe(1);
  expect(err()).toContain('not a git command');
});

it('a known-but-unimplemented git subcommand throws loud (exit 128, not implemented)', async () => {
  await seedRepoDir();
  const { ctx, err } = makeCtx({ cwd: '/repo', env: ENV });
  // `rebase` is a real git command rifty does not implement (browser subset) — it
  // must say "not implemented" (loud ceiling), NOT "not a git command" (typo).
  expect(await git(['rebase'], ctx)).toBe(128);
  expect(err()).toContain('not implemented in rifty');
  expect(err()).not.toContain('not a git command');
});

it('clone over an unsupported transport surfaces NotImplementedError (exit 128)', async () => {
  await seedRepoDir();
  const { ctx, err } = makeCtx({ cwd: '/repo', env: ENV });
  // ssh:// has no browser transport (no raw TCP) → loud-throw at exit 128.
  expect(await git(['clone', 'ssh://github.com/x/y.git'], ctx)).toBe(128);
  expect(err()).toContain('Not implemented: git.transport.ssh');
});

it('clone without a <url> fails loudly (exit 129, git usage)', async () => {
  await seedRepoDir();
  const { ctx, err } = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['clone'], ctx)).toBe(129);
  expect(err()).toContain('You must specify a repository to clone.');
  expect(err()).toContain('usage: git clone');
});

/** Seed a single-commit repo on `main` with a.txt committed. */
async function seedCommittedRepo(): Promise<void> {
  await seedRepoDir();
  await writeFile('/repo/a.txt', 'hi\n');
  await git(['init'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  await git(['add', 'a.txt'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  await git(['commit', '-m', 'first'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
}

async function seedAmbiguousMainFileRepo(): Promise<void> {
  await seedRepoDir();
  await writeFile('/repo/main', 'main file\n');
  await writeFile('/repo/a.txt', 'hi\n');
  await git(['init'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  await git(['add', 'main', 'a.txt'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  await git(['commit', '-m', 'first'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
}

it('checkout -b <existing> → exit 128, "a branch named ... already exists"', async () => {
  await seedCommittedRepo();
  await git(['checkout', '-b', 'feat'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  // Back to main, then try to recreate `feat`.
  await git(['checkout', 'main'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  const { ctx, err } = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['checkout', '-b', 'feat'], ctx)).toBe(128);
  expect(err()).toContain("a branch named 'feat' already exists");
});

it('checkout <nonexistent> (not a ref, not a path) → exit 1, pathspec did not match', async () => {
  await seedCommittedRepo();
  const { ctx, err } = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['checkout', 'nonexistent'], ctx)).toBe(1);
  expect(err()).toContain("pathspec 'nonexistent' did not match");
});

it('checkout <ambiguous-rev-and-file> <path> refuses without --', async () => {
  await seedAmbiguousMainFileRepo();

  const { ctx, err } = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['checkout', 'main', 'a.txt'], ctx)).toBe(128);
  expect(err()).toContain("fatal: ambiguous argument 'main': both revision and filename");
  expect(err()).toContain("Use '--' to separate paths from revisions");
});

it('checkout --orphan x → exit 128, Not implemented: git.checkout.orphan', async () => {
  await seedCommittedRepo();
  const { ctx, err } = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['checkout', '--orphan', 'x'], ctx)).toBe(128);
  expect(err()).toContain('Not implemented: git.checkout.orphan');
});

it('checkout glob pathspec (not a literal path) → exit 128, glob-pathspec ceiling', async () => {
  await seedCommittedRepo();
  const { ctx, err } = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['checkout', 'a*'], ctx)).toBe(128);
  expect(err()).toContain('Not implemented: git.checkout.glob-pathspec');
});

it('a clean switch prints to STDERR not stdout', async () => {
  await seedCommittedRepo();
  await git(['checkout', '-b', 'other'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  const { ctx, out, err } = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['checkout', 'main'], ctx)).toBe(0);
  expect(out()).toBe('');
  expect(err()).toContain('Switched to branch');
});

it('checkout HEAD~1 detaches at the parent commit via revspec arithmetic', async () => {
  await seedCommittedRepo();
  await writeFile('/repo/a.txt', 'second\n');
  await git(['add', 'a.txt'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  await git(['commit', '-m', 'second'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  const { ctx, err } = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['checkout', 'HEAD~1'], ctx)).toBe(0);
  expect(err()).toContain('HEAD is now at');
  expect(err()).toContain('first');
});

it('checkout HEAD~1 -- <path> restores a file from the parent commit', async () => {
  await seedCommittedRepo();
  await writeFile('/repo/a.txt', 'second\n');
  await git(['add', 'a.txt'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  await git(['commit', '-m', 'second'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  const { ctx } = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['checkout', 'HEAD~1', '--', 'a.txt'], ctx)).toBe(0);
  const vfs = asyncVfs();
  if (!vfs) throw new Error('no async vfs');
  expect(await vfs.readFileText('/repo/a.txt')).toBe('hi\n');
});

it('checkout <invalid-source> -- validates the source even with no pathspecs', async () => {
  await seedCommittedRepo();

  const badParent = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['checkout', 'HEAD^1', '--'], badParent.ctx)).toBe(128);
  expect(badParent.err()).toContain('fatal: invalid reference: HEAD^1');

  const missing = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['checkout', 'NO_SUCH_REF', '--'], missing.ctx)).toBe(128);
  expect(missing.err()).toContain('fatal: invalid reference: NO_SUCH_REF');
});

it('checkout HEAD~1 <path> restores a file from the parent commit without requiring --', async () => {
  await seedCommittedRepo();
  await writeFile('/repo/a.txt', 'second\n');
  await git(['add', 'a.txt'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  await git(['commit', '-m', 'second'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  const { ctx } = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['checkout', 'HEAD~1', 'a.txt'], ctx)).toBe(0);
  const vfs = asyncVfs();
  if (!vfs) throw new Error('no async vfs');
  expect(await vfs.readFileText('/repo/a.txt')).toBe('hi\n');
});

it('checkout -b and switch -c reject extra positionals instead of ignoring them', async () => {
  await seedCommittedRepo();

  const checkoutCtx = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['checkout', '-b', 'feat', 'HEAD', 'extra'], checkoutCtx.ctx)).toBe(128);
  expect(checkoutCtx.err()).toContain('Not implemented: git.checkout.args');

  const switchCtx = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['switch', '-c', 'new', 'HEAD', 'extra'], switchCtx.ctx)).toBe(128);
  expect(switchCtx.err()).toContain('Not implemented: git.switch.args');

  const branches = makeCtx({ cwd: '/repo', env: ENV });
  await git(['branch'], branches.ctx);
  expect(branches.out()).not.toContain('feat');
  expect(branches.out()).not.toContain('new');
});

// I1 — bare `git checkout` (no positionals, no `-b`, no `--`) on a clean tree is a
// no-op: exit 0, both streams empty (matches real git 2.50.1).
it('bare git checkout on a clean repo → exit 0, empty stdout+stderr', async () => {
  await seedCommittedRepo();
  const { ctx, out, err } = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['checkout'], ctx)).toBe(0);
  expect(out()).toBe('');
  expect(err()).toBe('');
});

// I2 — a single arg that is BOTH a branch and a tracked file → switch to the
// BRANCH (ref precedence, real git 2.50.1: exit 0 "Switched to branch 'dev'").
it('checkout <name> that is both a branch and a tracked file → switches to the branch', async () => {
  await seedRepoDir();
  await writeFile('/repo/dev', 'one\n');
  await git(['init'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  await git(['add', 'dev'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  await git(['commit', '-m', 'first'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  // Create branch `dev` WITHOUT switching (a branch + a tracked file both named 'dev').
  await git(['checkout', '-b', 'dev'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  await git(['checkout', 'main'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  const { ctx, out, err } = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['checkout', 'dev'], ctx)).toBe(0);
  expect(out()).toBe('');
  expect(err()).toContain("Switched to branch 'dev'");
  // currentBranch is now 'dev'.
  const { makeGit, vfsToGitFs } = await import('@riftydev/git');
  const vfs = asyncVfs();
  if (!vfs) throw new Error('no async vfs');
  const g = makeGit({ fs: vfsToGitFs(vfs), dir: '/repo' });
  expect(await g.currentBranch()).toBe('dev');
});

// --- `git config` (bounded v1: get / set; full-dump flags are loud) ----------

it('config set then get round-trips (set: silent exit 0; get: value + exit 0)', async () => {
  await seedCommittedRepo();
  const set = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['config', 'user.email', 'ada@x'], set.ctx)).toBe(0);
  expect(set.out()).toBe('');
  const get = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['config', 'user.email'], get.ctx)).toBe(0);
  expect(get.out()).toBe('ada@x\n');
});

it('config of an unset key → exit 1, empty stdout (git behavior)', async () => {
  await seedCommittedRepo();
  const { ctx, out } = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['config', 'no.such'], ctx)).toBe(1);
  expect(out()).toBe('');
});

it('config --list (full dump) → exit 128, loud Not implemented ceiling', async () => {
  await seedCommittedRepo();
  const { ctx, err } = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['config', '--list'], ctx)).toBe(128);
  expect(err()).toContain('Not implemented: git.config');
});

it('config --get with value-pattern operands is a loud ceiling, not a silent pattern miss', async () => {
  await seedCommittedRepo();
  await git(['config', 'user.name', 'Ada'], makeCtx({ cwd: '/repo', env: ENV }).ctx);

  const matching = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['config', '--get', 'user.name', 'A.*'], matching.ctx)).toBe(128);
  expect(matching.out()).toBe('');
  expect(matching.err()).toContain('Not implemented: git.config.value-pattern');

  const nonMatching = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['config', '--get', 'user.name', 'extra'], nonMatching.ctx)).toBe(128);
  expect(nonMatching.out()).toBe('');
  expect(nonMatching.err()).toContain('Not implemented: git.config.value-pattern');
});

it('config set with value-pattern operands is a loud ceiling, not a joined value', async () => {
  await seedCommittedRepo();
  await git(['config', 'user.name', 'Ada'], makeCtx({ cwd: '/repo', env: ENV }).ctx);

  const set = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['config', 'user.name', 'Alice', 'Ada'], set.ctx)).toBe(128);
  expect(set.err()).toContain('Not implemented: git.config.value-pattern');

  const get = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['config', '--get', 'user.name'], get.ctx)).toBe(0);
  expect(get.out()).toBe('Ada\n');
});

// --- identity from config: `user.email` config drives a no-env commit's author

it('config user.email then commit (no env GIT_AUTHOR_EMAIL) authors as the configured email', async () => {
  await seedRepoDir();
  await writeFile('/repo/a.txt', 'hi\n');
  await git(['init'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  // Configure identity, NO author email in env on the commit call.
  await git(['config', 'user.email', 'ada@x'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  await git(['config', 'user.name', 'Ada'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  await git(['add', 'a.txt'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  // Env WITHOUT GIT_AUTHOR_* — author must fall back to git config.
  const commitEnv = { GIT_AUTHOR_DATE: '1600000000', GIT_COMMITTER_DATE: '1600000000' };
  expect(await git(['commit', '-m', 'm'], makeCtx({ cwd: '/repo', env: commitEnv }).ctx)).toBe(0);
  // Verify the recorded author via the facade (robust: read the commit object).
  const { makeGit, vfsToGitFs } = await import('@riftydev/git');
  const vfs = asyncVfs();
  if (!vfs) throw new Error('no async vfs');
  const g = makeGit({ fs: vfsToGitFs(vfs), dir: '/repo' });
  const head = (await g.log())[0];
  expect(head?.author.email).toBe('ada@x');
  expect(head?.author.name).toBe('Ada');
});

// --- `commit --amend` --------------------------------------------------------

it('commit --amend -m new replaces HEAD message; log stays ONE commit', async () => {
  await seedCommittedRepo(); // one commit, message 'first'
  await writeFile('/repo/a.txt', 'edited\n');
  await git(['add', 'a.txt'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  const amend = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['commit', '--amend', '-m', 'new'], amend.ctx)).toBe(0);
  const log = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['log', '--oneline'], log.ctx)).toBe(0);
  const lines = log
    .out()
    .split('\n')
    .filter((l) => l.length > 0);
  expect(lines).toHaveLength(1);
  expect(lines[0]).toMatch(/ new$/);
});

it('commit --amend (no -m) reuses the previous commit message; stays ONE commit', async () => {
  await seedCommittedRepo(); // one commit, message 'first'
  await writeFile('/repo/a.txt', 'edited\n');
  await git(['add', 'a.txt'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  expect(await git(['commit', '--amend'], makeCtx({ cwd: '/repo', env: ENV }).ctx)).toBe(0);
  const log = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['log', '--oneline'], log.ctx)).toBe(0);
  const lines = log
    .out()
    .split('\n')
    .filter((l) => l.length > 0);
  expect(lines).toHaveLength(1);
  expect(lines[0]).toMatch(/ first$/);
});

// M1 — `commit --amend` on an UNBORN HEAD (fresh repo, no commit) must surface
// real git's "fatal: You have nothing to amend." exit 128 — never leak the raw
// iso-git "Could not find HEAD" as a generic exit-1.
it('commit --amend on a repo with no commit → exit 128, "nothing to amend"', async () => {
  await seedRepoDir();
  await writeFile('/repo/a.txt', 'hi\n');
  await git(['init'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  await git(['add', 'a.txt'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  const { ctx, err } = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['commit', '--amend', '-m', 'x'], ctx)).toBe(128);
  expect(err()).toContain('nothing to amend');
  expect(err()).not.toContain('Could not find');
});

// --- `git switch` behavioral (error paths the fixtures don't cover) ----------

it('switch <full-sha> WITHOUT --detach → exit 128, "a branch is expected, got commit"', async () => {
  await seedCommittedRepo();
  const { makeGit, vfsToGitFs } = await import('@riftydev/git');
  const vfs = asyncVfs();
  if (!vfs) throw new Error('no async vfs');
  const g = makeGit({ fs: vfsToGitFs(vfs), dir: '/repo' });
  const sha = await g.resolveRef('HEAD');
  const { ctx, err } = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['switch', sha], ctx)).toBe(128);
  expect(err()).toContain(`a branch is expected, got commit '${sha}'`);
});

it('switch -c <existing> → exit 128, "a branch named ... already exists"', async () => {
  await seedCommittedRepo();
  await git(['switch', '-c', 'feat'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  await git(['switch', 'main'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  const { ctx, err } = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['switch', '-c', 'feat'], ctx)).toBe(128);
  expect(err()).toContain("a branch named 'feat' already exists");
});

it('switch - (previous-branch) → exit 128, Not implemented: git.switch.previous', async () => {
  await seedCommittedRepo();
  const { ctx, err } = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['switch', '-'], ctx)).toBe(128);
  expect(err()).toContain('Not implemented: git.switch.previous');
});

// --- `git restore --staged` behavioral --------------------------------------

it('restore --staged <file> after staging → exit 0; status shows it untracked not staged', async () => {
  await seedCommittedRepo(); // a.txt committed
  await writeFile('/repo/b.txt', 'bee\n');
  await git(['add', 'b.txt'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  const { ctx } = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['restore', '--staged', 'b.txt'], ctx)).toBe(0);
  const st = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['status', '--porcelain'], st.ctx)).toBe(0);
  expect(st.out()).toContain('?? b.txt');
  expect(st.out()).not.toContain('A  b.txt');
});

it('restore --source combined with --staged → exit 128, loud ceiling', async () => {
  await seedCommittedRepo();
  const { ctx, err } = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['restore', '--staged', '--source=HEAD', 'a.txt'], ctx)).toBe(128);
  expect(err()).toContain('Not implemented: git.restore.staged-source');
});

// I1 — `git restore` with NO pathspec is a bounded ceiling (real git: exit 128
// "you must specify path(s) to restore"). It must surface LOUD at 128 via the
// restore error renderer, never leak as the shell's generic `git: ` exit-1.
it('restore with no pathspec → exit 128, restore ceiling (not a leaked exit-1)', async () => {
  await seedCommittedRepo();
  const { ctx, err } = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['restore'], ctx)).toBe(128);
  expect(err()).toContain('git.restore.no-pathspec');
  expect(err()).not.toContain('git: ');
});

// --- repository guard (real git verifies a repo exists before any verb) -------

it('status in a NON-repo → exit 128, "not a git repository" (no silent false-success)', async () => {
  await seedRepoDir(); // /repo exists but NO `git init` → no .git
  const { ctx, out, err } = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['status', '--porcelain'], ctx)).toBe(128);
  expect(out()).toBe('');
  expect(err()).toContain('fatal: not a git repository (or any of the parent directories): .git');
});

it('log/diff/branch/add in a NON-repo all surface "not a git repository" (exit 128)', async () => {
  await seedRepoDir();
  for (const verb of [['log'], ['diff'], ['branch'], ['add', 'a.txt']]) {
    const { ctx, err } = makeCtx({ cwd: '/repo', env: ENV });
    expect(await git(verb, ctx)).toBe(128);
    expect(err()).toContain('not a git repository');
  }
});

it('status from a SUBDIRECTORY of a repo discovers the repo root', async () => {
  await seedCommittedRepo(); // .git lives at /repo
  const vfs = asyncVfs();
  if (!vfs) throw new Error('no async vfs');
  await vfs.mkdir('/repo/sub', { recursive: true });
  await writeFile('/repo/a.txt', 'changed\n');
  const { ctx, out, err } = makeCtx({ cwd: '/repo/sub', env: ENV });
  expect(await git(['status', '--porcelain'], ctx)).toBe(0);
  expect(out()).toContain(' M a.txt');
  expect(err()).toBe('');
});

// --- core-verb error fidelity (no leaked iso-git plumbing, correct exit 128) --

it('log on an unborn HEAD → exit 128, "does not have any commits yet" (not "Could not find")', async () => {
  await seedRepoDir();
  await git(['init'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  const { ctx, err } = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['log'], ctx)).toBe(128);
  expect(err()).toContain('does not have any commits yet');
  expect(err()).not.toContain('Could not find');
});

it('add of a missing pathspec → exit 128, "did not match any files" (not leaked plumbing)', async () => {
  await seedRepoDir();
  await git(['init'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  const { ctx, err } = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['add', 'missing.txt'], ctx)).toBe(128);
  expect(err()).toContain("pathspec 'missing.txt' did not match any files");
  expect(err()).not.toContain('Could not find');
});

// --- commit refuses to fabricate an empty commit (real git: exit 1) ----------

it('commit with a clean tree (nothing staged) → exit 1, "nothing to commit", NO new commit', async () => {
  await seedCommittedRepo(); // one commit, clean
  const { ctx, out } = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['commit', '-m', 'x'], ctx)).toBe(1);
  expect(out()).toContain('nothing to commit, working tree clean');
  // still exactly one commit — no empty commit fabricated.
  const log = makeCtx({ cwd: '/repo', env: ENV });
  await git(['log', '--oneline'], log.ctx);
  expect(
    log
      .out()
      .split('\n')
      .filter((l) => l.length > 0),
  ).toHaveLength(1);
});

it('commit with only untracked files (nothing staged) → exit 1, untracked-present message', async () => {
  await seedCommittedRepo();
  await writeFile('/repo/u.txt', 'untracked\n'); // never added
  const { ctx, out } = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['commit', '-m', 'x'], ctx)).toBe(1);
  expect(out()).toContain('nothing added to commit but untracked files present');
});

// --- commit -a / -am (stage tracked modifications, NOT untracked) ------------

it('commit -a -m stages tracked modifications (not untracked) and commits', async () => {
  await seedCommittedRepo(); // a.txt committed
  await writeFile('/repo/a.txt', 'edited\n'); // tracked, modified, NOT staged
  await writeFile('/repo/u.txt', 'untracked\n'); // untracked
  const { ctx } = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['commit', '-a', '-m', 'amsg'], ctx)).toBe(0);
  // two commits now; the untracked file is still untracked.
  const log = makeCtx({ cwd: '/repo', env: ENV });
  await git(['log', '--oneline'], log.ctx);
  expect(
    log
      .out()
      .split('\n')
      .filter((l) => l.length > 0),
  ).toHaveLength(2);
  const st = makeCtx({ cwd: '/repo', env: ENV });
  await git(['status', '--porcelain'], st.ctx);
  expect(st.out()).toContain('?? u.txt');
  expect(st.out()).not.toContain('a.txt');
});

it('commit -am <msg> (combined short flags) behaves as -a -m', async () => {
  await seedCommittedRepo();
  await writeFile('/repo/a.txt', 'edited2\n');
  const { ctx } = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['commit', '-am', 'combined'], ctx)).toBe(0);
  const log = makeCtx({ cwd: '/repo', env: ENV });
  await git(['log', '--oneline'], log.ctx);
  expect(log.out()).toMatch(/ combined$/m);
});

it('commit with an unknown flag → exit 128, loud (never silently ignored)', async () => {
  await seedCommittedRepo();
  await writeFile('/repo/a.txt', 'edited3\n');
  await git(['add', 'a.txt'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  const { ctx, err } = makeCtx({ cwd: '/repo', env: ENV });
  // `--bogus` is a genuinely-unknown flag (NOT a real git flag like -z/-q/-v).
  expect(await git(['commit', '--bogus', '-m', 'x'], ctx)).toBe(128);
  expect(err()).toContain('git.commit.bogus');
});

it('commit -m one -m two joins paragraphs (does not drop the first)', async () => {
  await seedCommittedRepo();
  await writeFile('/repo/a.txt', 'multi\n');
  await git(['add', 'a.txt'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  expect(
    await git(['commit', '-m', 'one', '-m', 'two'], makeCtx({ cwd: '/repo', env: ENV }).ctx),
  ).toBe(0);
  const { makeGit, vfsToGitFs } = await import('@riftydev/git');
  const vfs = asyncVfs();
  if (!vfs) throw new Error('no async vfs');
  const head = (await makeGit({ fs: vfsToGitFs(vfs), dir: '/repo' }).log())[0];
  // git stores the paragraph-joined message (with its canonical trailing newline).
  expect(head?.message).toBe('one\n\ntwo\n');
});

it("commit -m '' (empty message) → exit 1, git's abort message (not leaked plumbing)", async () => {
  await seedCommittedRepo();
  await writeFile('/repo/a.txt', 'edited4\n');
  await git(['add', 'a.txt'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  const { ctx, err } = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['commit', '-m', ''], ctx)).toBe(1);
  expect(err()).toContain('Aborting commit due to empty commit message.');
  expect(err()).not.toContain('parameter');
});

// --- switch to a name that is neither a branch nor any ref -------------------

it('switch <nonexistent> (not a branch, not a ref) → exit 128, "invalid reference"', async () => {
  await seedCommittedRepo();
  const { ctx, err } = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['switch', 'nope'], ctx)).toBe(128);
  expect(err()).toContain('fatal: invalid reference: nope');
});

// --- clone destination directory (real git: subdir from url basename / arg) --

it('cloneDestination: no arg → repo-basename subdir under cwd (strips .git)', () => {
  expect(cloneDestination('https://host/foo.git', undefined, '/work')).toEqual({
    display: 'foo',
    target: '/work/foo',
  });
  expect(cloneDestination('https://host/a/b/bar', undefined, '/work')).toEqual({
    display: 'bar',
    target: '/work/bar',
  });
});

it('cloneDestination: explicit relative + absolute target dir', () => {
  expect(cloneDestination('https://host/foo.git', 'mydir', '/work')).toEqual({
    display: 'mydir',
    target: '/work/mydir',
  });
  expect(cloneDestination('https://host/foo.git', '/abs/dir', '/work')).toEqual({
    display: '/abs/dir',
    target: '/abs/dir',
  });
});

// --- second-round fidelity hardening (adversarial audit) --------------------

it('a bare `mkdir .git` (empty/invalid repo) is NOT treated as a repo → "not a git repository"', async () => {
  await seedRepoDir();
  const vfs = asyncVfs();
  if (!vfs) throw new Error('no async vfs');
  await vfs.mkdir('/repo/.git', { recursive: true }); // .git dir, but no HEAD
  const { ctx, out, err } = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['status', '--porcelain'], ctx)).toBe(128);
  expect(out()).toBe('');
  expect(err()).toContain('not a git repository');
});

it('git commands from a repo subdirectory translate pathspecs relative to cwd', async () => {
  await seedRepoDir();
  const vfs = asyncVfs();
  if (!vfs) throw new Error('no async vfs');
  await vfs.mkdir('/repo/pkg', { recursive: true });
  await writeFile('/repo/root.txt', 'root\n');
  await writeFile('/repo/pkg/a.txt', 'one\n');
  await git(['init'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  await git(['add', '.'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  await git(['commit', '-m', 'first'], makeCtx({ cwd: '/repo', env: ENV }).ctx);

  await writeFile('/repo/root.txt', 'root changed\n');
  await writeFile('/repo/pkg/a.txt', 'two\n');

  const diff = makeCtx({ cwd: '/repo/pkg', env: ENV });
  expect(await git(['diff', '--', 'a.txt'], diff.ctx)).toBe(0);
  expect(diff.out()).toContain('diff --git a/pkg/a.txt b/pkg/a.txt');
  expect(diff.out()).toContain('+two');
  expect(diff.out()).not.toContain('root.txt');

  const addDot = makeCtx({ cwd: '/repo/pkg', env: ENV });
  expect(await git(['add', '.'], addDot.ctx)).toBe(0);
  const status = makeCtx({ cwd: '/repo/pkg', env: ENV });
  expect(await git(['status', '--porcelain'], status.ctx)).toBe(0);
  expect(status.out()).toContain('M  pkg/a.txt');
  expect(status.out()).toContain(' M root.txt');

  const reset = makeCtx({ cwd: '/repo/pkg', env: ENV });
  expect(await git(['reset', 'a.txt'], reset.ctx)).toBe(0);
  const afterReset = makeCtx({ cwd: '/repo/pkg', env: ENV });
  await git(['status', '--porcelain'], afterReset.ctx);
  expect(afterReset.out()).toContain(' M pkg/a.txt');
  expect(afterReset.out()).toContain(' M root.txt');
});

it('git rm/mv from a repo subdirectory mutate the cwd-relative tracked file', async () => {
  await seedRepoDir();
  const vfs = asyncVfs();
  if (!vfs) throw new Error('no async vfs');
  await vfs.mkdir('/repo/pkg', { recursive: true });
  await writeFile('/repo/pkg/a.txt', 'one\n');
  await git(['init'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  await git(['add', '.'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  await git(['commit', '-m', 'first'], makeCtx({ cwd: '/repo', env: ENV }).ctx);

  expect(await git(['mv', 'a.txt', 'b.txt'], makeCtx({ cwd: '/repo/pkg', env: ENV }).ctx)).toBe(0);
  expect(await vfs.exists('/repo/pkg/a.txt')).toBe(false);
  expect(await vfs.readFileText('/repo/pkg/b.txt')).toBe('one\n');

  expect(await git(['rm', 'b.txt'], makeCtx({ cwd: '/repo/pkg', env: ENV }).ctx)).toBe(0);
  expect(await vfs.exists('/repo/pkg/b.txt')).toBe(false);
  const status = makeCtx({ cwd: '/repo/pkg', env: ENV });
  await git(['status', '--porcelain'], status.ctx);
  expect(status.out()).toContain('D  pkg/a.txt');
});

it('git pathspecs from a subdirectory reject paths outside the repo before plumbing', async () => {
  await seedRepoDir();
  const vfs = asyncVfs();
  if (!vfs) throw new Error('no async vfs');
  await vfs.mkdir('/repo/pkg', { recursive: true });
  await writeFile('/repo/pkg/a.txt', 'one\n');
  await writeFile('/outside.txt', 'outside\n');
  await git(['init'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  await git(['add', '.'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  await git(['commit', '-m', 'first'], makeCtx({ cwd: '/repo', env: ENV }).ctx);

  const outside = makeCtx({ cwd: '/repo/pkg', env: ENV });
  expect(await git(['add', '-f', '../../outside.txt'], outside.ctx)).toBe(128);
  expect(outside.err()).toContain(
    "fatal: ../../outside.txt: '../../outside.txt' is outside repository",
  );
  const status = makeCtx({ cwd: '/repo', env: ENV });
  await git(['status', '--porcelain'], status.ctx);
  expect(status.out()).toBe('');
});

it('git add silently drops nothing: an unknown flag → exit 128 loud', async () => {
  await seedCommittedRepo();
  await writeFile('/repo/b.txt', 'b\n');
  const { ctx, err } = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['add', '--patch', 'b.txt'], ctx)).toBe(128);
  expect(err()).toContain('git.add.patch');
});

it('git add is ALL-OR-NOTHING: a missing pathspec stages nothing (good.txt stays untracked)', async () => {
  await seedCommittedRepo();
  await writeFile('/repo/good.txt', 'good\n');
  const { ctx, err } = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['add', 'good.txt', 'missing.txt'], ctx)).toBe(128);
  expect(err()).toContain("pathspec 'missing.txt' did not match any files");
  // good.txt must NOT have been staged (real git validates all first).
  const st = makeCtx({ cwd: '/repo', env: ENV });
  await git(['status', '--porcelain'], st.ctx);
  expect(st.out()).toContain('?? good.txt');
  expect(st.out()).not.toContain('A  good.txt');
});

it('git add with no pathspec → exit 0 with advisory (not exit 1)', async () => {
  await seedCommittedRepo();
  const { ctx, err } = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['add'], ctx)).toBe(0);
  expect(err()).toContain('Nothing specified, nothing added.');
});

it('git add of a .gitignore-ignored file → refused (exit 1) unless -f', async () => {
  await seedCommittedRepo();
  await writeFile('/repo/.gitignore', 'secret.txt\n');
  await git(['add', '.gitignore'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  await git(['commit', '-m', 'ignore'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  await writeFile('/repo/secret.txt', 'shh\n');
  const refused = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['add', 'secret.txt'], refused.ctx)).toBe(1);
  expect(refused.err()).toContain('ignored by one of your .gitignore files');
  // -f overrides.
  const forced = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['add', '-f', 'secret.txt'], forced.ctx)).toBe(0);
  const status = makeCtx({ cwd: '/repo', env: ENV });
  await git(['status', '--porcelain'], status.ctx);
  expect(status.out()).toContain('A  secret.txt');
});

it('git add directory pathspec stages tracked deletions inside the directory', async () => {
  await seedRepoDir();
  const vfs = asyncVfs();
  if (!vfs) throw new Error('no async vfs');
  await vfs.mkdir('/repo/dir', { recursive: true });
  await writeFile('/repo/dir/delete.txt', 'bye\n');
  await writeFile('/repo/dir/keep.txt', 'keep\n');
  await git(['init'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  await git(['add', 'dir'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  await git(['commit', '-m', 'first'], makeCtx({ cwd: '/repo', env: ENV }).ctx);

  await vfs.rm('/repo/dir/delete.txt');
  expect(await git(['add', 'dir'], makeCtx({ cwd: '/repo', env: ENV }).ctx)).toBe(0);

  const status = makeCtx({ cwd: '/repo', env: ENV });
  await git(['status', '--porcelain'], status.ctx);
  expect(status.out()).toContain('D  dir/delete.txt');
});

it('git add -u <pathspec> stages only tracked changes under that pathspec', async () => {
  await seedRepoDir();
  const vfs = asyncVfs();
  if (!vfs) throw new Error('no async vfs');
  await vfs.mkdir('/repo/dir', { recursive: true });
  await writeFile('/repo/dir/tracked.txt', 'one\n');
  await writeFile('/repo/dir/delete.txt', 'bye\n');
  await git(['init'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  await git(['add', 'dir'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  await git(['commit', '-m', 'first'], makeCtx({ cwd: '/repo', env: ENV }).ctx);

  await writeFile('/repo/dir/tracked.txt', 'two\n');
  await vfs.rm('/repo/dir/delete.txt');
  await writeFile('/repo/dir/untracked.txt', 'new\n');
  expect(await git(['add', '-u', 'dir'], makeCtx({ cwd: '/repo', env: ENV }).ctx)).toBe(0);

  const status = makeCtx({ cwd: '/repo', env: ENV });
  await git(['status', '--porcelain'], status.ctx);
  expect(status.out()).toContain('M  dir/tracked.txt');
  expect(status.out()).toContain('D  dir/delete.txt');
  expect(status.out()).toContain('?? dir/untracked.txt');
  expect(status.out()).not.toContain('A  dir/untracked.txt');
});

it('git add -u refuses untracked pathspecs even when -f is present', async () => {
  await seedCommittedRepo();
  await writeFile('/repo/.gitignore', '*.log\n');
  await git(['add', '.gitignore'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  await git(['commit', '-m', 'ignore'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  await writeFile('/repo/ignored.log', 'hidden\n');

  const add = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['add', '-u', '-f', 'ignored.log'], add.ctx)).toBe(128);
  expect(add.err()).toContain("pathspec 'ignored.log' did not match any file(s) known to git");

  const status = makeCtx({ cwd: '/repo', env: ENV });
  await git(['status', '--porcelain'], status.ctx);
  expect(status.out()).not.toContain('A  ignored.log');
});

it('git add -f . stages ignored files even when ordinary changes also match', async () => {
  await seedCommittedRepo();
  await writeFile('/repo/.gitignore', '*.log\n');
  await git(['add', '.gitignore'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  await git(['commit', '-m', 'ignore'], makeCtx({ cwd: '/repo', env: ENV }).ctx);

  await writeFile('/repo/a.txt', 'changed\n');
  await writeFile('/repo/ignored.log', 'hidden\n');
  expect(await git(['add', '-f', '.'], makeCtx({ cwd: '/repo', env: ENV }).ctx)).toBe(0);

  const status = makeCtx({ cwd: '/repo', env: ENV });
  await git(['status', '--porcelain'], status.ctx);
  expect(status.out()).toContain('M  a.txt');
  expect(status.out()).toContain('A  ignored.log');
});

it('git add -f <dir> stages ignored children alongside tracked directory changes', async () => {
  await seedRepoDir();
  const vfs = asyncVfs();
  if (!vfs) throw new Error('no async vfs');
  await vfs.mkdir('/repo/dir', { recursive: true });
  await writeFile('/repo/.gitignore', '*.log\n');
  await writeFile('/repo/dir/tracked.txt', 'one\n');
  await git(['init'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  await git(['add', '.gitignore', 'dir/tracked.txt'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  await git(['commit', '-m', 'first'], makeCtx({ cwd: '/repo', env: ENV }).ctx);

  await writeFile('/repo/dir/tracked.txt', 'two\n');
  await writeFile('/repo/dir/ignored.log', 'hidden\n');
  expect(await git(['add', '-f', 'dir'], makeCtx({ cwd: '/repo', env: ENV }).ctx)).toBe(0);

  const status = makeCtx({ cwd: '/repo', env: ENV });
  await git(['status', '--porcelain'], status.ctx);
  expect(status.out()).toContain('M  dir/tracked.txt');
  expect(status.out()).toContain('A  dir/ignored.log');
});

it('git add -A <pathspec> stages all changes under that pathspec only', async () => {
  await seedRepoDir();
  const vfs = asyncVfs();
  if (!vfs) throw new Error('no async vfs');
  await vfs.mkdir('/repo/dir', { recursive: true });
  await vfs.mkdir('/repo/other', { recursive: true });
  await writeFile('/repo/dir/delete.txt', 'bye\n');
  await writeFile('/repo/other/tracked.txt', 'one\n');
  await git(['init'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  await git(['add', '.'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  await git(['commit', '-m', 'first'], makeCtx({ cwd: '/repo', env: ENV }).ctx);

  await vfs.rm('/repo/dir/delete.txt');
  await writeFile('/repo/dir/new.txt', 'new\n');
  await writeFile('/repo/other/tracked.txt', 'two\n');
  expect(await git(['add', '-A', 'dir'], makeCtx({ cwd: '/repo', env: ENV }).ctx)).toBe(0);

  const status = makeCtx({ cwd: '/repo', env: ENV });
  await git(['status', '--porcelain'], status.ctx);
  expect(status.out()).toContain('D  dir/delete.txt');
  expect(status.out()).toContain('A  dir/new.txt');
  expect(status.out()).toContain(' M other/tracked.txt');
  expect(status.out()).not.toContain('M  other/tracked.txt');
});

it('status --porcelain and `add .` honor .gitignore (node_modules not surfaced/staged)', async () => {
  await seedCommittedRepo();
  await writeFile('/repo/.gitignore', 'node_modules/\n');
  await git(['add', '.gitignore'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  await git(['commit', '-m', 'ignore'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  const vfs = asyncVfs();
  if (!vfs) throw new Error('no async vfs');
  await vfs.mkdir('/repo/node_modules', { recursive: true });
  await writeFile('/repo/node_modules/dep.js', 'x\n');
  await writeFile('/repo/tracked.txt', 'x\n');

  const st = makeCtx({ cwd: '/repo', env: ENV });
  await git(['status', '--porcelain'], st.ctx);
  expect(st.out()).toContain('?? tracked.txt');
  expect(st.out()).not.toContain('node_modules');

  await git(['add', '.'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  const st2 = makeCtx({ cwd: '/repo', env: ENV });
  await git(['status', '--porcelain'], st2.ctx);
  expect(st2.out()).not.toContain('node_modules'); // never staged
});

it('git diff --cached and git diff HEAD render the requested delta, never the bare diff silently', async () => {
  await seedCommittedRepo();
  await writeFile('/repo/a.txt', 'staged\n');
  await git(['add', 'a.txt'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  await writeFile('/repo/a.txt', 'worktree\n');

  const staged = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['diff', '--cached'], staged.ctx)).toBe(0);
  expect(staged.out()).toContain('-hi');
  expect(staged.out()).toContain('+staged');
  expect(staged.out()).not.toContain('+worktree');

  const head = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['diff', 'HEAD'], head.ctx)).toBe(0);
  expect(head.out()).toContain('-hi');
  expect(head.out()).toContain('+worktree');
});

it('git diff HEAD~1 HEAD renders a two-ref diff using revspec arithmetic', async () => {
  await seedCommittedRepo();
  await writeFile('/repo/a.txt', 'second\n');
  await git(['add', 'a.txt'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  await git(['commit', '-m', 'second'], makeCtx({ cwd: '/repo', env: ENV }).ctx);

  const { ctx, out } = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['diff', 'HEAD~1', 'HEAD'], ctx)).toBe(0);
  expect(out()).toContain('-hi');
  expect(out()).toContain('+second');
});

it('git diff HEAD^0 treats ^0 as the current commit, not a pathspec', async () => {
  await seedCommittedRepo();
  await writeFile('/repo/a.txt', 'changed\n');

  const { ctx, out, err } = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['diff', 'HEAD^0'], ctx)).toBe(0);
  expect(out()).toContain('diff --git a/a.txt b/a.txt');
  expect(out()).toContain('-hi');
  expect(out()).toContain('+changed');
  expect(err()).toBe('');
});

it('invalid parent revspecs do not degrade into empty pathspec diffs', async () => {
  await seedCommittedRepo();
  await writeFile('/repo/a.txt', 'changed\n');

  const { ctx, out, err } = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['diff', 'HEAD^1'], ctx)).toBe(128);
  expect(out()).toBe('');
  expect(err()).toContain("fatal: ambiguous argument 'HEAD^1'");
});

it('diff/log missing operands without -- are fatal ambiguous, not empty pathspec success', async () => {
  await seedCommittedRepo();
  await writeFile('/repo/a.txt', 'changed\n');
  await writeFile('/repo/untracked.txt', 'u\n');

  const diffMissing = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['diff', 'missing'], diffMissing.ctx)).toBe(128);
  expect(diffMissing.out()).toBe('');
  expect(diffMissing.err()).toContain("fatal: ambiguous argument 'missing'");

  const diffRevLike = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['diff', 'NO_SUCH_REF^1'], diffRevLike.ctx)).toBe(128);
  expect(diffRevLike.err()).toContain("fatal: ambiguous argument 'NO_SUCH_REF^1'");

  const logMissing = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['log', 'missing'], logMissing.ctx)).toBe(128);
  expect(logMissing.out()).toBe('');
  expect(logMissing.err()).toContain("fatal: ambiguous argument 'missing'");

  const logRevLike = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['log', 'NO_SUCH_REF^1'], logRevLike.ctx)).toBe(128);
  expect(logRevLike.err()).toContain("fatal: ambiguous argument 'NO_SUCH_REF^1'");

  const diffDashDash = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['diff', '--', 'missing'], diffDashDash.ctx)).toBe(0);
  expect(diffDashDash.out()).toBe('');
  expect(diffDashDash.err()).toBe('');

  const diffUntracked = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['diff', 'untracked.txt'], diffUntracked.ctx)).toBe(0);
  expect(diffUntracked.out()).toBe('');
  expect(diffUntracked.err()).toBe('');
});

it('diff/log refuse a token that is both a revision and a tracked filename', async () => {
  await seedAmbiguousMainFileRepo();

  const diff = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['diff', 'main'], diff.ctx)).toBe(128);
  expect(diff.out()).toBe('');
  expect(diff.err()).toContain("fatal: ambiguous argument 'main': both revision and filename");
  expect(diff.err()).toContain("Use '--' to separate paths from revisions");

  const log = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['log', 'main'], log.ctx)).toBe(128);
  expect(log.out()).toBe('');
  expect(log.err()).toContain("fatal: ambiguous argument 'main': both revision and filename");
  expect(log.err()).toContain("Use '--' to separate paths from revisions");

  const diffLater = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['diff', 'HEAD', 'main'], diffLater.ctx)).toBe(128);
  expect(diffLater.out()).toBe('');
  expect(diffLater.err()).toContain("fatal: ambiguous argument 'main': both revision and filename");

  const logLater = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['log', 'HEAD', 'main'], logLater.ctx)).toBe(128);
  expect(logLater.out()).toBe('');
  expect(logLater.err()).toContain("fatal: ambiguous argument 'main': both revision and filename");
});

it('log refuses a token that is both a revision and an untracked filename', async () => {
  await seedCommittedRepo();
  await git(['checkout', '-b', 'topic'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  await git(['checkout', 'main'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  await writeFile('/repo/topic', 'untracked\n');

  const log = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['log', 'topic'], log.ctx)).toBe(128);
  expect(log.out()).toBe('');
  expect(log.err()).toContain("fatal: ambiguous argument 'topic': both revision and filename");
  expect(log.err()).toContain("Use '--' to separate paths from revisions");

  const diffLater = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['diff', 'HEAD', 'topic'], diffLater.ctx)).toBe(128);
  expect(diffLater.out()).toBe('');
  expect(diffLater.err()).toContain(
    "fatal: ambiguous argument 'topic': both revision and filename",
  );

  const logLater = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['log', 'HEAD', 'topic'], logLater.ctx)).toBe(128);
  expect(logLater.out()).toBe('');
  expect(logLater.err()).toContain("fatal: ambiguous argument 'topic': both revision and filename");
});

it('invalid explicit tree-ish revspecs render fatal instead of escaping the git command', async () => {
  await seedCommittedRepo();
  await writeFile('/repo/a.txt', 'changed\n');

  const diff = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['diff', 'HEAD^1', '--', 'a.txt'], diff.ctx)).toBe(128);
  expect(diff.out()).toBe('');
  expect(diff.err()).toContain('fatal: revision HEAD^1 has no parent 1');

  const checkout = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['checkout', 'HEAD^1', '--', 'a.txt'], checkout.ctx)).toBe(128);
  expect(checkout.err()).toContain('fatal: revision HEAD^1 has no parent 1');

  const restore = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['restore', '--source=HEAD^1', 'a.txt'], restore.ctx)).toBe(128);
  expect(restore.err()).toContain('fatal: revision HEAD^1 has no parent 1');
});

it('git diff HEAD <path> treats the trailing token as a pathspec without requiring --', async () => {
  await seedCommittedRepo();
  await writeFile('/repo/a.txt', 'changed a\n');
  await writeFile('/repo/b.txt', 'base b\n');
  await git(['add', 'b.txt'], makeCtx({ cwd: '/repo', env: ENV }).ctx);

  const { ctx, out } = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['diff', 'HEAD', 'a.txt'], ctx)).toBe(0);
  expect(out()).toContain('diff --git a/a.txt b/a.txt');
  expect(out()).toContain('+changed a');
  expect(out()).not.toContain('b.txt');
});

it('git diff -- <missing> exits cleanly with no output', async () => {
  await seedCommittedRepo();
  const { ctx, out, err } = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['diff', '--', 'missing.txt'], ctx)).toBe(0);
  expect(out()).toBe('');
  expect(err()).toBe('');
});

it('git diff --cached before the first commit compares the index with the empty tree', async () => {
  await seedRepoDir();
  await git(['init'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  await writeFile('/repo/a.txt', 'new\n');
  await git(['add', 'a.txt'], makeCtx({ cwd: '/repo', env: ENV }).ctx);

  const { ctx, out } = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['diff', '--cached'], ctx)).toBe(0);
  expect(out()).toContain('diff --git a/a.txt b/a.txt');
  expect(out()).toContain('+new');
});

it('git diff supports name-only, name-status, and stat summaries', async () => {
  await seedCommittedRepo();
  await writeFile('/repo/a.txt', 'changed\n');
  await writeFile('/repo/b.txt', 'new\n');
  await git(['add', 'b.txt'], makeCtx({ cwd: '/repo', env: ENV }).ctx);

  const nameOnly = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['diff', 'HEAD', '--name-only'], nameOnly.ctx)).toBe(0);
  expect(nameOnly.out()).toBe('a.txt\nb.txt\n');

  const nameStatus = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['diff', 'HEAD', '--name-status'], nameStatus.ctx)).toBe(0);
  expect(nameStatus.out()).toContain('M\ta.txt');
  expect(nameStatus.out()).toContain('A\tb.txt');

  const stat = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['diff', 'HEAD', '--stat'], stat.ctx)).toBe(0);
  expect(stat.out()).toContain('a.txt |');
  expect(stat.out()).toContain('b.txt |');
  expect(stat.out()).toContain('2 files changed');
});

it('reset --soft and reset --mixed HEAD~1 move HEAD with git index/worktree semantics', async () => {
  await seedCommittedRepo();
  await writeFile('/repo/a.txt', 'second\n');
  await git(['add', 'a.txt'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  await git(['commit', '-m', 'second'], makeCtx({ cwd: '/repo', env: ENV }).ctx);

  const soft = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['reset', '--soft', 'HEAD~1'], soft.ctx)).toBe(0);
  const afterSoft = makeCtx({ cwd: '/repo', env: ENV });
  await git(['status', '--porcelain'], afterSoft.ctx);
  expect(afterSoft.out()).toContain('M  a.txt');

  await git(['commit', '-m', 'second-again'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  const mixed = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['reset', '--mixed', 'HEAD~1'], mixed.ctx)).toBe(0);
  expect(mixed.out()).toBe('Unstaged changes after reset:\nM\ta.txt\n');
  const afterMixed = makeCtx({ cwd: '/repo', env: ENV });
  await git(['status', '--porcelain'], afterMixed.ctx);
  expect(afterMixed.out()).toContain(' M a.txt');
});

it('reset --hard HEAD^0 accepts ^0 and renders the real git HEAD summary', async () => {
  await seedCommittedRepo();
  await writeFile('/repo/a.txt', 'dirty\n');

  const reset = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['reset', '--hard', 'HEAD^0'], reset.ctx)).toBe(0);
  expect(reset.out()).toMatch(/^HEAD is now at [0-9a-f]{7} first\n$/);
  expect(reset.err()).toBe('');

  const vfs = asyncVfs();
  if (!vfs) throw new Error('no async vfs');
  expect(await vfs.readFileText('/repo/a.txt')).toBe('hi\n');
});

it('reset refuses a token that is both a revision and a filename without unstaging', async () => {
  await seedAmbiguousMainFileRepo();
  await writeFile('/repo/a.txt', 'staged\n');
  await git(['add', 'a.txt'], makeCtx({ cwd: '/repo', env: ENV }).ctx);

  const reset = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['reset', 'main'], reset.ctx)).toBe(128);
  expect(reset.out()).toBe('');
  expect(reset.err()).toContain("fatal: ambiguous argument 'main': both revision and filename");
  expect(reset.err()).toContain("Use '--' to separate paths from revisions");

  const status = makeCtx({ cwd: '/repo', env: ENV });
  await git(['status', '--porcelain'], status.ctx);
  expect(status.out()).toContain('M  a.txt');
});

it('reset HEAD^0 -- <path> unstages like HEAD while invalid explicit sources are fatal', async () => {
  await seedCommittedRepo();
  await writeFile('/repo/a.txt', 'edited\n');
  await git(['add', 'a.txt'], makeCtx({ cwd: '/repo', env: ENV }).ctx);

  const resetHeadZero = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['reset', 'HEAD^0', '--', 'a.txt'], resetHeadZero.ctx)).toBe(0);
  const afterReset = makeCtx({ cwd: '/repo', env: ENV });
  await git(['status', '--porcelain'], afterReset.ctx);
  expect(afterReset.out()).toContain(' M a.txt');

  await git(['add', 'a.txt'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  const badSource = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['reset', 'HEAD^1', '--', 'a.txt'], badSource.ctx)).toBe(128);
  expect(badSource.err()).toContain('fatal: revision HEAD^1 has no parent 1');
});

it('reset <path> unstages a staged path without touching the worktree', async () => {
  await seedCommittedRepo();
  await writeFile('/repo/a.txt', 'edited\n');
  await git(['add', 'a.txt'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  const { ctx } = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['reset', 'a.txt'], ctx)).toBe(0);
  const st = makeCtx({ cwd: '/repo', env: ENV });
  await git(['status', '--porcelain'], st.ctx);
  expect(st.out()).toContain(' M a.txt');
});

it('reset HEAD -- <path> unstages while mode flags with paths are loud ceilings', async () => {
  await seedCommittedRepo();
  await writeFile('/repo/a.txt', 'edited\n');
  await git(['add', 'a.txt'], makeCtx({ cwd: '/repo', env: ENV }).ctx);

  const hard = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['reset', '--hard', 'a.txt'], hard.ctx)).toBe(128);
  expect(hard.err()).toContain('Not implemented: git.reset.mode-with-pathspec');

  const soft = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['reset', '--soft', 'a.txt'], soft.ctx)).toBe(128);
  expect(soft.err()).toContain('Not implemented: git.reset.mode-with-pathspec');

  const mixed = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['reset', 'HEAD', '--', 'a.txt'], mixed.ctx)).toBe(0);
  const st = makeCtx({ cwd: '/repo', env: ENV });
  await git(['status', '--porcelain'], st.ctx);
  expect(st.out()).toContain(' M a.txt');
});

it('reset reflog revspecs render as loud ceilings instead of escaping the command', async () => {
  await seedCommittedRepo();
  const reset = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['reset', 'HEAD@{1}'], reset.ctx)).toBe(128);
  expect(reset.err()).toContain('Not implemented: git.revspec.reflog');
});

it('reset --hard HEAD~1 removes tracked paths that do not exist in the target tree', async () => {
  await seedCommittedRepo();
  await writeFile('/repo/b.txt', 'second file\n');
  await git(['add', 'b.txt'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  await git(['commit', '-m', 'add b'], makeCtx({ cwd: '/repo', env: ENV }).ctx);

  expect(await git(['reset', '--hard', 'HEAD~1'], makeCtx({ cwd: '/repo', env: ENV }).ctx)).toBe(0);
  const vfs = asyncVfs();
  if (!vfs) throw new Error('no async vfs');
  expect(await vfs.exists('/repo/b.txt')).toBe(false);
  const st = makeCtx({ cwd: '/repo', env: ENV });
  await git(['status', '--porcelain'], st.ctx);
  expect(st.out()).toBe('');
});

it('show HEAD:path prints a blob and show HEAD prints the commit summary plus patch', async () => {
  await seedCommittedRepo();
  const blob = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['show', 'HEAD:a.txt'], blob.ctx)).toBe(0);
  expect(blob.out()).toBe('hi\n');

  const commit = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['show', 'HEAD'], commit.ctx)).toBe(0);
  expect(commit.out()).toContain('commit ');
  expect(commit.out()).toContain('Author: rifty <rifty@localhost>');
  expect(commit.out()).toContain('first');
  expect(commit.out()).toContain('diff --git a/a.txt b/a.txt');
  expect(commit.out()).toContain('+hi');
});

it('show HEAD^0 resolves the current commit instead of treating ^0 as a parent', async () => {
  await seedCommittedRepo();

  const show = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['show', 'HEAD^0'], show.ctx)).toBe(0);
  expect(show.out()).toContain('commit ');
  expect(show.out()).toContain('first');
  expect(show.err()).toBe('');
});

it('tag list/create/delete supports lightweight and annotated tags', async () => {
  await seedCommittedRepo();
  expect(await git(['tag', 'v1'], makeCtx({ cwd: '/repo', env: ENV }).ctx)).toBe(0);
  expect(
    await git(['tag', '-a', 'v2', '-m', 'release'], makeCtx({ cwd: '/repo', env: ENV }).ctx),
  ).toBe(0);

  const list = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['tag'], list.ctx)).toBe(0);
  expect(list.out()).toBe('v1\nv2\n');

  const del = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['tag', '-d', 'v1'], del.ctx)).toBe(0);
  expect(del.out()).toMatch(/^Deleted tag 'v1' \(was [0-9a-f]{7}\)\n$/);
});

it('tag -m creates an annotated tag and unsupported editor/extra operands are loud', async () => {
  await seedCommittedRepo();
  expect(await git(['tag', '-m', 'release', 'v1'], makeCtx({ cwd: '/repo', env: ENV }).ctx)).toBe(
    0,
  );
  const show = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['show', 'v1'], show.ctx)).toBe(0);
  expect(show.out()).toContain('tag v1');
  expect(show.out()).toContain('release');

  const noMessage = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['tag', '-a', 'v2'], noMessage.ctx)).toBe(128);
  expect(noMessage.err()).toContain('Not implemented: git.tag.editor');

  const extra = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['tag', 'v3', 'HEAD', 'extra'], extra.ctx)).toBe(128);
  expect(extra.err()).toContain('Not implemented: git.tag.args');
  const list = makeCtx({ cwd: '/repo', env: ENV });
  await git(['tag'], list.ctx);
  expect(list.out()).not.toContain('v3');
});

it('remote add/list -v/remove round-trips through repo config', async () => {
  await seedCommittedRepo();
  expect(
    await git(
      ['remote', 'add', 'origin', 'https://host/repo.git'],
      makeCtx({ cwd: '/repo', env: ENV }).ctx,
    ),
  ).toBe(0);
  const verbose = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['remote', '-v'], verbose.ctx)).toBe(0);
  expect(verbose.out()).toContain('origin\thttps://host/repo.git (fetch)');
  expect(verbose.out()).toContain('origin\thttps://host/repo.git (push)');

  expect(await git(['remote', 'remove', 'origin'], makeCtx({ cwd: '/repo', env: ENV }).ctx)).toBe(
    0,
  );
  const list = makeCtx({ cwd: '/repo', env: ENV });
  await git(['remote'], list.ctx);
  expect(list.out()).toBe('');
});

it('remote add/remove reject unsupported flags and extra operands before mutating config', async () => {
  await seedCommittedRepo();

  const addExtra = makeCtx({ cwd: '/repo', env: ENV });
  expect(
    await git(['remote', 'add', 'origin', 'https://host/repo.git', 'extra'], addExtra.ctx),
  ).toBe(128);
  expect(addExtra.err()).toContain('Not implemented: git.remote.add.args');

  const addFlag = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['remote', 'add', '-f', 'origin', 'https://host/repo.git'], addFlag.ctx)).toBe(
    128,
  );
  expect(addFlag.err()).toContain('Not implemented: git.remote.add.f');

  const list = makeCtx({ cwd: '/repo', env: ENV });
  await git(['remote'], list.ctx);
  expect(list.out()).toBe('');

  await git(
    ['remote', 'add', 'origin', 'https://host/repo.git'],
    makeCtx({ cwd: '/repo', env: ENV }).ctx,
  );

  const removeExtra = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['remote', 'remove', 'origin', 'extra'], removeExtra.ctx)).toBe(128);
  expect(removeExtra.err()).toContain('Not implemented: git.remote.remove.args');

  const stillThere = makeCtx({ cwd: '/repo', env: ENV });
  await git(['remote'], stillThere.ctx);
  expect(stillThere.out()).toBe('origin\n');
});

it('log -n, --format, explicit ref, and a..b range are honored', async () => {
  await seedCommittedRepo();
  await writeFile('/repo/a.txt', 'second\n');
  await git(['add', 'a.txt'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  await git(['commit', '-m', 'second'], makeCtx({ cwd: '/repo', env: ENV }).ctx);

  const one = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['log', '--oneline', '-n', '1'], one.ctx)).toBe(0);
  expect(one.out().trim()).toMatch(/ second$/);

  const format = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['log', '--format=%H %s', 'HEAD~1..HEAD'], format.ctx)).toBe(0);
  expect(format.out()).toMatch(/^[0-9a-f]{40} second\n$/);
});

it('git log <path> without -- filters by path instead of treating the path as an unborn ref', async () => {
  await seedCommittedRepo();
  const log = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['log', '--oneline', 'a.txt'], log.ctx)).toBe(0);
  expect(log.out()).toMatch(/ first$/m);
  expect(log.err()).toBe('');
});

it('log -n 0 prints no commits and unknown --format placeholders are loud ceilings', async () => {
  await seedCommittedRepo();
  await writeFile('/repo/a.txt', 'second\n');
  await git(['add', 'a.txt'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  await git(['commit', '-m', 'second'], makeCtx({ cwd: '/repo', env: ENV }).ctx);

  const zero = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['log', '--oneline', '-n', '0'], zero.ctx)).toBe(0);
  expect(zero.out()).toBe('');

  const format = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['log', '--format=%ad'], format.ctx)).toBe(128);
  expect(format.err()).toContain('Not implemented: git.log.format.ad');
});

it('log HEAD^0 treats ^0 as the current commit and invalid max-count is fatal', async () => {
  await seedCommittedRepo();

  const headZero = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['log', '--oneline', 'HEAD^0'], headZero.ctx)).toBe(0);
  expect(headZero.out()).toMatch(/^[0-9a-f]{7} first\n$/);
  expect(headZero.err()).toBe('');

  const badDepth = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['log', '--max-count=bogus'], badDepth.ctx)).toBe(128);
  expect(badDepth.out()).toBe('');
  expect(badDepth.err()).toContain("fatal: 'bogus': not an integer");
});

it('log -- <path> filters history by path instead of treating -- as an unsupported flag', async () => {
  await seedCommittedRepo();
  await writeFile('/repo/b.txt', 'b\n');
  await git(['add', 'b.txt'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  await git(['commit', '-m', 'second-b-only'], makeCtx({ cwd: '/repo', env: ENV }).ctx);

  const { ctx, out } = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['log', '--oneline', '--', 'a.txt'], ctx)).toBe(0);
  expect(out()).toContain('first');
  expect(out()).not.toContain('second-b-only');
});

it('git rm and git mv update both worktree and index', async () => {
  await seedCommittedRepo();
  expect(await git(['mv', 'a.txt', 'b.txt'], makeCtx({ cwd: '/repo', env: ENV }).ctx)).toBe(0);
  const moved = makeCtx({ cwd: '/repo', env: ENV });
  await git(['status', '--porcelain'], moved.ctx);
  expect(moved.out()).toContain('D  a.txt');
  expect(moved.out()).toContain('A  b.txt');

  const rm = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['rm', 'b.txt'], rm.ctx)).toBe(0);
  expect(rm.out()).toBe("rm 'b.txt'\n");
  const removed = makeCtx({ cwd: '/repo', env: ENV });
  await git(['status', '--porcelain'], removed.ctx);
  expect(removed.out()).toContain('D  a.txt');
  expect(removed.out()).not.toContain('b.txt');
});

it('git rm refuses to remove a modified tracked file unless forced', async () => {
  await seedCommittedRepo();
  await writeFile('/repo/a.txt', 'dirty\n');
  const { ctx, err } = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['rm', 'a.txt'], ctx)).toBe(1);
  expect(err()).toContain('local modifications');
  const vfs = asyncVfs();
  if (!vfs) throw new Error('no async vfs');
  expect(await vfs.readFileText('/repo/a.txt')).toBe('dirty\n');
});

it('git rm -r is not force, validates all pathspecs before mutation, and requires -r for dirs', async () => {
  await seedRepoDir();
  await git(['init'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  const vfs = asyncVfs();
  if (!vfs) throw new Error('no async vfs');
  await vfs.mkdir('/repo/dirty-dir', { recursive: true });
  await vfs.mkdir('/repo/clean-dir', { recursive: true });
  await writeFile('/repo/dirty-dir/a.txt', 'clean\n');
  await writeFile('/repo/clean-dir/c.txt', 'clean\n');
  await writeFile('/repo/b.txt', 'clean\n');
  await git(['add', '.'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  await git(['commit', '-m', 'files'], makeCtx({ cwd: '/repo', env: ENV }).ctx);

  await writeFile('/repo/dirty-dir/a.txt', 'dirty\n');
  const recursive = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['rm', '-r', 'dirty-dir'], recursive.ctx)).toBe(1);
  expect(recursive.err()).toContain('local modifications');
  expect(await vfs.readFileText('/repo/dirty-dir/a.txt')).toBe('dirty\n');

  const noRecursive = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['rm', 'clean-dir'], noRecursive.ctx)).toBe(128);
  expect(noRecursive.err()).toContain("not removing 'clean-dir' recursively without -r");
  expect(await vfs.exists('/repo/clean-dir/c.txt')).toBe(true);

  const allOrNothing = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['rm', '-f', 'b.txt', 'missing.txt'], allOrNothing.ctx)).toBe(128);
  expect(allOrNothing.err()).toContain("pathspec 'missing.txt' did not match");
  expect(await vfs.exists('/repo/b.txt')).toBe(true);
});

it('git mv refuses to overwrite an existing destination unless forced', async () => {
  await seedCommittedRepo();
  await writeFile('/repo/b.txt', 'keep me\n');
  const { ctx, err } = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['mv', 'a.txt', 'b.txt'], ctx)).toBe(128);
  expect(err()).toContain('destination exists');
  const vfs = asyncVfs();
  if (!vfs) throw new Error('no async vfs');
  expect(await vfs.readFileText('/repo/b.txt')).toBe('keep me\n');
});

it('git mv refuses untracked sources before mutation and moves files into existing dirs', async () => {
  await seedCommittedRepo();
  const vfs = asyncVfs();
  if (!vfs) throw new Error('no async vfs');
  await writeFile('/repo/untracked.txt', 'loose\n');

  const untracked = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['mv', 'untracked.txt', 'moved.txt'], untracked.ctx)).toBe(128);
  expect(untracked.err()).toContain('not under version control');
  expect(await vfs.exists('/repo/untracked.txt')).toBe(true);
  expect(await vfs.exists('/repo/moved.txt')).toBe(false);

  await vfs.mkdir('/repo/dir', { recursive: true });
  const intoDir = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['mv', 'a.txt', 'dir'], intoDir.ctx)).toBe(0);
  expect(await vfs.exists('/repo/a.txt')).toBe(false);
  expect(await vfs.readFileText('/repo/dir/a.txt')).toBe('hi\n');

  const st = makeCtx({ cwd: '/repo', env: ENV });
  await git(['status', '--porcelain'], st.ctx);
  expect(st.out()).toContain('D  a.txt');
  expect(st.out()).toContain('A  dir/a.txt');
});

it('merge fast-forwards the current branch to another local branch', async () => {
  await seedCommittedRepo();
  await git(['checkout', '-b', 'feature'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  await writeFile('/repo/a.txt', 'feature\n');
  await git(['add', 'a.txt'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  await git(['commit', '-m', 'feature'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  await git(['checkout', 'main'], makeCtx({ cwd: '/repo', env: ENV }).ctx);

  const merge = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['merge', 'feature'], merge.ctx)).toBe(0);
  expect(merge.out()).toContain('Fast-forward');
  const vfs = asyncVfs();
  if (!vfs) throw new Error('no async vfs');
  expect(await vfs.readFileText('/repo/a.txt')).toBe('feature\n');
});

it('show on a merge commit renders Merge header and no patch by default', async () => {
  await seedCommittedRepo();
  await git(['checkout', '-b', 'feature'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  await writeFile('/repo/feature.txt', 'feature\n');
  await git(['add', 'feature.txt'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  await git(['commit', '-m', 'feature'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  await git(['checkout', 'main'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  await writeFile('/repo/main.txt', 'main\n');
  await git(['add', 'main.txt'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  await git(['commit', '-m', 'main'], makeCtx({ cwd: '/repo', env: ENV }).ctx);

  expect(await git(['merge', 'feature'], makeCtx({ cwd: '/repo', env: ENV }).ctx)).toBe(0);
  const { makeGit, vfsToGitFs } = await import('@riftydev/git');
  const vfs = asyncVfs();
  if (!vfs) throw new Error('no async vfs');
  const head = await makeGit({ fs: vfsToGitFs(vfs), dir: '/repo' }).show('HEAD');
  expect(head.type).toBe('commit');
  if (head.type !== 'commit') throw new Error('expected commit');
  expect(head.commit.parents).toHaveLength(2);
  expect(await vfs.readFileText('/repo/main.txt')).toBe('main\n');
  expect(await vfs.readFileText('/repo/feature.txt')).toBe('feature\n');

  const show = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['show', 'HEAD'], show.ctx)).toBe(0);
  expect(show.out()).toContain('Merge: ');
  expect(show.out()).not.toContain('diff --git');
});

it('merge unsupported flags and extra operands are loud ceilings before mutation', async () => {
  await seedCommittedRepo();
  await git(['checkout', '-b', 'feature'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  await writeFile('/repo/a.txt', 'feature\n');
  await git(['add', 'a.txt'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  await git(['commit', '-m', 'feature'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  await git(['checkout', 'main'], makeCtx({ cwd: '/repo', env: ENV }).ctx);

  const flag = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['merge', 'feature', '--no-ff'], flag.ctx)).toBe(128);
  expect(flag.err()).toContain('Not implemented: git.merge.no-ff');

  const extra = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['merge', 'feature', 'main'], extra.ctx)).toBe(128);
  expect(extra.err()).toContain('Not implemented: git.merge.args');

  const vfs = asyncVfs();
  if (!vfs) throw new Error('no async vfs');
  expect(await vfs.readFileText('/repo/a.txt')).toBe('hi\n');
});

it('cherry-pick applies a local commit onto the current branch', async () => {
  await seedCommittedRepo();
  await git(['checkout', '-b', 'feature'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  await writeFile('/repo/a.txt', 'picked\n');
  await git(['add', 'a.txt'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  await git(['commit', '-m', 'picked'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  const { makeGit, vfsToGitFs } = await import('@riftydev/git');
  const vfs = asyncVfs();
  if (!vfs) throw new Error('no async vfs');
  const picked = await makeGit({ fs: vfsToGitFs(vfs), dir: '/repo' }).resolveRef('feature');
  await git(['checkout', 'main'], makeCtx({ cwd: '/repo', env: ENV }).ctx);

  const pick = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['cherry-pick', picked], pick.ctx)).toBe(0);
  expect(pick.out()).toMatch(/^\[main [0-9a-f]{7}\] picked\n/);
  expect(await vfs.readFileText('/repo/a.txt')).toBe('picked\n');
});

it('cherry-pick multiple commits is a loud ceiling before mutation', async () => {
  await seedCommittedRepo();
  await git(['checkout', '-b', 'feature'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  await writeFile('/repo/a.txt', 'picked-one\n');
  await git(['add', 'a.txt'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  await git(['commit', '-m', 'picked-one'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  const { makeGit, vfsToGitFs } = await import('@riftydev/git');
  const vfs = asyncVfs();
  if (!vfs) throw new Error('no async vfs');
  const client = makeGit({ fs: vfsToGitFs(vfs), dir: '/repo' });
  const first = await client.resolveRef('feature');
  await writeFile('/repo/a.txt', 'picked-two\n');
  await git(['add', 'a.txt'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  await git(['commit', '-m', 'picked-two'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  const second = await client.resolveRef('feature');
  await git(['checkout', 'main'], makeCtx({ cwd: '/repo', env: ENV }).ctx);

  const multi = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['cherry-pick', first, second], multi.ctx)).toBe(128);
  expect(multi.err()).toContain('Not implemented: git.cherry-pick.multiple-commits');
  expect(await vfs.readFileText('/repo/a.txt')).toBe('hi\n');
});

it('revert cleanly inverts a single non-merge commit and records a revert commit', async () => {
  await seedCommittedRepo();
  await writeFile('/repo/a.txt', 'second\n');
  await git(['add', 'a.txt'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  await git(['commit', '-m', 'second'], makeCtx({ cwd: '/repo', env: ENV }).ctx);

  const revert = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['revert', 'HEAD'], revert.ctx)).toBe(0);

  const vfs = asyncVfs();
  if (!vfs) throw new Error('no async vfs');
  expect(await vfs.readFileText('/repo/a.txt')).toBe('hi\n');
  const log = makeCtx({ cwd: '/repo', env: ENV });
  await git(['log', '--oneline', '-n', '1'], log.ctx);
  expect(log.out()).toMatch(/ Revert "second"$/m);
  const status = makeCtx({ cwd: '/repo', env: ENV });
  await git(['status', '--porcelain'], status.ctx);
  expect(status.out()).toBe('');
});

it('revert refuses dirty worktrees and unsupported sequencing before mutation', async () => {
  await seedCommittedRepo();
  await writeFile('/repo/a.txt', 'second\n');
  await git(['add', 'a.txt'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  await git(['commit', '-m', 'second'], makeCtx({ cwd: '/repo', env: ENV }).ctx);

  await writeFile('/repo/a.txt', 'dirty\n');
  const dirty = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['revert', 'HEAD'], dirty.ctx)).toBe(128);
  expect(dirty.err()).toContain('Not implemented: git.revert.dirty-worktree');
  const vfs = asyncVfs();
  if (!vfs) throw new Error('no async vfs');
  expect(await vfs.readFileText('/repo/a.txt')).toBe('dirty\n');

  const cont = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['revert', '--continue'], cont.ctx)).toBe(128);
  expect(cont.err()).toContain('Not implemented: git.revert.continue');
});

it('apply clean unified diffs to the worktree without staging', async () => {
  await seedCommittedRepo();
  await writeFile('/repo/c.txt', 'gone\n');
  await git(['add', 'c.txt'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  await git(['commit', '-m', 'add c'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  await writeFile(
    '/repo/change.patch',
    [
      'diff --git a/a.txt b/a.txt',
      '--- a/a.txt',
      '+++ b/a.txt',
      '@@ -1 +1 @@',
      '-hi',
      '+patched',
      'diff --git a/b.txt b/b.txt',
      '--- /dev/null',
      '+++ b/b.txt',
      '@@ -0,0 +1 @@',
      '+new',
      'diff --git a/c.txt b/c.txt',
      'deleted file mode 100644',
      '--- a/c.txt',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      '-gone',
      '',
    ].join('\n'),
  );

  const apply = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['apply', 'change.patch'], apply.ctx)).toBe(0);

  const vfs = asyncVfs();
  if (!vfs) throw new Error('no async vfs');
  expect(await vfs.readFileText('/repo/a.txt')).toBe('patched\n');
  expect(await vfs.readFileText('/repo/b.txt')).toBe('new\n');
  expect(await vfs.exists('/repo/c.txt')).toBe(false);
  const status = makeCtx({ cwd: '/repo', env: ENV });
  await git(['status', '--porcelain'], status.ctx);
  expect(status.out()).toContain(' M a.txt');
  expect(status.out()).toContain(' D c.txt');
  expect(status.out()).toContain('?? b.txt');
});

it('apply - reads a clean unified diff from stdin', async () => {
  await seedCommittedRepo();
  const patch = [
    'diff --git a/a.txt b/a.txt',
    '--- a/a.txt',
    '+++ b/a.txt',
    '@@ -1 +1 @@',
    '-hi',
    '+stdin',
    '',
  ].join('\n');
  let consumed = false;
  const ctx = makeCtx({
    cwd: '/repo',
    env: ENV,
    stdin: {
      async read() {
        if (consumed) return null;
        consumed = true;
        return new TextEncoder().encode(patch);
      },
    },
  });

  expect(await git(['apply', '-'], ctx.ctx)).toBe(0);
  const vfs = asyncVfs();
  if (!vfs) throw new Error('no async vfs');
  expect(await vfs.readFileText('/repo/a.txt')).toBe('stdin\n');
});

it('apply parses hunk body lines that look like file headers', async () => {
  await seedRepoDir();
  await writeFile('/repo/a.txt', '-- old\nkeep\n');
  await git(['init'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  await git(['add', 'a.txt'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  await git(['commit', '-m', 'first'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  await writeFile(
    '/repo/change.patch',
    [
      'diff --git a/a.txt b/a.txt',
      '--- a/a.txt',
      '+++ b/a.txt',
      '@@ -1,2 +1,2 @@',
      '--- old',
      '+-- new',
      ' keep',
      '',
    ].join('\n'),
  );

  const apply = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['apply', 'change.patch'], apply.ctx)).toBe(0);
  const vfs = asyncVfs();
  if (!vfs) throw new Error('no async vfs');
  expect(await vfs.readFileText('/repo/a.txt')).toBe('-- new\nkeep\n');
});

it('apply from a repo subdirectory only applies patch entries under that subdirectory', async () => {
  await seedRepoDir();
  const vfs = asyncVfs();
  if (!vfs) throw new Error('no async vfs');
  await vfs.mkdir('/repo/sub', { recursive: true });
  await writeFile('/repo/root.txt', 'one\n');
  await writeFile('/repo/sub/local.txt', 'one\n');
  await git(['init'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  await git(['add', '.'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  await git(['commit', '-m', 'first'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  await writeFile(
    '/repo/change.patch',
    [
      'diff --git a/root.txt b/root.txt',
      '--- a/root.txt',
      '+++ b/root.txt',
      '@@ -1 +1 @@',
      '-one',
      '+two',
      'diff --git a/sub/local.txt b/sub/local.txt',
      '--- a/sub/local.txt',
      '+++ b/sub/local.txt',
      '@@ -1 +1 @@',
      '-one',
      '+two',
      '',
    ].join('\n'),
  );

  const apply = makeCtx({ cwd: '/repo/sub', env: ENV });
  expect(await git(['apply', '../change.patch'], apply.ctx)).toBe(0);
  expect(await vfs.readFileText('/repo/root.txt')).toBe('one\n');
  expect(await vfs.readFileText('/repo/sub/local.txt')).toBe('two\n');
});

it('apply from a subdirectory of a rooted repository keeps root entries out of scope', async () => {
  const vfs = asyncVfs();
  if (!vfs) throw new Error('no async vfs');
  await vfs.mkdir('/sub', { recursive: true });
  await writeFile('/root.txt', 'one\n');
  await writeFile('/sub/local.txt', 'one\n');
  await git(['init'], makeCtx({ cwd: '/', env: ENV }).ctx);
  await git(['add', 'root.txt', 'sub/local.txt'], makeCtx({ cwd: '/', env: ENV }).ctx);
  await git(['commit', '-m', 'first'], makeCtx({ cwd: '/', env: ENV }).ctx);
  await writeFile(
    '/change.patch',
    [
      'diff --git a/root.txt b/root.txt',
      '--- a/root.txt',
      '+++ b/root.txt',
      '@@ -1 +1 @@',
      '-one',
      '+two',
      'diff --git a/sub/local.txt b/sub/local.txt',
      '--- a/sub/local.txt',
      '+++ b/sub/local.txt',
      '@@ -1 +1 @@',
      '-one',
      '+two',
      '',
    ].join('\n'),
  );

  const apply = makeCtx({ cwd: '/sub', env: ENV });
  expect(await git(['apply', '../change.patch'], apply.ctx)).toBe(0);
  expect(await vfs.readFileText('/root.txt')).toBe('one\n');
  expect(await vfs.readFileText('/sub/local.txt')).toBe('two\n');
});

it('apply from a repo subdirectory ignores unsupported metadata for entries outside cwd scope', async () => {
  await seedRepoDir();
  const vfs = asyncVfs();
  if (!vfs) throw new Error('no async vfs');
  await vfs.mkdir('/repo/sub', { recursive: true });
  await writeFile('/repo/root.txt', 'one\n');
  await writeFile('/repo/sub/local.txt', 'one\n');
  await git(['init'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  await git(['add', '.'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  await git(['commit', '-m', 'first'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  await writeFile(
    '/repo/mode.patch',
    ['diff --git a/root.txt b/root.txt', 'old mode 100644', 'new mode 100755', ''].join('\n'),
  );

  const apply = makeCtx({ cwd: '/repo/sub', env: ENV });
  expect(await git(['apply', '../mode.patch'], apply.ctx)).toBe(0);
  expect(apply.out()).toBe('');
  expect(apply.err()).toBe('');
  expect(await vfs.readFileText('/repo/root.txt')).toBe('one\n');
});

it('apply from a repo subdirectory ignores outside unsupported metadata and still applies inside hunks', async () => {
  await seedRepoDir();
  const vfs = asyncVfs();
  if (!vfs) throw new Error('no async vfs');
  await vfs.mkdir('/repo/sub', { recursive: true });
  await writeFile('/repo/root.txt', 'one\n');
  await writeFile('/repo/sub/local.txt', 'one\n');
  await git(['init'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  await git(['add', '.'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  await git(['commit', '-m', 'first'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  await writeFile(
    '/repo/mixed.patch',
    [
      'diff --git a/root.txt b/root.txt',
      'old mode 100644',
      'new mode 100755',
      'diff --git a/sub/local.txt b/sub/local.txt',
      '--- a/sub/local.txt',
      '+++ b/sub/local.txt',
      '@@ -1 +1 @@',
      '-one',
      '+two',
      '',
    ].join('\n'),
  );

  const apply = makeCtx({ cwd: '/repo/sub', env: ENV });
  expect(await git(['apply', '../mixed.patch'], apply.ctx)).toBe(0);
  expect(await vfs.readFileText('/repo/root.txt')).toBe('one\n');
  expect(await vfs.readFileText('/repo/sub/local.txt')).toBe('two\n');
});

it('apply - rejects extra patch operands instead of silently ignoring them', async () => {
  await seedCommittedRepo();
  const ctx = makeCtx({
    cwd: '/repo',
    env: ENV,
    stdin: {
      async read() {
        return null;
      },
    },
  });

  expect(await git(['apply', '-', 'extra.patch'], ctx.ctx)).toBe(128);
  expect(ctx.err()).toContain('Not implemented: git.apply.multiple-files');
});

it('apply conflicting patches loudly and leaves earlier files untouched', async () => {
  await seedCommittedRepo();
  await writeFile('/repo/b.txt', 'actual\n');
  await writeFile(
    '/repo/conflict.patch',
    [
      'diff --git a/a.txt b/a.txt',
      '--- a/a.txt',
      '+++ b/a.txt',
      '@@ -1 +1 @@',
      '-hi',
      '+patched',
      'diff --git a/b.txt b/b.txt',
      '--- a/b.txt',
      '+++ b/b.txt',
      '@@ -1 +1 @@',
      '-expected',
      '+new',
      '',
    ].join('\n'),
  );

  const apply = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['apply', 'conflict.patch'], apply.ctx)).toBe(1);
  expect(apply.err()).toBe('error: patch failed: b.txt:1\nerror: b.txt: patch does not apply\n');
  const vfs = asyncVfs();
  if (!vfs) throw new Error('no async vfs');
  expect(await vfs.readFileText('/repo/a.txt')).toBe('hi\n');
  expect(await vfs.readFileText('/repo/b.txt')).toBe('actual\n');
});

it('apply unsupported modes are loud ceilings', async () => {
  await seedCommittedRepo();
  await writeFile('/repo/change.patch', '');
  const threeWay = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['apply', '--3way', 'change.patch'], threeWay.ctx)).toBe(128);
  expect(threeWay.err()).toContain('Not implemented: git.apply.3way');

  await writeFile(
    '/repo/rename.patch',
    [
      'diff --git a/a.txt b/b.txt',
      'similarity index 100%',
      'rename from a.txt',
      'rename to b.txt',
      '',
    ].join('\n'),
  );
  const rename = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['apply', 'rename.patch'], rename.ctx)).toBe(128);
  expect(rename.err()).toContain('Not implemented: git.apply.rename');

  await writeFile(
    '/repo/copy.patch',
    [
      'diff --git a/a.txt b/b.txt',
      'similarity index 100%',
      'copy from a.txt',
      'copy to b.txt',
      '',
    ].join('\n'),
  );
  const copy = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['apply', 'copy.patch'], copy.ctx)).toBe(128);
  expect(copy.err()).toContain('Not implemented: git.apply.copy');

  await writeFile(
    '/repo/no-newline.patch',
    [
      'diff --git a/a.txt b/a.txt',
      '--- a/a.txt',
      '+++ b/a.txt',
      '@@ -1 +1 @@',
      '-hi',
      '+bye',
      '\\ No newline at end of file',
      '',
    ].join('\n'),
  );
  const noNewline = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['apply', 'no-newline.patch'], noNewline.ctx)).toBe(128);
  expect(noNewline.err()).toContain('Not implemented: git.apply.no-newline');
});

it('stash push/list/pop round-trips tracked worktree changes', async () => {
  await seedCommittedRepo();
  await writeFile('/repo/a.txt', 'dirty\n');
  expect(
    await git(['stash', 'push', '-m', 'save dirty'], makeCtx({ cwd: '/repo', env: ENV }).ctx),
  ).toBe(0);
  const clean = makeCtx({ cwd: '/repo', env: ENV });
  await git(['status', '--porcelain'], clean.ctx);
  expect(clean.out()).toBe('');

  const list = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['stash', 'list'], list.ctx)).toBe(0);
  expect(list.out()).toContain('stash@{0}');

  expect(await git(['stash', 'pop'], makeCtx({ cwd: '/repo', env: ENV }).ctx)).toBe(0);
  const vfs = asyncVfs();
  if (!vfs) throw new Error('no async vfs');
  expect(await vfs.readFileText('/repo/a.txt')).toBe('dirty\n');
});

it('stash push does not persist fallback identity into local config', async () => {
  await seedCommittedRepo();
  await writeFile('/repo/a.txt', 'dirty\n');

  expect(await git(['stash', 'push'], makeCtx({ cwd: '/repo', env: ENV }).ctx)).toBe(0);

  const name = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['config', '--get', 'user.name'], name.ctx)).toBe(1);
  expect(name.out()).toBe('');
  const email = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['config', '--get', 'user.email'], email.ctx)).toBe(1);
  expect(email.out()).toBe('');
});

it('stash pop stash@{1} applies the selected stash entry instead of silently popping stash@{0}', async () => {
  await seedCommittedRepo();
  await writeFile('/repo/a.txt', 'older\n');
  expect(await git(['stash', 'push', '-m', 'older'], makeCtx({ cwd: '/repo', env: ENV }).ctx)).toBe(
    0,
  );
  await writeFile('/repo/a.txt', 'newer\n');
  expect(await git(['stash', 'push', '-m', 'newer'], makeCtx({ cwd: '/repo', env: ENV }).ctx)).toBe(
    0,
  );

  expect(await git(['stash', 'pop', 'stash@{1}'], makeCtx({ cwd: '/repo', env: ENV }).ctx)).toBe(0);
  const vfs = asyncVfs();
  if (!vfs) throw new Error('no async vfs');
  expect(await vfs.readFileText('/repo/a.txt')).toBe('older\n');
});

it('stash push -u is a loud ceiling, not a message that silently ignores untracked files', async () => {
  await seedCommittedRepo();
  await writeFile('/repo/untracked.txt', 'new\n');
  const { ctx, err } = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['stash', 'push', '-u'], ctx)).toBe(128);
  expect(err()).toContain('Not implemented: git.stash.include-untracked');
});

it('stash push pathspecs and missing -m values are loud ceilings before mutation', async () => {
  await seedCommittedRepo();
  await writeFile('/repo/a.txt', 'dirty\n');

  const pathspec = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['stash', 'push', 'a.txt'], pathspec.ctx)).toBe(128);
  expect(pathspec.err()).toContain('Not implemented: git.stash.pathspec');

  const missingMessage = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['stash', 'push', '-m'], missingMessage.ctx)).toBe(128);
  expect(missingMessage.err()).toContain('Not implemented: git.stash.message-missing');

  const vfs = asyncVfs();
  if (!vfs) throw new Error('no async vfs');
  expect(await vfs.readFileText('/repo/a.txt')).toBe('dirty\n');
});

it('ls-remote over an unsupported transport is a loud git transport ceiling', async () => {
  await seedRepoDir();
  const { ctx, err } = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['ls-remote', 'git@github.com:x/y.git'], ctx)).toBe(128);
  expect(err()).toContain('Not implemented: git.transport.ssh');
});

it('ls-remote resolves a configured remote name before checking transport support', async () => {
  await seedCommittedRepo();
  expect(
    await git(
      ['remote', 'add', 'origin', 'git@github.com:x/y.git'],
      makeCtx({ cwd: '/repo', env: ENV }).ctx,
    ),
  ).toBe(0);
  const { ctx, err } = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['ls-remote', 'origin'], ctx)).toBe(128);
  expect(err()).toContain('Not implemented: git.transport.ssh');
  expect(err()).not.toContain('git.transport.unknown');
});

it('ls-remote without an argument defaults to origin', async () => {
  await seedCommittedRepo();
  expect(
    await git(
      ['remote', 'add', 'origin', 'git@github.com:x/y.git'],
      makeCtx({ cwd: '/repo', env: ENV }).ctx,
    ),
  ).toBe(0);

  const { ctx, err } = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['ls-remote'], ctx)).toBe(128);
  expect(err()).toContain('Not implemented: git.transport.ssh');
  expect(err()).not.toContain('git.ls-remote.no-url');
});

it('ls-remote without an argument refuses when no remote is configured', async () => {
  await seedCommittedRepo();

  const { ctx, err } = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['ls-remote'], ctx)).toBe(128);
  expect(err()).toContain('fatal: No remote configured to list refs from.');
  expect(err()).not.toContain('git.ls-remote.no-url');
});

it('push/fetch with a remote NAME (origin) is not mistaken for a URL transport ceiling', async () => {
  await seedCommittedRepo();
  // No remote 'origin' configured → real git errors on the missing remote, NOT
  // a transport-scheme ceiling. The key assertion: it must NOT say git.transport.unknown.
  const { ctx, err } = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['push', 'origin', 'main'], ctx)).toBe(128);
  expect(err()).not.toContain('git.transport.unknown');
});

it('network verbs accept single refspecs, tag flags, and shallow flags before transport checks', async () => {
  await seedCommittedRepo();
  expect(await git(['tag', 'v1'], makeCtx({ cwd: '/repo', env: ENV }).ctx)).toBe(0);

  const pushExtra = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['push', 'git@github.com:x/y.git', 'main', 'extra'], pushExtra.ctx)).toBe(128);
  expect(pushExtra.err()).toContain('Not implemented: git.push.refspecs');

  const pushRefspec = makeCtx({ cwd: '/repo', env: ENV });
  expect(
    await git(['push', 'git@github.com:x/y.git', 'main:refs/heads/main'], pushRefspec.ctx),
  ).toBe(128);
  expect(pushRefspec.err()).toContain('Not implemented: git.transport.ssh');
  expect(pushRefspec.err()).not.toContain('git.push.refspecs');

  const pushTags = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['push', '--tags', 'git@github.com:x/y.git'], pushTags.ctx)).toBe(128);
  expect(pushTags.err()).toContain('Not implemented: git.transport.ssh');
  expect(pushTags.err()).not.toContain('git.push.tags');

  const fetchRefspec = makeCtx({ cwd: '/repo', env: ENV });
  expect(
    await git(
      ['fetch', '--tags', '--prune', 'git@github.com:x/y.git', 'main:refs/remotes/origin/main'],
      fetchRefspec.ctx,
    ),
  ).toBe(128);
  expect(fetchRefspec.err()).toContain('Not implemented: git.transport.ssh');
  expect(fetchRefspec.err()).not.toContain('git.fetch.refspecs');

  const fetchShallow = makeCtx({ cwd: '/repo', env: ENV });
  expect(
    await git(['fetch', '--depth', '1', 'git@github.com:x/y.git', 'main'], fetchShallow.ctx),
  ).toBe(128);
  expect(fetchShallow.err()).toContain('Not implemented: git.transport.ssh');
  expect(fetchShallow.err()).not.toContain('git.fetch.depth');

  const cloneShallow = makeCtx({ cwd: '/repo', env: ENV });
  expect(
    await git(
      ['clone', '--depth', '1', '--single-branch', 'git@github.com:x/y.git', 'cloned'],
      cloneShallow.ctx,
    ),
  ).toBe(128);
  expect(cloneShallow.err()).toContain('Not implemented: git.transport.ssh');
  expect(cloneShallow.err()).not.toContain('git.clone.depth');

  const lsTags = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['ls-remote', '--tags', 'git@github.com:x/y.git'], lsTags.ctx)).toBe(128);
  expect(lsTags.err()).toContain('Not implemented: git.transport.ssh');
  expect(lsTags.err()).not.toContain('git.ls-remote.no-url');
});

it('push --tags still checks the remote transport when there are no local tags', async () => {
  await seedCommittedRepo();
  const pushTags = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['push', '--tags', 'git@github.com:x/y.git'], pushTags.ctx)).toBe(128);
  expect(pushTags.err()).toContain('Not implemented: git.transport.ssh');
});

it('clone into an existing non-empty directory → exit 128, "already exists" (before any network)', async () => {
  await seedRepoDir();
  await git(['init'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  const vfs = asyncVfs();
  if (!vfs) throw new Error('no async vfs');
  await vfs.mkdir('/repo/dest', { recursive: true });
  await writeFile('/repo/dest/keep.txt', 'x\n'); // dest exists + non-empty
  const { ctx, err } = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['clone', 'https://host/foo.git', 'dest'], ctx)).toBe(128);
  expect(err()).toContain("destination path 'dest' already exists and is not an empty directory");
});
