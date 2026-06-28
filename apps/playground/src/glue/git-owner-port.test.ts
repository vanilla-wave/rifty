/**
 * Owner git RPC bridge: the page cannot read `.git`, so every git read/action
 * must cross into the owner realm and call the real @riftydev/git facade there.
 */

import { type GitIdentity, makeGit, vfsToGitFs } from '@riftydev/git';
import { MemoryVfs } from '@riftydev/vfs';
import { afterEach, describe, expect, it } from 'vitest';
import { type GitOwnerClient, bridgeGitOwnerRpc, serveGitOwnerRpc } from './git-owner-port.ts';

const AUTHOR: GitIdentity = {
  name: 'Test',
  email: 't@example.com',
  timestamp: 1_600_000_000,
  timezoneOffset: 0,
};

const dec = new TextDecoder();
const teardowns: Array<() => void> = [];
let client: GitOwnerClient | null = null;

afterEach(() => {
  client?.dispose();
  client = null;
  for (const teardown of teardowns.splice(0)) teardown();
});

async function seededRepo(): Promise<{ vfs: MemoryVfs; g: ReturnType<typeof makeGit> }> {
  const vfs = new MemoryVfs();
  await vfs.mkdir('/repo', { recursive: true });
  const g = makeGit({ fs: vfsToGitFs(vfs), dir: '/repo' });
  await g.init();
  await vfs.writeFile('/repo/a.txt', 'first\n');
  await g.add('a.txt');
  await g.commit({ message: 'first', author: AUTHOR, committer: AUTHOR });
  return { vfs, g };
}

function serve(key: string, g: ReturnType<typeof makeGit>): void {
  teardowns.push(serveGitOwnerRpc(key, g));
}

function page(key: string, timeoutMs = 1_000): GitOwnerClient {
  client = bridgeGitOwnerRpc(key, { timeoutMs });
  return client;
}

describe('git owner RPC bridge', () => {
  it('returns status identical to the owner git engine for a known tree', async () => {
    const { vfs, g } = await seededRepo();
    await vfs.writeFile('/repo/a.txt', 'second\n');
    await vfs.writeFile('/repo/untracked.txt', 'new\n');
    serve('git-status-parity', g);

    await expect(page('git-status-parity').status()).resolves.toEqual(await g.status());
  });

  it('returns show(HEAD:path) blob bytes byte-identical to the owner engine', async () => {
    const { g } = await seededRepo();
    serve('git-show-parity', g);

    const viaRpc = await page('git-show-parity').show('HEAD:a.txt');
    const direct = await g.show('HEAD:a.txt');

    expect(viaRpc).toEqual(direct);
    expect(viaRpc.type).toBe('blob');
    if (viaRpc.type !== 'blob') throw new Error('expected blob');
    expect(dec.decode(viaRpc.content)).toBe('first\n');
  });

  it('routes add, commit, and restore actions through the owner engine', async () => {
    const { vfs, g } = await seededRepo();
    await vfs.writeFile('/repo/a.txt', 'edited\n');
    serve('git-actions', g);
    const c = page('git-actions');

    await c.add('a.txt');
    const oid = await c.commit({ message: 'edit', author: AUTHOR, committer: AUTHOR });
    expect(oid).toMatch(/^[0-9a-f]{40}$/);
    expect(await c.status()).toEqual(await g.status());

    await vfs.writeFile('/repo/a.txt', 'scratch\n');
    expect((await c.status()).some((entry) => entry.filepath === 'a.txt')).toBe(true);

    await c.restore(['a.txt']);
    expect(dec.decode(await vfs.readFile('/repo/a.txt'))).toBe('edited\n');
    expect(await c.status()).toEqual(await g.status());
  });

  it('routes remove for staged deletions and commits with owner-resolved identity', async () => {
    const { vfs, g } = await seededRepo();
    await g.setConfig('user.name', 'Configured User');
    await g.setConfig('user.email', 'configured@example.test');
    await vfs.rm('/repo/a.txt');
    serve('git-delete-commit', g);
    const c = page('git-delete-commit');

    await c.remove('a.txt');
    const oid = await c.commitResolvedIdentity({ message: 'remove a' });
    expect(oid).toMatch(/^[0-9a-f]{40}$/);

    const [entry] = await g.log({ depth: 1 });
    expect(entry?.author.name).toBe('Configured User');
    expect(entry?.author.email).toBe('configured@example.test');
    expect((await c.status()).some((status) => status.filepath === 'a.txt')).toBe(false);
  });

  it('refuses owner-resolved commits with no staged changes without creating commits', async () => {
    const { vfs, g } = await seededRepo();
    serve('git-no-empty-commit', g);
    const c = page('git-no-empty-commit');
    const logCount = async (): Promise<number> => (await g.log()).length;

    await expect(c.commitResolvedIdentity({ message: 'clean tree' })).rejects.toThrow(
      'nothing to commit, working tree clean',
    );
    expect(await logCount()).toBe(1);

    await vfs.writeFile('/repo/a.txt', 'edited but unstaged\n');
    await expect(c.commitResolvedIdentity({ message: 'unstaged only' })).rejects.toThrow(
      'no changes added to commit',
    );
    expect(await logCount()).toBe(1);

    await vfs.writeFile('/repo/a.txt', 'first\n');
    await vfs.writeFile('/repo/untracked.txt', 'new\n');
    await expect(c.commitResolvedIdentity({ message: 'untracked only' })).rejects.toThrow(
      'untracked files present',
    );
    expect(await logCount()).toBe(1);
  });

  it('routes diff, log, branch reads plus unstage and reset actions', async () => {
    const { vfs, g } = await seededRepo();
    await vfs.writeFile('/repo/a.txt', 'second\n');
    serve('git-more-verbs', g);
    const c = page('git-more-verbs');

    expect(await c.diff({ kind: 'head-workdir' })).toEqual(await g.diff({ kind: 'head-workdir' }));
    expect(await c.log({ depth: 1 })).toEqual(await g.log({ depth: 1 }));
    expect(await c.currentBranch()).toBe(await g.currentBranch());
    expect(await c.listBranches()).toEqual(await g.listBranches());

    await c.add('a.txt');
    await c.unstage('a.txt');
    expect(await c.status()).toEqual(await g.status());

    await c.add('a.txt');
    await c.commit({ message: 'second', author: AUTHOR, committer: AUTHOR });
    await c.reset({ target: 'HEAD^', mode: 'hard' });
    const restored = await c.show('HEAD:a.txt');
    expect(restored.type).toBe('blob');
    if (restored.type !== 'blob') throw new Error('expected blob');
    expect(dec.decode(restored.content)).toBe('first\n');
    expect(await c.status()).toEqual(await g.status());
  });

  it('rejects with a timeout when no owner is listening', async () => {
    await expect(page('git-timeout', 50).status()).rejects.toThrow(/timeout/i);
  });

  it('dispose rejects in-flight requests and refuses later calls', async () => {
    const c = page('git-dispose', 5_000);
    const inFlight = c.status();
    c.dispose();

    await expect(inFlight).rejects.toThrow(/disposed/);
    await expect(c.status()).rejects.toThrow(/disposed/);
    client = null;
  });
});
