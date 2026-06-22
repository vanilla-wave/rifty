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
import { git } from '../src/commands/git.ts';
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

it('clone without a <url> fails loudly (exit 128)', async () => {
  await seedRepoDir();
  const { ctx, err } = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['clone'], ctx)).toBe(128);
  expect(err()).toContain('clone requires a <url>');
});

/** Seed a single-commit repo on `main` with a.txt committed. */
async function seedCommittedRepo(): Promise<void> {
  await seedRepoDir();
  await writeFile('/repo/a.txt', 'hi\n');
  await git(['init'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
  await git(['add', 'a.txt'], makeCtx({ cwd: '/repo', env: ENV }).ctx);
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

// C4 — revspec arithmetic (`HEAD~1`, `main^`, `@{-1}`, `HEAD@{1}`) is a ceiling:
// iso-git's resolveRef can't parse it, so we loud-throw rather than leak the raw
// plumbing error ("Could not find HEAD~1").
it('checkout HEAD~1 → exit 128, revspec ceiling (loud, not a leaked plumbing error)', async () => {
  await seedCommittedRepo();
  const { ctx, err } = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['checkout', 'HEAD~1'], ctx)).toBe(128);
  expect(err()).toContain('git.checkout.revspec');
  expect(err()).not.toContain('Could not find');
});

it('checkout HEAD~1 -- f (revspec source) → exit 128, revspec ceiling', async () => {
  await seedCommittedRepo();
  const { ctx, err } = makeCtx({ cwd: '/repo', env: ENV });
  expect(await git(['checkout', 'HEAD~1', '--', 'a.txt'], ctx)).toBe(128);
  expect(err()).toContain('git.checkout.revspec');
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
