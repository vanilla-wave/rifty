/**
 * Faults: storage read failures under every Git operation (quota-perm-fail /
 * provenance-lie at the VFS→isomorphic-git boundary). isomorphic-git's
 * `FileSystem.read`/`readdir` collapse ANY rejection into absence (`null`/`[]`);
 * the facade must surface the exact `VfsError` instead — absence stays proven
 * (ENOENT/ENOTDIR/EISDIR probes), never inferred from a swallowed failure.
 * ADR-0357.
 */
import { MemoryVfs, VfsError } from '@riftydev/vfs';
import { afterEach, expect, it, vi } from 'vitest';
import { commitRefusal } from '../src/commit-refusal.ts';
import { vfsToGitFs } from '../src/fs-adapter.ts';
import { makeGit } from '../src/git.ts';

const ID = { name: 'T', email: 't@e.com', timestamp: 1_600_000_000, timezoneOffset: 0 };

function looseObjectPath(root: string, oid: string): string {
  return `${root}/.git/objects/${oid.slice(0, 2)}/${oid.slice(2)}`;
}

async function seededRepo(root = '/r'): Promise<{
  vfs: MemoryVfs;
  g: ReturnType<typeof makeGit>;
  head: string;
}> {
  const vfs = new MemoryVfs();
  await vfs.mkdir(`${root}/src`, { recursive: true });
  const g = makeGit({ fs: vfsToGitFs(vfs), dir: root });
  await g.init();
  await vfs.writeFile(`${root}/src/main.js`, 'console.log("one");\n');
  await g.add('src/main.js');
  const head = await g.commit({ message: 'one', author: ID, committer: ID });
  return { vfs, g, head };
}

function failReadsOf(vfs: MemoryVfs, failure: VfsError): void {
  const readFile = vfs.readFile.bind(vfs);
  vi.spyOn(vfs, 'readFile').mockImplementation(async (path) => {
    if (path === failure.path) throw failure;
    return await readFile(path);
  });
}

async function rejectedValue(run: Promise<unknown>): Promise<unknown> {
  return run.then(
    () => undefined,
    (error: unknown) => error,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

it('[fault: quota-perm-fail][fault: provenance-lie] resolveRef surfaces the exact ref read failure, never absence', async () => {
  const { vfs, g } = await seededRepo();
  const failure = new VfsError('EIO', '/r/.git/refs/heads/main', 'injected ref read failure');
  failReadsOf(vfs, failure);

  expect(await rejectedValue(g.resolveRef('HEAD'))).toBe(failure);
});

it('[fault: quota-perm-fail][fault: provenance-lie] log surfaces the exact commit object read failure', async () => {
  const { vfs, g, head } = await seededRepo();
  const failure = new VfsError(
    'EACCES',
    looseObjectPath('/r', head),
    'injected commit object read failure',
  );
  failReadsOf(vfs, failure);

  expect(await rejectedValue(g.log())).toBe(failure);
});

it('[fault: quota-perm-fail][fault: provenance-lie] show surfaces the exact tree object read failure', async () => {
  const { vfs, g } = await seededRepo();
  const tree = (await g.log())[0]?.tree;
  if (tree === undefined) throw new Error('expected a head commit tree');
  const failure = new VfsError('EIO', looseObjectPath('/r', tree), 'injected tree read failure');
  failReadsOf(vfs, failure);

  expect(await rejectedValue(g.show(tree))).toBe(failure);
});

it('[fault: quota-perm-fail][fault: provenance-lie] status surfaces a workdir readdir failure instead of reporting the subtree deleted', async () => {
  const { vfs, g } = await seededRepo();
  const failure = new VfsError('EIO', '/r/src', 'injected workdir readdir failure');
  const readdir = vfs.readdir.bind(vfs);
  vi.spyOn(vfs, 'readdir').mockImplementation(async (path) => {
    if (path === failure.path) throw failure;
    return await readdir(path);
  });

  expect(await rejectedValue(g.status())).toBe(failure);
});

it('[fault: quota-perm-fail][fault: provenance-lie] commit never orphans history when the parent ref read fails', async () => {
  const { vfs, g, head } = await seededRepo();
  await vfs.writeFile('/r/src/main.js', 'console.log("two");\n');
  await g.add('src/main.js');
  const failure = new VfsError(
    'EIO',
    '/r/.git/refs/heads/main',
    'injected parent ref read failure',
  );
  failReadsOf(vfs, failure);

  const rejected = await rejectedValue(g.commit({ message: 'two', author: ID, committer: ID }));
  vi.restoreAllMocks();

  // Without the carrier, isomorphic-git treats the unreadable ref as "no
  // parent" and commits a PARENTLESS root, silently orphaning history.
  expect.soft(rejected).toBe(failure);
  const log = await g.log();
  expect(log.map(({ oid }) => oid)).toEqual([head]);
});

it('[fault: quota-perm-fail] concurrent operations on one instance each surface the exact failure', async () => {
  const { vfs, g } = await seededRepo();
  const failure = new VfsError('EIO', '/r/.git/HEAD', 'injected HEAD read failure');
  failReadsOf(vfs, failure);

  const [status, log] = await Promise.all([rejectedValue(g.status()), rejectedValue(g.log())]);
  expect.soft(status).toBe(failure);
  expect(log).toBe(failure);
});

it('[fault: quota-perm-fail][fault: torn-state] reset --hard never mutates the worktree over a swallowed index read', async () => {
  const { vfs, g, head } = await seededRepo();
  await vfs.writeFile('/r/src/main.js', 'console.log("two");\n');
  await g.add('src/main.js');
  const second = await g.commit({ message: 'two', author: ID, committer: ID });
  const failure = new VfsError('EIO', '/r/.git/index', 'injected index read failure');
  failReadsOf(vfs, failure);

  // isomorphic-git swallows the index read into an EMPTY index; without the
  // write gate the workdir is rewritten to the target before the loud reject.
  const rejected = await rejectedValue(g.reset({ target: head, mode: 'hard' }));
  vi.restoreAllMocks();

  expect.soft(rejected).toBe(failure);
  expect.soft(await vfs.readFileText('/r/src/main.js')).toBe('console.log("two");\n');
  expect(await g.resolveRef('HEAD')).toBe(second);
});

it('[fault: quota-perm-fail][fault: provenance-lie] commitRefusal surfaces a transient HEAD ref failure instead of claiming an unborn repo', async () => {
  const { vfs, g } = await seededRepo();
  const failure = new VfsError('EIO', '/r/.git/refs/heads/main', 'injected refusal ref failure');
  const readFile = vfs.readFile.bind(vfs);
  let matchingReads = 0;
  // First read (status' TREE walk) succeeds; the unborn probe's read fails.
  vi.spyOn(vfs, 'readFile').mockImplementation(async (path) => {
    if (path === failure.path && ++matchingReads >= 2) throw failure;
    return await readFile(path);
  });

  expect(await rejectedValue(commitRefusal(g))).toBe(failure);
});

it('absence stays trustworthy: an unborn HEAD still reports git absence, not a storage failure', async () => {
  const vfs = new MemoryVfs();
  await vfs.mkdir('/r', { recursive: true });
  const g = makeGit({ fs: vfsToGitFs(vfs), dir: '/r' });
  await g.init();

  const rejected = await rejectedValue(g.resolveRef('HEAD'));
  expect((rejected as { code?: unknown } | undefined)?.code).toBe('NotFoundError');
});

it('absence stays trustworthy: EISDIR ref-directory probes stay semantic absence, not failures', async () => {
  const { vfs, g, head } = await seededRepo();
  // `refs/heads/feat` is a DIRECTORY (branch feat/x): resolving `feat` probes
  // it with readFile → EISDIR, which real git treats as "candidate absent".
  await vfs.mkdir('/r/.git/refs/heads/feat', { recursive: true });
  await vfs.writeFile('/r/.git/refs/heads/feat/x', `${head}\n`);

  expect(await g.resolveRef('feat/x')).toBe(head);
  const rejected = await rejectedValue(g.resolveRef('feat'));
  expect((rejected as { code?: unknown } | undefined)?.code).toBe('NotFoundError');
});
