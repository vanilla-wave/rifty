/**
 * Faults: storage read failures under shell `git` probes (quota-perm-fail /
 * provenance-lie at the facade→CLI boundary). The facade surfaces the exact
 * `VfsError` (ADR-0357); the command layer must not re-collapse it into a
 * native-looking diagnostic ("nothing to amend", a fabricated branch name,
 * "pathspec did not match") — absence classifies TYPE-first (a `VfsError` is
 * never absence even when its message mimics "could not find"), storage
 * failures rethrow to the shell's loud generic path, and every failing command
 * leaves the repository byte-identical.
 */
import { VfsError, asyncVfs } from '@riftydev/vfs';
import { installMemoryFs, resetSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { git } from '../src/commands/git.ts';
import { makeCtx } from './_ctx.ts';

const ENV: Record<string, string> = {
  GIT_AUTHOR_NAME: 'rifty',
  GIT_AUTHOR_EMAIL: 'rifty@localhost',
  GIT_AUTHOR_DATE: '1600000000',
  GIT_COMMITTER_NAME: 'rifty',
  GIT_COMMITTER_EMAIL: 'rifty@localhost',
  GIT_COMMITTER_DATE: '1600000000',
};

type Vfs = NonNullable<ReturnType<typeof asyncVfs>>;

function vfsOrThrow(): Vfs {
  const vfs = asyncVfs();
  if (!vfs) throw new Error('no async vfs after installMemoryFs');
  return vfs;
}

async function run(args: string[]): Promise<number | unknown> {
  return git([...args], makeCtx({ cwd: '/repo', env: ENV }).ctx);
}

async function seedCommittedRepo(): Promise<void> {
  const vfs = vfsOrThrow();
  await vfs.mkdir('/repo', { recursive: true });
  await vfs.writeFile('/repo/a.txt', 'one\n');
  await run(['init']);
  await run(['add', 'a.txt']);
  if ((await run(['commit', '-m', 'one'])) !== 0) throw new Error('seed commit failed');
}

/** main at commit2, feature-x at commit1 (DIVERGENT), worktree at "two".
 *  Branch via `checkout -b` — the `branch <name>` CLI silently ignores the
 *  name (recorded: backlog shell/git-branch-create-silently-ignored). */
async function seedDivergentRepo(): Promise<void> {
  await seedCommittedRepo();
  const vfs = vfsOrThrow();
  if ((await run(['checkout', '-b', 'feature-x'])) !== 0) throw new Error('seed branch failed');
  if ((await run(['checkout', 'main'])) !== 0) throw new Error('seed switch-back failed');
  if (!(await vfs.exists('/repo/.git/refs/heads/feature-x')))
    throw new Error('seed branch ref missing');
  await vfs.writeFile('/repo/a.txt', 'two\n');
  await run(['add', 'a.txt']);
  if ((await run(['commit', '-m', 'two'])) !== 0) throw new Error('seed second commit failed');
}

/** Byte-exact recursive snapshot of the WHOLE repo (worktree + .git). */
async function snapshotRepo(vfs: Vfs): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await vfs.readdir(dir)) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory) await walk(path);
      else out[path] = Array.from(await vfs.readFile(path)).join(',');
    }
  };
  await walk('/repo');
  return out;
}

/** Distinguishes a resolve from a rejection whose VALUE is the exact failure. */
async function settlement(run: Promise<unknown>): Promise<{ rejected: boolean; value: unknown }> {
  return run.then(
    (value) => ({ rejected: false, value }),
    (value: unknown) => ({ rejected: true, value }),
  );
}

function failReadsOf(vfs: Vfs, failure: VfsError): void {
  const readFile = vfs.readFile.bind(vfs);
  vi.spyOn(vfs, 'readFile').mockImplementation(async (path) => {
    if (path === failure.path) throw failure;
    return await readFile(path);
  });
}

async function headOid(vfs: Vfs): Promise<string> {
  return (await vfs.readFileText('/repo/.git/refs/heads/main')).trim();
}

beforeEach(() => {
  installMemoryFs();
});
afterEach(() => {
  vi.restoreAllMocks();
  resetSyncMirror();
});

it('[fault: quota-perm-fail][fault: provenance-lie] commit --amend surfaces a commit-object read failure instead of "nothing to amend"', async () => {
  await seedCommittedRepo();
  const vfs = vfsOrThrow();
  const before = await snapshotRepo(vfs);
  const head = await headOid(vfs);
  const failure = new VfsError(
    'EIO',
    `/repo/.git/objects/${head.slice(0, 2)}/${head.slice(2)}`,
    'injected amend object read failure',
  );
  failReadsOf(vfs, failure);

  const amend = makeCtx({ cwd: '/repo', env: ENV });
  const outcome = await settlement(git(['commit', '--amend', '-m', 'two'], amend.ctx));
  vi.restoreAllMocks();

  // Settlement captured FIRST: every assertion executes on the defect too.
  const after = await snapshotRepo(vfs);
  expect.soft(outcome.rejected).toBe(true);
  expect.soft(outcome.value).toBe(failure);
  // Emit-then-rethrow is still a lie: the command layer writes NOTHING.
  expect.soft(amend.out()).toBe('');
  expect.soft(amend.err()).toBe('');
  expect(after).toEqual(before);
});

it('[fault: quota-perm-fail][fault: provenance-lie] log on an unborn branch surfaces a HEAD read failure instead of fabricating the branch name', async () => {
  const vfs = vfsOrThrow();
  await vfs.mkdir('/repo', { recursive: true });
  await run(['init']);
  const before = await snapshotRepo(vfs);
  const failure = new VfsError('EIO', '/repo/.git/HEAD', 'injected HEAD read failure');
  const readFile = vfs.readFile.bind(vfs);
  let headReads = 0;
  // Read #1 (g.log's unborn resolveRef) stays a PROVEN absence; the secondary
  // currentBranch lookup for the diagnostic hits the storage failure.
  vi.spyOn(vfs, 'readFile').mockImplementation(async (path) => {
    if (path === failure.path && ++headReads >= 2) throw failure;
    return await readFile(path);
  });

  const log = makeCtx({ cwd: '/repo', env: ENV });
  const outcome = await settlement(git(['log'], log.ctx));
  vi.restoreAllMocks();

  const after = await snapshotRepo(vfs);
  expect.soft(outcome.rejected).toBe(true);
  expect.soft(outcome.value).toBe(failure);
  expect.soft(log.out()).toBe('');
  expect.soft(log.err()).toBe('');
  expect(after).toEqual(before);
});

it('[fault: quota-perm-fail][fault: provenance-lie] reset surfaces an EXECUTION-stage index read failure instead of a semantic fatal', async () => {
  await seedDivergentRepo();
  const vfs = vfsOrThrow();
  const before = await snapshotRepo(vfs);
  // Skip the preflight's index read; the SECOND one belongs to g.reset's own
  // execution, where doReset's catch used to collapse the exact VfsError into
  // `fatal: <msg>` exit 128.
  const failure = new VfsError('EIO', '/repo/.git/index', 'injected reset index read failure');
  const readFile = vfs.readFile.bind(vfs);
  let indexReads = 0;
  vi.spyOn(vfs, 'readFile').mockImplementation(async (path) => {
    if (path === failure.path && ++indexReads >= 2) throw failure;
    return await readFile(path);
  });

  const ctx = makeCtx({ cwd: '/repo', env: ENV });
  const outcome = await settlement(git(['reset', 'feature-x'], ctx.ctx));
  vi.restoreAllMocks();

  const after = await snapshotRepo(vfs);
  expect.soft(outcome.rejected).toBe(true);
  expect.soft(outcome.value).toBe(failure);
  expect.soft(ctx.out()).toBe('');
  expect.soft(ctx.err()).toBe('');
  expect(after).toEqual(before);
});

// Matrix: one INDEPENDENT case per absence-probe catch boundary. The injected
// message deliberately matches the /could not find/i heuristic: a storage
// failure must never be classified by TEXT into git absence, and the failing
// command must leave the repository byte-identical.
const PROBE_CASES = [
  { args: ['status'], target: 'head-object' },
  { args: ['log'], target: 'head-object' },
  { args: ['log', 'main'], target: '/repo/.git/refs/heads/main' },
  { args: ['diff', 'main'], target: '/repo/.git/refs/heads/main' },
  { args: ['reset', 'feature-x'], target: '/repo/.git/refs/heads/feature-x' },
  { args: ['checkout', 'feature-x'], target: '/repo/.git/refs/heads/feature-x' },
  { args: ['switch', 'feature-x'], target: '/repo/.git/refs/heads/feature-x' },
  { args: ['checkout', 'feature-x~1'], target: '/repo/.git/refs/heads/feature-x' },
  { args: ['checkout', 'main', '--'], target: '/repo/.git/refs/heads/main' },
] as const;
for (const scenario of PROBE_CASES) {
  it(`[fault: provenance-lie][fault: sibling-drift] git ${scenario.args.join(' ')} rejects exact over a storage failure whose text mimics absence`, async () => {
    await seedDivergentRepo();
    const vfs = vfsOrThrow();
    const before = await snapshotRepo(vfs);
    const path =
      scenario.target === 'head-object'
        ? `/repo/.git/objects/${(await headOid(vfs)).slice(0, 2)}/${(await headOid(vfs)).slice(2)}`
        : scenario.target;
    const failure = new VfsError('EIO', path, 'Could not find object — injected storage failure');
    failReadsOf(vfs, failure);

    const ctx = makeCtx({ cwd: '/repo', env: ENV });
    const outcome = await settlement(git([...scenario.args], ctx.ctx));
    vi.restoreAllMocks();

    // Settlement captured FIRST: state and output assertions execute on the
    // defect too; emit-then-rethrow would be caught by the empty-output pins.
    const after = await snapshotRepo(vfs);
    expect.soft(outcome.rejected).toBe(true);
    expect.soft(outcome.value).toBe(failure);
    expect.soft(ctx.out()).toBe('');
    expect.soft(ctx.err()).toBe('');
    expect(after).toEqual(before);
  });
}
