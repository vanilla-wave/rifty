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
import { carryExactReadFailures } from '../src/exact-read-failures.ts';
import { type GitFs, vfsToGitFs } from '../src/fs-adapter.ts';
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

/** Distinguishes a resolve from a rejection whose VALUE is undefined/null. */
async function settlement(run: Promise<unknown>): Promise<{ rejected: boolean; value: unknown }> {
  return run.then(
    (value) => ({ rejected: false, value }),
    (value: unknown) => ({ rejected: true, value }),
  );
}

/** Boundary decorator: scripted reads, recorded writes, unused stat verbs. */
function stubGitFs(read: () => Promise<Uint8Array | string>, onWrite: (p: string) => void): GitFs {
  const unused = async (): Promise<never> => {
    throw new Error('unused verb');
  };
  return {
    promises: {
      readFile: read,
      writeFile: async (p) => onWrite(p),
      unlink: async (p) => onWrite(p),
      readdir: async () => [],
      mkdir: async (p) => onWrite(p),
      rmdir: async (p) => onWrite(p),
      stat: unused,
      lstat: unused,
      readlink: unused,
      symlink: async (_target, p) => onWrite(p),
      chmod: async () => undefined,
    },
  };
}

/** Every verb on the PROTOTYPE with receiver-bound private state — a valid
 *  structural GitFs the carrier must not break (no own-property assumptions). */
class PrototypeGitFsPromises {
  readonly #inner: GitFs['promises'];
  constructor(inner: GitFs['promises']) {
    this.#inner = inner;
  }
  readFile(p: string, opts?: { encoding?: 'utf8' } | 'utf8'): Promise<Uint8Array | string> {
    return this.#inner.readFile(p, opts);
  }
  writeFile(p: string, data: Uint8Array | string, opts?: unknown): Promise<void> {
    return this.#inner.writeFile(p, data, opts);
  }
  unlink(p: string): Promise<void> {
    return this.#inner.unlink(p);
  }
  readdir(p: string): Promise<string[]> {
    return this.#inner.readdir(p);
  }
  mkdir(p: string): Promise<void> {
    return this.#inner.mkdir(p);
  }
  rmdir(p: string): Promise<void> {
    return this.#inner.rmdir(p);
  }
  stat(p: string): ReturnType<GitFs['promises']['stat']> {
    return this.#inner.stat(p);
  }
  lstat(p: string): ReturnType<GitFs['promises']['lstat']> {
    return this.#inner.lstat(p);
  }
  readlink(p: string): Promise<string> {
    return this.#inner.readlink(p);
  }
  symlink(target: string, p: string): Promise<void> {
    return this.#inner.symlink(target, p);
  }
  chmod(p: string, mode: number): Promise<void> {
    return this.#inner.chmod(p, mode);
  }
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

it('[fault: quota-perm-fail][fault: provenance-lie] clone-failure cleanup never deletes a pre-existing .git over a transient gitdir probe failure', async () => {
  const { vfs, head } = await seededRepo();
  // assertPortablePaths arms the clone-failure cleanup path (removeTree .git).
  const g = makeGit({ fs: vfsToGitFs(vfs), dir: '/r', assertPortablePaths: () => undefined });
  const failure = new VfsError('EIO', '/r/.git', 'injected gitdir probe failure');
  const stat = vfs.stat.bind(vfs);
  let injected = false;
  vi.spyOn(vfs, 'stat').mockImplementation(async (path) => {
    if (!injected && path === failure.path) {
      injected = true;
      throw failure;
    }
    return await stat(path);
  });

  // Without the absence guard the probe collapses EIO into "no gitdir": the
  // clone then fails at the network and its cleanup removeTree's the REAL repo.
  const rejected = await rejectedValue(g.clone({ url: 'http://127.0.0.1:1/x.git' }));

  expect.soft(rejected).toBe(failure);
  expect(await g.resolveRef('HEAD')).toBe(head);
});

it('[fault: observable-order][fault: provenance-lie] a failure belongs only to its own operation, never to a concurrent one', async () => {
  const { vfs, g, head } = await seededRepo();
  const failure = new VfsError(
    'EIO',
    looseObjectPath('/r', head),
    'injected commit object read failure',
  );
  // Gate getConfig's read so it is provably in flight while log fails; only
  // log touches the failed path, so only log may reject.
  let releaseConfig = (): void => undefined;
  const configGate = new Promise<void>((resolve) => {
    releaseConfig = resolve;
  });
  const readFile = vfs.readFile.bind(vfs);
  vi.spyOn(vfs, 'readFile').mockImplementation(async (path) => {
    if (path === failure.path) throw failure;
    if (path === '/r/.git/config') await configGate;
    return await readFile(path);
  });

  const logRejection = rejectedValue(g.log());
  const config = g.getConfig('user.name');
  expect.soft(await logRejection).toBe(failure);
  releaseConfig();
  await expect(config).resolves.toBeUndefined();
});

it('[fault: provenance-lie] latch keeps the identity of an undefined rejection and still fail-stops writes', async () => {
  const writes: string[] = [];
  const carrier = carryExactReadFailures(
    stubGitFs(
      () => Promise.reject(undefined),
      (p) => writes.push(p),
    ),
  );

  const settled = await settlement(
    carrier.guard(async () => {
      // isomorphic-git style: swallow the read, then write over the swallow.
      await carrier.fs.promises.readFile('/latched').catch(() => undefined);
      await carrier.fs.promises.writeFile('/w', 'data');
      return 'ok';
    }),
  );

  expect.soft(settled).toEqual({ rejected: true, value: undefined });
  expect(writes).toEqual([]);
});

it('[fault: provenance-lie] the FIRST non-absence rejection wins; a later failure never replaces a null latch', async () => {
  const writes: string[] = [];
  let reads = 0;
  const carrier = carryExactReadFailures(
    stubGitFs(
      () => Promise.reject(reads++ === 0 ? null : new VfsError('EIO', '/second', 'second failure')),
      (p) => writes.push(p),
    ),
  );

  const settled = await settlement(
    carrier.guard(async () => {
      await carrier.fs.promises.readFile('/first').catch(() => undefined);
      await carrier.fs.promises.readFile('/second').catch(() => undefined);
      await carrier.fs.promises.writeFile('/w', 'data');
      return 'ok';
    }),
  );

  expect.soft(settled).toEqual({ rejected: true, value: null });
  expect(writes).toEqual([]);
});

it('[fault: sibling-drift] a prototype-backed GitFs drives the facade end-to-end with exact failure identity', async () => {
  const vfs = new MemoryVfs();
  await vfs.mkdir('/p/src', { recursive: true });
  const proto: GitFs = { promises: new PrototypeGitFsPromises(vfsToGitFs(vfs).promises) };
  const g = makeGit({ fs: proto, dir: '/p' });
  await g.init();
  await vfs.writeFile('/p/src/a.js', 'x\n');
  await g.add('src/a.js');
  const oid = await g.commit({ message: 'm', author: ID, committer: ID });
  expect.soft(await g.resolveRef('HEAD')).toBe(oid);

  const failure = new VfsError('EIO', '/p/.git/refs/heads/main', 'injected proto ref failure');
  const readFile = vfs.readFile.bind(vfs);
  vi.spyOn(vfs, 'readFile').mockImplementation(async (path) => {
    if (path === failure.path) throw failure;
    return await readFile(path);
  });
  expect(await rejectedValue(g.resolveRef('HEAD'))).toBe(failure);
});

it('[fault: observable-order][fault: poisoned-cache] one instance serializes, distinct instances stay independent, and the queue survives a rejection', async () => {
  const { vfs, g, head } = await seededRepo();
  const other = await seededRepo('/q');
  const reads: string[] = [];
  let releaseHold = (): void => undefined;
  const hold = new Promise<void>((resolve) => {
    releaseHold = resolve;
  });
  // Hold a loose OBJECT read: unlike ref reads, object reads take no
  // isomorphic-git GLOBAL per-refname lock, so only THIS instance may stall.
  const failure = new VfsError('EIO', looseObjectPath('/r', head), 'injected held-op failure');
  const readFile = vfs.readFile.bind(vfs);
  vi.spyOn(vfs, 'readFile').mockImplementation(async (path) => {
    reads.push(path);
    if (path === failure.path) {
      await hold;
      throw failure;
    }
    return await readFile(path);
  });

  const held = rejectedValue(g.log());
  const follower = g.getConfig('user.name');
  await expect(other.g.log()).resolves.toHaveLength(1);
  await new Promise((resolve) => setTimeout(resolve, 10));
  // Same-instance follower makes NO filesystem progress while the head op holds.
  expect.soft(reads.filter((p) => p === '/r/.git/config')).toEqual([]);
  releaseHold();
  expect.soft(await held).toBe(failure);
  // The queue recovers after a rejection: the follower runs and succeeds.
  await expect(follower).resolves.toBeUndefined();
}, 10_000);

it('[fault: torn-state][fault: sibling-drift] every mutating verb fail-stops with the exact latched failure — including undefined/null latches', async () => {
  for (const latch of [
    new VfsError('EIO', '/latched', 'latched read failure'),
    undefined,
    null,
  ] as const) {
    const effects: string[] = [];
    const carrier = carryExactReadFailures(
      stubGitFs(
        () => Promise.reject(latch),
        (p) => effects.push(p),
      ),
    );

    const settled = await settlement(
      carrier.guard(async () => {
        await carrier.fs.promises.readFile('/latched').catch(() => undefined);
        // isomorphic-git style: swallow each verb rejection and keep going.
        await carrier.fs.promises.writeFile('/w', 'data').catch(() => undefined);
        await carrier.fs.promises.unlink('/u').catch(() => undefined);
        await carrier.fs.promises.mkdir('/m').catch(() => undefined);
        await carrier.fs.promises.rmdir('/d').catch(() => undefined);
        return 'completed';
      }),
    );

    expect.soft(settled.rejected, String(latch)).toBe(true);
    expect.soft(settled.value, String(latch)).toBe(latch);
    expect(effects, String(latch)).toEqual([]);
  }
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
