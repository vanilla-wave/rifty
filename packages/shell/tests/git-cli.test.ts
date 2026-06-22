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
