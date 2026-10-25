import { createMemoryFs, resetSyncMirror, setSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, expect, it } from 'vitest';
import { createOwnerVfsAuthorityComposition } from '../workers/owner-vfs-authority.ts';
import { createInstallStampAuthority } from './install-stamp-authority.ts';
import { SyncMirrorVfs } from './sync-mirror-vfs.ts';

const ROOT = '/project';
const OTHER_ROOT = '/other-project';
const PACKAGE_JSON = '{"name":"app","dependencies":{}}\n';

interface RollbackAuthority {
  withRollback<T>(
    roots: readonly string[],
    operation: (reconcile: () => Promise<void>) => Promise<T>,
  ): Promise<T>;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function harness() {
  const pair = createMemoryFs();
  const { authority, installStampClaims } = createOwnerVfsAuthorityComposition(pair.fsSync, {
    initialRoots: ['/', '/.rifty'],
  });
  const vfs = new SyncMirrorVfs();
  setSyncMirror(authority, { async: vfs });
  const stamps = createInstallStampAuthority({
    vfs,
    fsSync: authority,
    claimIo: installStampClaims,
  });
  const flush = () => authority.flush();
  const identity = (root: string) => ({ root, slug: 'app', packageJsonText: PACKAGE_JSON });
  const seed = async (root = ROOT) => {
    authority.mkdirSync(`${root}/node_modules/local`, { recursive: true });
    authority.writeFileSync(`${root}/package.json`, new TextEncoder().encode(PACKAGE_JSON));
    authority.writeFileSync(`${root}/node_modules/local/index.js`, new TextEncoder().encode('1\n'));
    const claim = await stamps.demote(identity(root), { flush });
    expect(
      await stamps.promote(identity(root), { epoch: claim.epoch, packages: 1, flush }),
    ).toMatchObject({ status: 'trusted' });
    await flush();
    expect(await stamps.check(identity(root))).toMatchObject({ status: 'trusted' });
    const bytes = installStampClaims.read(root);
    if (!bytes) throw new Error('reference trusted claim absent');
    return bytes.slice();
  };
  return {
    authority,
    claims: installStampClaims,
    stamps,
    rollback: stamps as unknown as RollbackAuthority,
    identity,
    flush,
    seed,
  };
}

afterEach(resetSyncMirror);

it('reconciles a proved byte-exact rollback through the same trusted claim authority', async () => {
  const h = harness();
  const before = await h.seed();
  const target = `${ROOT}/node_modules/local/index.js`;
  const priorFile = h.authority.readFileBytesSync(target).slice();
  await h.rollback.withRollback([ROOT], async (reconcile) => {
    await h.stamps.demote(h.identity(ROOT), { flush: h.flush });
    h.authority.writeFileSync(target, new TextEncoder().encode('changed\n'));
    await h.flush();
    h.authority.writeFileSync(target, priorFile);
    h.claims.write(ROOT, before, { mkdirTree: false });
    await h.flush();
    expect(await h.stamps.check(h.identity(ROOT))).toMatchObject({ status: 'pending' });
    await reconcile();
    expect(await h.stamps.check(h.identity(ROOT))).toMatchObject({ status: 'trusted' });
  });
  expect(h.authority.readFileBytesSync(target)).toEqual(priorFile);
  expect(h.claims.read(ROOT)).toEqual(before);
});

it('restores prior pending state but fences a promotion admitted before rollback capture', async () => {
  const h = harness();
  await h.seed();
  const oldClaim = await h.stamps.demote(h.identity(ROOT), { flush: h.flush });
  const pendingBytes = h.claims.read(ROOT);
  if (!pendingBytes) throw new Error('reference pending claim absent');
  const admitted = deferred();
  const release = deferred();
  const oldPromotion = h.stamps.promote(h.identity(ROOT), {
    epoch: oldClaim.epoch,
    packages: 1,
    flush: async () => {
      admitted.resolve();
      await release.promise;
      return h.flush();
    },
  });
  try {
    await admitted.promise;
    await h.rollback.withRollback([ROOT], async (reconcile) => {
      await h.stamps.demote(h.identity(ROOT), { flush: h.flush });
      h.claims.write(ROOT, pendingBytes, { mkdirTree: false });
      await h.flush();
      await reconcile();
      expect(await h.stamps.check(h.identity(ROOT))).toEqual({ status: 'pending' });
      release.resolve();
      expect(await oldPromotion).toEqual({ status: 'stale' });
      expect(await h.stamps.check(h.identity(ROOT))).toEqual({ status: 'pending' });
      expect(h.claims.read(ROOT)).toEqual(pendingBytes);
    });
  } finally {
    release.resolve();
    await oldPromotion;
  }
});

it('validates every captured claim before restoring trust to any root', async () => {
  const h = harness();
  const first = await h.seed();
  await h.seed(OTHER_ROOT);
  await h.rollback.withRollback([ROOT, OTHER_ROOT], async (reconcile) => {
    await h.stamps.demote(h.identity(ROOT), { flush: h.flush });
    await h.stamps.demote(h.identity(OTHER_ROOT), { flush: h.flush });
    h.claims.write(ROOT, first, { mkdirTree: false });
    await h.flush();
    await expect(reconcile()).rejects.toThrow(/claim|rollback/i);
    expect(await h.stamps.check(h.identity(ROOT))).toEqual({ status: 'pending' });
    expect(await h.stamps.check(h.identity(OTHER_ROOT))).toEqual({ status: 'pending' });
  });
});

it('preserves a prior absent phase even when captured storage contains trusted bytes', async () => {
  const h = harness();
  const prior = await h.seed();
  await h.stamps.revoke({ root: ROOT }, { flush: h.flush });
  h.claims.write(ROOT, prior, { mkdirTree: false });
  await h.flush();
  expect(await h.stamps.check(h.identity(ROOT))).toEqual({ status: 'absent' });
  await h.rollback.withRollback([ROOT], async (reconcile) => {
    await h.stamps.demote(h.identity(ROOT), { flush: h.flush });
    h.claims.write(ROOT, prior, { mkdirTree: false });
    await h.flush();
    await reconcile();
    expect(await h.stamps.check(h.identity(ROOT))).toEqual({ status: 'absent' });
  });
});

it('expires the captured rollback privilege when its operation exits', async () => {
  const h = harness();
  await h.seed();
  let retained: (() => Promise<void>) | undefined;
  await h.rollback.withRollback([ROOT], async (reconcile) => {
    retained = reconcile;
  });
  if (!retained) throw new Error('rollback callback was not supplied');
  await h.stamps.demote(h.identity(ROOT), { flush: h.flush });
  await expect(retained()).rejects.toThrow(/closed|expired|operation|rollback/i);
  expect(await h.stamps.check(h.identity(ROOT))).toEqual({ status: 'pending' });
});
