import { Buffer } from 'node:buffer';
import { TARBALL_CACHE_ROOT } from '@riftydev/npm-client';
import type { PersistFailureReport } from '@riftydev/vfs';
import { resetSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { readInstallStampSync, stampTrusted } from '../glue/install-stamp.ts';
import type { OpenedPlaygroundProject } from './playground-project-authority.ts';
import {
  DurableOwnerFs,
  type ExactFsTree,
  createDurableOwnerFsFromTree,
} from './test-fixtures/durable-owner-fs.ts';
import {
  type SavedSnapshotFixture,
  bakeSavedSnapshotFixture,
  installSnapshotNetwork,
  openSavedSnapshotOwner,
  savedSnapshotDefinition,
} from './test-fixtures/snapshot-saved-state.ts';

const id = 'rollback-project';
const root = `/.rifty/workbench/v1/projects/${id}/tree`;
const catalogFile = '/.rifty/workbench/playground/catalog.json';
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const editedSource = "console.log('saved source');\n";
let original: SavedSnapshotFixture;
let replacement: SavedSnapshotFixture;
beforeAll(async () => {
  original = await bakeSavedSnapshotFixture();
  replacement = await bakeSavedSnapshotFixture({
    description: 'new application manifest',
    assetUrl: 'https://host.test/rollback-replacement.tar.gz',
  });
  expect(replacement.snapshotId).not.toBe(original.snapshotId);
  expect(replacement.payload.packageJsonText).not.toBe(original.payload.packageJsonText);
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetSyncMirror();
});

type Owner = Awaited<ReturnType<typeof openSavedSnapshotOwner>>;

async function seedSavedState() {
  const network = installSnapshotNetwork(original, replacement);
  const h = await openSavedSnapshotOwner(network);
  let opened: OpenedPlaygroundProject | undefined;
  try {
    const scratch = savedSnapshotDefinition('scratch', original.descriptor);
    await h.catalog.createScratch({ definition: scratch });
    opened = await h.owner.openProject(scratch);
    expect(opened.acquisition).toMatchObject({
      kind: 'ready',
      provenance: { outcome: 'snapshot', snapshotId: original.snapshotId },
    });
    const sourceRoot = opened.projectRoot;
    const edits = [
      ['/main.cjs', editedSource],
      ['/node_modules/ms/index.js', 'saved modified dependency\n'],
      ['/node_modules/ms/local.txt', 'saved local dependency extra\n'],
      ['/user.txt', 'saved unrelated file\n'],
    ] as const;
    await h.packages.mutations.guardedMutation(
      edits.map(([path]) => ({ kind: 'write' as const, path: `${sourceRoot}${path}` })),
      async () => {
        for (const [path, text] of edits)
          h.authority.writeFileSync(`${sourceRoot}${path}`, encoder.encode(text));
      },
    );
    await h.owner.recordMutation({
      project: opened,
      kind: 'file',
      treeRevision: h.authority.treeRevision,
    });
    const editedStamp = readInstallStampSync(h.authority, sourceRoot);
    expect(editedStamp !== null && stampTrusted(editedStamp)).toBe(true);
    await opened.close();
    opened = undefined;
    const definition = savedSnapshotDefinition(id, original.descriptor);
    await h.catalog.saveScratch({ id, name: 'Rollback project', definition });
    opened = await h.owner.openProject(definition);
    expect(opened.acquisition).toMatchObject({
      kind: 'ready',
      provenance: { outcome: 'existing' },
    });
    await opened.close();
    opened = undefined;
    expect(network.requests).toEqual([original.descriptor.assetUrl]);
    await h.authority.flush();
    expect(h.fs.liveSnapshot()).toEqual(h.fs.durableSnapshot());
    const claim = h.installStampClaims.read(root);
    expect(claim).not.toBeNull();
    return { tree: h.fs.durableSnapshot(), catalog: h.catalog.snapshot(), claim };
  } finally {
    await opened?.close();
    await h.close();
  }
}

async function attemptApply(h: Owner, artifact: SavedSnapshotFixture) {
  let opened: OpenedPlaygroundProject | undefined;
  let failure: unknown;
  try {
    const definition = savedSnapshotDefinition(id, artifact.descriptor, {
      packageJsonText: artifact.payload.packageJsonText,
      application: { mode: 'apply-snapshot', conflict: 'overwrite' },
    });
    opened = await h.owner.openProject(definition);
  } catch (error) {
    failure = error;
  }
  return { opened, failure };
}

function expectApplied(h: Owner, artifact: SavedSnapshotFixture): void {
  const payloadFiles: [string, Uint8Array][] = [
    ['/package.json', encoder.encode(artifact.payload.packageJsonText)],
    ['/package-lock.json', encoder.encode(artifact.payload.lockfile)],
    ...artifact.payload.nodeModules.files.map((file): [string, Uint8Array] => [
      `/node_modules/${file.path}`,
      Uint8Array.from(atob(file.content), (character) => character.charCodeAt(0)),
    ]),
  ];
  for (const [path, bytes] of payloadFiles) {
    expect(h.authority.statSyncOrNull(`${root}${path}`)?.isFile, path).toBe(true);
    expect(Buffer.compare(h.authority.readFileBytesSync(`${root}${path}`), bytes), path).toBe(0);
  }
  for (const [path, text] of [
    ['/main.cjs', editedSource],
    ['/user.txt', 'saved unrelated file\n'],
    ['/node_modules/ms/local.txt', 'saved local dependency extra\n'],
  ])
    expect(decoder.decode(h.authority.readFileBytesSync(`${root}${path}`))).toBe(text);
  const stamp = readInstallStampSync(h.authority, root);
  expect(stamp !== null && stampTrusted(stamp)).toBe(true);
  expect(stamp).toMatchObject({
    root,
    slug: id,
    packageJsonText: artifact.payload.packageJsonText,
  });
  expect(h.fs.pendingPrimitiveCount).toBe(0);
}

function isSharedCache(path: string): boolean {
  return path === TARBALL_CACHE_ROOT || path.startsWith(`${TARBALL_CACHE_ROOT}/`);
}

function expectExactTree(actual: ExactFsTree, expected: ExactFsTree): void {
  expect.soft(actual.directories).toEqual(expected.directories);
  expect.soft(Object.keys(actual.files)).toEqual(Object.keys(expected.files));
  for (const [path, bytes] of Object.entries(expected.files)) {
    const found = actual.files[path];
    expect.soft(found !== undefined, path).toBe(true);
    if (found !== undefined) expect.soft(Buffer.compare(found, bytes), path).toBe(0);
  }
}

/** Failed IO may retain verified new shared-cache entries, never change prior entries. */
function expectRollback(
  actual: ExactFsTree,
  before: ExactFsTree,
  artifact: SavedSnapshotFixture,
): void {
  const projectState = (tree: ExactFsTree): ExactFsTree => ({
    directories: tree.directories.filter((path) => !isSharedCache(path)),
    files: Object.fromEntries(Object.entries(tree.files).filter(([path]) => !isSharedCache(path))),
  });
  expectExactTree(projectState(actual), projectState(before));
  const allowedDirectories = new Set([
    TARBALL_CACHE_ROOT,
    ...before.directories.filter(isSharedCache),
  ]);
  const allowedFiles = new Map(
    Object.entries(before.files).filter(([path]) => isSharedCache(path)),
  );
  for (const file of artifact.payload.tarballCache.files) {
    const path = `${artifact.payload.tarballCache.root}/${file.path}`;
    if (!allowedFiles.has(path))
      allowedFiles.set(
        path,
        Uint8Array.from(atob(file.content), (character) => character.charCodeAt(0)),
      );
    let parent = path.slice(0, path.lastIndexOf('/'));
    while (isSharedCache(parent)) {
      allowedDirectories.add(parent);
      parent = parent.slice(0, parent.lastIndexOf('/'));
    }
  }
  for (const path of before.directories.filter(isSharedCache))
    expect.soft(actual.directories).toContain(path);
  for (const path of actual.directories.filter(isSharedCache))
    expect.soft(allowedDirectories.has(path), path).toBe(true);
  for (const [path, bytes] of Object.entries(before.files).filter(([path]) =>
    isSharedCache(path),
  )) {
    const found = actual.files[path];
    expect.soft(found !== undefined, path).toBe(true);
    if (found !== undefined) expect.soft(Buffer.compare(found, bytes), path).toBe(0);
  }
  for (const [path, bytes] of Object.entries(actual.files).filter(([path]) =>
    isSharedCache(path),
  )) {
    const allowed = allowedFiles.get(path);
    expect.soft(allowed !== undefined, `only verified cache addition: ${path}`).toBe(true);
    if (allowed !== undefined) expect.soft(Buffer.compare(bytes, allowed), path).toBe(0);
  }
}

async function referencePointerOrdinal(
  before: ExactFsTree,
  artifact: SavedSnapshotFixture,
): Promise<number> {
  const network = installSnapshotNetwork(original, replacement);
  const reference = await openSavedSnapshotOwner(network, createDurableOwnerFsFromTree(before));
  let result: Awaited<ReturnType<typeof attemptApply>> | undefined;
  try {
    expect(reference.fs.pendingPrimitiveCount).toBe(0);
    reference.fs.armPersistFailure(Number.MAX_SAFE_INTEGER, 'quota-report');
    result = await attemptApply(reference, artifact);
    reference.fs.disarmPersistFailure();
    expect(
      result.failure,
      'successful real reference application must precede fault selection',
    ).toBeUndefined();
    expect(result.opened?.acquisition).toMatchObject({
      kind: 'ready',
      provenance: { outcome: 'snapshot', snapshotId: artifact.snapshotId },
    });
    expectApplied(reference, artifact);
    expect(network.requests).toEqual([artifact.descriptor.assetUrl]);
    const committedCatalog = reference.fs.durableSnapshot().files[catalogFile];
    expect(committedCatalog).toBeDefined();
    const pointer = reference.fs.trace.find(
      (entry) =>
        entry.outcome === 'success' &&
        entry.primitive.kind === 'write' &&
        entry.primitive.path === catalogFile &&
        entry.primitive.bytes !== undefined &&
        committedCatalog !== undefined &&
        Buffer.compare(entry.primitive.bytes, committedCatalog) === 0,
    );
    expect(pointer, 'trace must contain the durable catalog pointer write').toBeDefined();
    if (pointer === undefined) throw new Error('reference catalog pointer not found');
    return pointer.ordinal;
  } finally {
    reference.fs.disarmPersistFailure();
    await result?.opened?.close();
    await reference.close();
  }
}

/** External persistence denial only; live VFS and every owner method remain real. */
class PermissionLostOwnerFs extends DurableOwnerFs {
  permissionLost = false;

  constructor(tree: ExactFsTree) {
    super();
    for (const directory of tree.directories) this.mkdirSync(directory, { recursive: true });
    for (const [path, bytes] of Object.entries(tree.files)) {
      this.mkdirSync(path.slice(0, path.lastIndexOf('/')) || '/', { recursive: true });
      this.writeFileSync(path, bytes.slice());
    }
    this.sealDurableState();
  }

  override async flush(): Promise<PersistFailureReport> {
    if (this.permissionLost) throw new Error('permission denied: persistence remains unavailable');
    try {
      return await super.flush();
    } catch (error) {
      if (this.didInjectFailure) this.permissionLost = true;
      throw error;
    }
  }

  releasePermission(): void {
    this.disarmPersistFailure();
    this.permissionLost = false;
  }
}

function isPermissionFailure(error: unknown): boolean {
  if (error instanceof AggregateError) {
    return (
      error.errors.length > 0 &&
      error.errors.every(isPermissionFailure) &&
      (error.cause === undefined || isPermissionFailure(error.cause))
    );
  }
  return (
    error instanceof Error &&
    (/permission denied/i.test(error.message) ||
      (error.cause !== undefined && isPermissionFailure(error.cause)))
  );
}

async function closeWithPermissionLost(h: Owner): Promise<void> {
  try {
    await h.close();
  } catch (error) {
    if (!isPermissionFailure(error)) throw error;
  }
}

describe('I8 explicit snapshot rollback restores same-owner saved admission', () => {
  it.each(['same', 'new'] as const)(
    '%s ID catalog-pointer failure restores exact old state, then same-owner default open and explicit retry work',
    async (identity) => {
      const artifact = identity === 'same' ? original : replacement;
      const before = await seedSavedState();
      const pointerOrdinal = await referencePointerOrdinal(before.tree, artifact);

      const network = installSnapshotNetwork(original, replacement);
      const fault = await openSavedSnapshotOwner(
        network,
        createDurableOwnerFsFromTree(before.tree),
      );
      let failed: Awaited<ReturnType<typeof attemptApply>> | undefined;
      let warm: OpenedPlaygroundProject | undefined;
      let retry: Awaited<ReturnType<typeof attemptApply>> | undefined;
      try {
        expectExactTree(fault.fs.durableSnapshot(), before.tree);
        expect(fault.fs.pendingPrimitiveCount).toBe(0);
        fault.fs.armPersistFailure(pointerOrdinal, 'quota-report');
        failed = await attemptApply(fault, artifact);
        fault.fs.disarmPersistFailure();
        expect(fault.fs.didInjectFailure).toBe(true);
        expect(fault.fs.trace.find((entry) => entry.outcome === 'injected-failure')).toMatchObject({
          ordinal: pointerOrdinal,
          primitive: { kind: 'write', path: catalogFile },
        });
        expect.soft(failed.failure).toBeInstanceOf(Error);
        expect.soft(String(failed.failure)).toMatch(/persist|quota/i);
        expect.soft(failed.opened).toBeUndefined();
        await failed.opened?.close();
        expect.soft(network.requests).toEqual([artifact.descriptor.assetUrl]);
        expect.soft(fault.catalog.snapshot()).toEqual(before.catalog);
        expect.soft(fault.installStampClaims.read(root)).toEqual(before.claim);
        expectRollback(fault.fs.liveSnapshot(), before.tree, artifact);
        expectRollback(fault.fs.durableSnapshot(), before.tree, artifact);
        expect.soft(fault.fs.pendingPrimitiveCount).toBe(0);

        const beforeWarm = fault.fs.durableSnapshot();
        network.requests.length = 0;
        let warmFailure: unknown;
        try {
          warm = await fault.owner.openProject(
            savedSnapshotDefinition(id, {
              ...original.descriptor,
              assetUrl: 'https://host.test/unavailable-after-rollback.tar.gz',
            }),
          );
        } catch (error) {
          warmFailure = error;
        }
        expect
          .soft(warmFailure, 'same owner must reconcile old claim AND prior manifest configuration')
          .toBeUndefined();
        expect
          .soft(warm?.acquisition)
          .toMatchObject({ kind: 'ready', provenance: { outcome: 'existing' } });
        expect
          .soft(network.requests, 'warm rollback admission must not fetch the unavailable asset')
          .toEqual([]);
        expectExactTree(fault.fs.liveSnapshot(), beforeWarm);
        expectExactTree(fault.fs.durableSnapshot(), beforeWarm);
        await warm?.close();
        warm = undefined;

        network.requests.length = 0;
        retry = await attemptApply(fault, artifact);
        expect(retry.failure, 'same owner explicit application retry').toBeUndefined();
        expect(retry.opened?.acquisition).toMatchObject({
          kind: 'ready',
          provenance: { outcome: 'snapshot', snapshotId: artifact.snapshotId },
        });
        expect(network.requests).toEqual([artifact.descriptor.assetUrl]);
        expectApplied(fault, artifact);
      } finally {
        fault.fs.disarmPersistFailure();
        await warm?.close();
        await retry?.opened?.close();
        await failed?.opened?.close();
        await fault.close();
      }
    },
    30_000,
  );

  it('unproved rollback fences same-owner open/apply without effects until fresh-owner durable recovery', async () => {
    const before = await seedSavedState();
    const pointerOrdinal = await referencePointerOrdinal(before.tree, original);
    const network = installSnapshotNetwork(original, replacement);
    const fs = new PermissionLostOwnerFs(before.tree);
    const fault = await openSavedSnapshotOwner(network, fs);
    let failed: Awaited<ReturnType<typeof attemptApply>> | undefined;
    let refusedApply: Awaited<ReturnType<typeof attemptApply>> | undefined;
    let refusedOpen: OpenedPlaygroundProject | undefined;
    let closed = false;
    try {
      expectExactTree(fs.durableSnapshot(), before.tree);
      fs.armPersistFailure(pointerOrdinal, 'permission-rejection');
      failed = await attemptApply(fault, original);
      expect(fs.permissionLost).toBe(true);
      expect(fs.trace.find((entry) => entry.outcome === 'injected-failure')).toMatchObject({
        ordinal: pointerOrdinal,
        primitive: { kind: 'write', path: catalogFile },
      });
      expect.soft(failed.failure).toBeInstanceOf(Error);
      expect.soft(String(failed.failure)).toMatch(/permission|persist/i);
      expect.soft(failed.opened).toBeUndefined();
      await failed.opened?.close();
      expect.soft(network.requests).toEqual([original.descriptor.assetUrl]);

      const durableAtFence = fs.durableSnapshot();
      const liveAtFence = fs.liveSnapshot();
      const pendingAtFence = fs.pendingPrimitiveCount;
      const revisionAtFence = fault.authority.treeRevision;
      const traceLengthAtFence = fs.trace.length;
      const journal = '/.rifty/workbench/playground/transaction.json';
      expect(durableAtFence.files[journal], 'retain the real recovery journal').toBeDefined();
      expect(durableAtFence.files[catalogFile]).toEqual(before.tree.files[catalogFile]);
      const savedIndex = before.tree.files[`${root}/node_modules/ms/index.js`];
      expect(savedIndex).toBeDefined();
      const beforeCopy = Object.entries(durableAtFence.files).find(
        ([path, bytes]) =>
          path.startsWith('/.rifty/workbench/playground/catalog-transactions/') &&
          path.includes('/before/') &&
          path.endsWith('/tree/node_modules/ms/index.js') &&
          savedIndex !== undefined &&
          Buffer.compare(bytes, savedIndex) === 0,
      );
      expect(beforeCopy, 'retain the actual durable before-stage bytes').toBeDefined();
      expect(durableAtFence.files[`${root}/node_modules/ms/index.js`]).not.toEqual(savedIndex);
      expect.soft(fault.catalog.snapshot()).toEqual(before.catalog);

      network.requests.length = 0;
      let openFailure: unknown;
      try {
        refusedOpen = await fault.owner.openProject(
          savedSnapshotDefinition(id, {
            ...original.descriptor,
            assetUrl: 'https://host.test/unavailable-while-fenced.tar.gz',
          }),
        );
      } catch (error) {
        openFailure = error;
      }
      expect
        .soft(openFailure, 'an unproved rollback cannot readmit a saved project')
        .toBeInstanceOf(Error);
      expect.soft(refusedOpen).toBeUndefined();
      await refusedOpen?.close();
      refusedOpen = undefined;
      refusedApply = await attemptApply(fault, original);
      expect
        .soft(refusedApply.failure, 'a new apply cannot replace the pending recovery journal')
        .toBeInstanceOf(Error);
      expect.soft(refusedApply.opened).toBeUndefined();
      await refusedApply.opened?.close();
      expect.soft(network.requests).toEqual([]);
      expect.soft(fault.catalog.snapshot()).toEqual(before.catalog);
      expectExactTree(fs.liveSnapshot(), liveAtFence);
      expectExactTree(fs.durableSnapshot(), durableAtFence);
      expect.soft(fs.pendingPrimitiveCount).toBe(pendingAtFence);
      expect.soft(fault.authority.treeRevision).toBe(revisionAtFence);
      expect.soft(fs.trace.length).toBe(traceLengthAtFence);

      await closeWithPermissionLost(fault);
      closed = true;
      expectExactTree(fs.durableSnapshot(), durableAtFence);
      fs.releasePermission();
      const recoveredNetwork = installSnapshotNetwork(original, replacement);
      // Read the actual persisted state, never the dying owner's unflushed mirror.
      const recovered = await openSavedSnapshotOwner(
        recoveredNetwork,
        createDurableOwnerFsFromTree(fs.durableSnapshot()),
      );
      let opened: OpenedPlaygroundProject | undefined;
      try {
        expectRollback(recovered.fs.liveSnapshot(), before.tree, original);
        expectRollback(recovered.fs.durableSnapshot(), before.tree, original);
        expect(recovered.catalog.snapshot()).toEqual(before.catalog);
        expect(recovered.installStampClaims.read(root)).toEqual(before.claim);
        opened = await recovered.owner.openProject(
          savedSnapshotDefinition(id, {
            ...original.descriptor,
            assetUrl: 'https://host.test/unavailable-after-recovery.tar.gz',
          }),
        );
        expect(opened.acquisition).toMatchObject({
          kind: 'ready',
          provenance: { outcome: 'existing' },
        });
        expect(recoveredNetwork.requests).toEqual([]);
        expectRollback(recovered.fs.durableSnapshot(), before.tree, original);
      } finally {
        await opened?.close();
        await recovered.close();
      }
    } finally {
      await refusedOpen?.close();
      await refusedApply?.opened?.close();
      await failed?.opened?.close();
      if (!closed) await closeWithPermissionLost(fault);
      fs.releasePermission();
    }
  }, 30_000);
});
