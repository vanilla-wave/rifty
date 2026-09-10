import { serializePackageJson } from '@riftydev/npm-client';
import type { PersistFailureReport } from '@riftydev/vfs';
import { resetSyncMirror, setSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { restoreDepSnapshot } from '../glue/dep-snapshot.ts';
import { createInstallStampAuthority } from '../glue/install-stamp-authority.ts';
import { installStampPath, readInstallStampSync, stampTrusted } from '../glue/install-stamp.ts';
import { SyncMirrorVfs } from '../glue/sync-mirror-vfs.ts';
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

const prefix = '/workspaces/snapshot_legacy';
const legacyIndex = `${prefix}/.rifty-project-index.json`;
const catalogFile = '/.rifty/workbench/playground/catalog.json';
const migrationJournal = '/.rifty/workbench/playground/migration-journal.json';
const siblingId = 'legacy-sibling';
const siblingRoot = `${prefix}/projects/${siblingId}`;
const sourceText = "console.log('retained legacy source');\n";
const encoder = new TextEncoder();
const decoder = new TextDecoder();
let fixture: SavedSnapshotFixture;
beforeAll(async () => {
  fixture = await bakeSavedSnapshotFixture();
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetSyncMirror();
});

function write(fs: DurableOwnerFs, path: string, contents: string | Uint8Array): void {
  fs.mkdirSync(path.slice(0, path.lastIndexOf('/')), { recursive: true });
  fs.writeFileSync(path, typeof contents === 'string' ? encoder.encode(contents) : contents);
}

/** Historical input: real snapshot bytes and real root-bound claims, before guest edits. */
async function historicalProject(fs: DurableOwnerFs, root: string, slug: string): Promise<void> {
  write(fs, `${root}/package.json`, fixture.payload.packageJsonText);
  const vfs = new SyncMirrorVfs();
  setSyncMirror(fs, { async: vfs });
  const stamps = createInstallStampAuthority({ vfs, fsSync: fs });
  const claim = await stamps.demote({ root, slug }, { flush: () => fs.flush() });
  await stamps.prepareTreeMutation(claim);
  await restoreDepSnapshot(fs, root, fixture.payload);
  await expect(
    stamps.promote(
      { root, slug, packageJsonText: fixture.payload.packageJsonText },
      { epoch: claim.epoch, packages: fixture.payload.packages, flush: () => fs.flush() },
    ),
  ).resolves.toMatchObject({ status: 'trusted' });
}

async function seedLegacy(
  id: 'scratch' | 'legacy-project',
  additional: SavedSnapshotFixture[] = [],
  pendingSibling = false,
) {
  const network = installSnapshotNetwork(fixture, ...additional);
  const fs = new DurableOwnerFs();
  const sourceRoot = id === 'scratch' ? `${prefix}/scratch` : `${prefix}/projects/${id}`;
  await historicalProject(fs, sourceRoot, id);
  await historicalProject(fs, `${sourceRoot}/packages/local`, 'local');
  write(fs, `${sourceRoot}/main.cjs`, sourceText);
  write(fs, `${sourceRoot}/user.txt`, 'legacy user bytes\n');
  write(fs, `${sourceRoot}/node_modules/ms/local.txt`, 'legacy dependency extra\n');
  write(fs, `${sourceRoot}/node_modules/unlisted/readme.txt`, 'unlisted package bytes\n');
  write(fs, `${sourceRoot}/.git/objects/ab/cd`, new Uint8Array([0, 255, 129, 7]));
  fs.mkdirSync(`${sourceRoot}/empty-local`, { recursive: true });
  fs.mkdirSync(`${sourceRoot}/node_modules/ms/empty-local`, { recursive: true });
  const manifest = JSON.parse(fixture.payload.packageJsonText) as Record<string, unknown>;
  write(
    fs,
    `${sourceRoot}/package.json`,
    serializePackageJson({ ...manifest, description: 'legacy local manifest' }),
  );
  write(fs, `${sourceRoot}/node_modules/ms/index.js`, 'legacy local dependency bytes\n');
  const editedAt = '2026-09-01T00:00:00.000Z';
  if (pendingSibling) {
    await historicalProject(fs, siblingRoot, siblingId);
    write(fs, `${siblingRoot}/main.cjs`, 'unadopted sibling source\n');
    write(fs, `${siblingRoot}/user.bin`, new Uint8Array([129, 0, 255, 17]));
    write(fs, `${siblingRoot}/node_modules/ms/local.txt`, 'unadopted sibling package extra\n');
    fs.mkdirSync(`${siblingRoot}/empty-sibling`, { recursive: true });
  }
  write(
    fs,
    legacyIndex,
    JSON.stringify({
      activeId: id,
      scratch: id === 'scratch' ? { starter: 'saved-ms-starter', dirty: true, editedAt } : null,
      projects: [
        ...(id === 'scratch'
          ? []
          : [{ id, name: 'Legacy project', starter: 'saved-ms-starter', editedAt }]),
        ...(pendingSibling
          ? [{ id: siblingId, name: 'Pending sibling', starter: 'saved-ms-starter', editedAt }]
          : []),
      ],
    }),
  );
  await fs.flush();
  const h = await openSavedSnapshotOwner(network, fs.restartFromDurableState(), prefix);
  expect(network.requests).toEqual([]);
  expect(h.catalog.snapshot().active).toEqual(
    id === 'scratch' ? { kind: 'scratch' } : { kind: 'project', id },
  );
  const catalog = JSON.parse(decoder.decode(h.authority.readFileBytesSync(catalogFile))) as {
    readonly scratch: { readonly adoption: unknown } | null;
    readonly projects: readonly { readonly id: string; readonly adoption: unknown }[];
  };
  const entry =
    id === 'scratch' ? catalog.scratch : catalog.projects.find((project) => project.id === id);
  expect(entry?.adoption).toEqual({ kind: 'pending-adoption', sourceRoot });
  expect(h.fs.liveSnapshot()).toEqual(h.fs.durableSnapshot());
  return { ...h, network, sourceRoot, id };
}

type LegacyHarness = Awaited<ReturnType<typeof seedLegacy>>;

async function openLegacy(h: LegacyHarness, conflict?: 'error' | 'overwrite') {
  let opened: OpenedPlaygroundProject | undefined;
  let failure: unknown;
  try {
    const definition = savedSnapshotDefinition(h.id, fixture.descriptor, {
      source: "console.log('must not replace legacy source');\n",
      ...(conflict === undefined
        ? {}
        : { application: { mode: 'apply-snapshot' as const, conflict } }),
    });
    opened = await h.owner.openProject(definition);
  } catch (error) {
    failure = error;
  }
  return { opened, failure };
}

function expectRetainedFiles(h: LegacyHarness, root: string): void {
  for (const [path, contents] of [
    ['/main.cjs', sourceText],
    ['/user.txt', 'legacy user bytes\n'],
    ['/node_modules/ms/local.txt', 'legacy dependency extra\n'],
    ['/node_modules/unlisted/readme.txt', 'unlisted package bytes\n'],
    ['/packages/local/package.json', fixture.payload.packageJsonText],
    ['/packages/local/package-lock.json', fixture.payload.lockfile],
  ]) {
    const stat = h.authority.statSyncOrNull(`${root}${path}`);
    expect.soft(stat?.isFile, `retained legacy ${path}`).toBe(true);
    if (stat?.isFile)
      expect.soft(decoder.decode(h.authority.readFileBytesSync(`${root}${path}`))).toBe(contents);
  }
  for (const path of ['/empty-local', '/node_modules/ms/empty-local']) {
    expect.soft(h.authority.statSyncOrNull(`${root}${path}`)?.isDirectory, path).toBe(true);
  }
  const gitFile = `${root}/.git/objects/ab/cd`;
  expect.soft(h.authority.statSyncOrNull(gitFile)?.isFile).toBe(true);
  if (h.authority.statSyncOrNull(gitFile)?.isFile)
    expect.soft(h.authority.readFileBytesSync(gitFile)).toEqual(new Uint8Array([0, 255, 129, 7]));
  for (const file of fixture.payload.nodeModules.files) {
    for (const base of [root, `${root}/packages/local`]) {
      const path = `${base}/node_modules/${file.path}`;
      const stat = h.authority.statSyncOrNull(path);
      expect.soft(stat?.isFile, path).toBe(true);
      if (stat?.isFile)
        expect
          .soft(h.authority.readFileBytesSync(path))
          .toEqual(Uint8Array.from(atob(file.content), (char) => char.charCodeAt(0)));
    }
  }
  expect
    .soft(
      h.authority.existsSync(installStampPath(`${root}/packages/local`)),
      'nested source claim must not transfer',
    )
    .toBe(false);
}

describe('I8 snapshot policy preserves pending legacy adoption', () => {
  it.each(['scratch', 'legacy-project'] as const)(
    'default %s open fails without fetching or changing any pre-open bytes',
    async (id) => {
      const h = await seedLegacy(id);
      const before = h.fs.durableSnapshot();
      let result: Awaited<ReturnType<typeof openLegacy>> | undefined;
      try {
        result = await openLegacy(h);
        expect
          .soft(result.failure, 'pending legacy adoption is saved incompatible state')
          .toBeInstanceOf(Error);
        expect.soft(result.opened).toBeUndefined();
        expect.soft(h.network.requests).toEqual([]);
        expect
          .soft(h.fs.liveSnapshot(), 'do not adopt/copy/delete before saved-state admission')
          .toEqual(before);
        expect
          .soft(h.fs.durableSnapshot(), 'preserve full legacy source, index, claims and catalog')
          .toEqual(before);
      } finally {
        await result?.opened?.close();
        await h.close();
      }
    },
  );

  it('explicit error reports original manifest and dependency conflicts before legacy copy/delete', async () => {
    const h = await seedLegacy('legacy-project');
    const before = h.fs.durableSnapshot();
    let result: Awaited<ReturnType<typeof openLegacy>> | undefined;
    try {
      result = await openLegacy(h, 'error');
      expect.soft(result.failure).toMatchObject({
        name: 'SnapshotApplicationConflictError',
        conflictingPaths: expect.arrayContaining(['/package.json', '/node_modules/ms/index.js']),
      });
      expect.soft(result.opened).toBeUndefined();
      expect.soft(h.network.requests).toEqual([fixture.descriptor.assetUrl]);
      expect.soft(h.fs.liveSnapshot()).toEqual(before);
      expect.soft(h.fs.durableSnapshot()).toEqual(before);
      expect.soft(h.authority.existsSync(h.sourceRoot)).toBe(true);
    } finally {
      await result?.opened?.close();
      await h.close();
    }
  });

  it('explicit overwrite adopts real payload, retains extras/empty directories, excludes source claims and reopens trusted', async () => {
    const h = await seedLegacy('legacy-project');
    const sourceClaim = h.authority.readFileBytesSync(installStampPath(h.sourceRoot));
    let result: Awaited<ReturnType<typeof openLegacy>> | undefined;
    try {
      result = await openLegacy(h, 'overwrite');
      expect.soft(result.failure).toBeUndefined();
      expect.soft(result.opened?.acquisition).toMatchObject({
        kind: 'ready',
        provenance: { outcome: 'snapshot', snapshotId: fixture.snapshotId },
      });
      expect.soft(h.network.requests).toEqual([fixture.descriptor.assetUrl]);
      if (result.opened === undefined) return;
      const root = result.opened.projectRoot;
      expect.soft(root).toBe('/.rifty/workbench/v1/projects/legacy-project/tree');
      expectRetainedFiles(h, root);
      expect
        .soft(decoder.decode(h.authority.readFileBytesSync(`${root}/package.json`)))
        .toBe(fixture.payload.packageJsonText);
      expect
        .soft(decoder.decode(h.authority.readFileBytesSync(`${root}/package-lock.json`)))
        .toBe(fixture.payload.lockfile);
      const stamp = readInstallStampSync(h.authority, root);
      expect.soft(stamp !== null && stampTrusted(stamp)).toBe(true);
      expect.soft(stamp).toMatchObject({ root, slug: h.id, packages: fixture.payload.packages });
      expect.soft(h.installStampClaims.read(root)).not.toEqual(sourceClaim);
      expect.soft(h.authority.existsSync(h.sourceRoot)).toBe(false);
      await result.opened.close();
      await h.close();
      h.network.requests.length = 0;
      const restarted = await openSavedSnapshotOwner(
        h.network,
        h.fs.restartFromDurableState(),
        prefix,
      );
      let reopened: OpenedPlaygroundProject | undefined;
      try {
        reopened = await restarted.owner.openProject(
          savedSnapshotDefinition(h.id, fixture.descriptor),
        );
        expect.soft(reopened.acquisition).toMatchObject({ kind: 'saved' });
        expect.soft(h.network.requests).toEqual([]);
        expectRetainedFiles({ ...h, ...restarted }, reopened.projectRoot);
        expect.soft(restarted.authority.existsSync(h.sourceRoot)).toBe(false);
      } finally {
        await reopened?.close();
        await restarted.close();
      }
    } finally {
      await result?.opened?.close();
      await h.close();
    }
  });
});

function projectTree(tree: ExactFsTree, root: string): ExactFsTree {
  const belongs = (path: string) => path === root || path.startsWith(`${root}/`);
  return {
    directories: tree.directories.filter(belongs),
    files: Object.fromEntries(Object.entries(tree.files).filter(([path]) => belongs(path))),
  };
}

function pendingSiblingState(tree: ExactFsTree) {
  const catalog = JSON.parse(decoder.decode(tree.files[catalogFile])) as {
    readonly projects: readonly { readonly id: string; readonly adoption: unknown }[];
  };
  const journal = JSON.parse(decoder.decode(tree.files[migrationJournal])) as {
    readonly refs: readonly { readonly id: string; readonly phase: unknown }[];
  };
  return {
    source: projectTree(tree, siblingRoot),
    target: projectTree(tree, `/.rifty/workbench/v1/projects/${siblingId}`),
    index: tree.files[legacyIndex],
    catalog: catalog.projects.find((project) => project.id === siblingId),
    journal: journal.refs.find((ref) => ref.id === siblingId),
  };
}

function expectPendingSibling(
  h: Pick<LegacyHarness, 'fs'>,
  before: ReturnType<typeof pendingSiblingState> | undefined,
): void {
  if (before === undefined) return;
  expect(before.source.directories).toContain(siblingRoot);
  expect(before.target).toEqual({ directories: [], files: {} });
  expect(before.index).toBeDefined();
  expect(before.catalog).toMatchObject({
    id: siblingId,
    adoption: { kind: 'pending-adoption', sourceRoot: siblingRoot },
  });
  expect(before.journal).toMatchObject({ id: siblingId, phase: { kind: 'pending' } });
  expect(pendingSiblingState(h.fs.liveSnapshot())).toEqual(before);
  expect(pendingSiblingState(h.fs.durableSnapshot())).toEqual(before);
}

describe('I8 legacy projects remain usable after adoption', () => {
  it.each([false, true])(
    'reopens a legacy project after a second explicit apply changes its snapshot identity (pending sibling=%s)',
    async (pendingSibling) => {
      const replacement = await bakeSavedSnapshotFixture({
        description: 'replacement after completed legacy adoption',
        assetUrl: 'https://host.test/legacy-replacement.tar.gz',
      });
      expect(replacement.snapshotId).not.toBe(fixture.snapshotId);
      expect(replacement.payload.packageJsonText).not.toBe(fixture.payload.packageJsonText);
      const h = await seedLegacy('legacy-project', [replacement], pendingSibling);
      const siblingBefore = pendingSibling
        ? pendingSiblingState(h.fs.durableSnapshot())
        : undefined;
      expectPendingSibling(h, siblingBefore);
      let opened: OpenedPlaygroundProject | undefined;
      let restarted: Awaited<ReturnType<typeof openSavedSnapshotOwner>> | undefined;
      try {
        const adopted = await openLegacy(h, 'overwrite');
        expect(adopted.failure, 'initial explicit legacy adoption must succeed').toBeUndefined();
        opened = adopted.opened;
        if (opened === undefined) throw new Error('legacy adoption did not return a session');
        expect(opened.acquisition).toMatchObject({
          kind: 'ready',
          provenance: { outcome: 'snapshot', snapshotId: fixture.snapshotId },
        });
        const root = opened.projectRoot;
        expectRetainedFiles(h, root);
        expect(h.authority.existsSync(h.sourceRoot)).toBe(false);
        expectPendingSibling(h, siblingBefore);
        await opened.close();
        opened = undefined;

        opened = await h.owner.openProject(
          savedSnapshotDefinition(h.id, replacement.descriptor, {
            packageJsonText: replacement.payload.packageJsonText,
            source: "console.log('must not replace legacy source');\n",
            application: { mode: 'apply-snapshot', conflict: 'overwrite' },
          }),
        );
        expect(opened.acquisition).toMatchObject({
          kind: 'ready',
          provenance: { outcome: 'snapshot', snapshotId: replacement.snapshotId },
        });
        expect(h.network.requests).toEqual([
          fixture.descriptor.assetUrl,
          replacement.descriptor.assetUrl,
        ]);
        expectRetainedFiles(h, root);
        expect(decoder.decode(h.authority.readFileBytesSync(`${root}/package.json`))).toBe(
          replacement.payload.packageJsonText,
        );
        expect(decoder.decode(h.authority.readFileBytesSync(`${root}/package-lock.json`))).toBe(
          replacement.payload.lockfile,
        );
        const stamp = readInstallStampSync(h.authority, root);
        expect(stamp !== null && stampTrusted(stamp)).toBe(true);
        expect(stamp).toMatchObject({
          root,
          slug: h.id,
          packageJsonText: replacement.payload.packageJsonText,
        });
        await h.authority.flush();
        expectPendingSibling(h, siblingBefore);
        const before = projectTree(h.fs.durableSnapshot(), root);
        const catalogBefore = h.catalog.snapshot();
        await opened.close();
        opened = undefined;
        await h.close();

        h.network.requests.length = 0;
        restarted = await openSavedSnapshotOwner(h.network, h.fs.restartFromDurableState(), prefix);
        expectPendingSibling(restarted, siblingBefore);
        opened = await restarted.owner.openProject(
          savedSnapshotDefinition(h.id, replacement.descriptor, {
            packageJsonText: replacement.payload.packageJsonText,
          }),
        );
        expect(opened.acquisition).toMatchObject({ kind: 'saved' });
        expect(h.network.requests).toEqual([]);
        expect(restarted.catalog.snapshot()).toEqual(catalogBefore);
        expect(projectTree(restarted.fs.liveSnapshot(), root)).toEqual(before);
        expect(projectTree(restarted.fs.durableSnapshot(), root)).toEqual(before);
        expectRetainedFiles({ ...h, ...restarted }, root);
        expect(restarted.authority.existsSync(h.sourceRoot)).toBe(false);
        const reopenedStamp = readInstallStampSync(restarted.authority, root);
        expect(reopenedStamp !== null && stampTrusted(reopenedStamp)).toBe(true);
        expectPendingSibling(restarted, siblingBefore);
      } finally {
        await opened?.close();
        await restarted?.close();
        await h.close();
      }
    },
  );

  it.each([false, true])(
    'reopens a named project after explicit legacy Scratch adoption and real Save conversion (pending sibling=%s)',
    async (pendingSibling) => {
      const h = await seedLegacy('scratch', [], pendingSibling);
      const siblingBefore = pendingSibling
        ? pendingSiblingState(h.fs.durableSnapshot())
        : undefined;
      expectPendingSibling(h, siblingBefore);
      const savedId = 'saved-legacy-scratch';
      const root = `/.rifty/workbench/v1/projects/${savedId}/tree`;
      let opened: OpenedPlaygroundProject | undefined;
      let restarted: Awaited<ReturnType<typeof openSavedSnapshotOwner>> | undefined;
      try {
        const adopted = await openLegacy(h, 'overwrite');
        expect(
          adopted.failure,
          'initial explicit legacy Scratch adoption must succeed',
        ).toBeUndefined();
        opened = adopted.opened;
        if (opened === undefined) throw new Error('legacy adoption did not return a session');
        expect(opened.acquisition).toMatchObject({
          kind: 'ready',
          provenance: { outcome: 'snapshot', snapshotId: fixture.snapshotId },
        });
        const scratchRoot = opened.projectRoot;
        expectRetainedFiles(h, scratchRoot);
        expect(h.authority.existsSync(h.sourceRoot)).toBe(false);
        expectPendingSibling(h, siblingBefore);
        await opened.close();
        opened = undefined;

        await h.catalog.saveScratch({
          id: savedId,
          name: 'Saved adopted legacy Scratch',
          definition: savedSnapshotDefinition(savedId, fixture.descriptor, {
            source: "console.log('must not replace legacy source');\n",
          }),
        });
        expect(h.catalog.snapshot()).toMatchObject({
          active: { kind: 'project', id: savedId },
          scratch: null,
          projects: [
            ...(pendingSibling ? [{ id: siblingId, name: 'Pending sibling' }] : []),
            { id: savedId, name: 'Saved adopted legacy Scratch' },
          ],
        });
        expect(h.authority.existsSync(scratchRoot)).toBe(false);
        expectRetainedFiles(h, root);
        const stamp = readInstallStampSync(h.authority, root);
        expect(stamp !== null && stampTrusted(stamp)).toBe(true);
        expect(stamp).toMatchObject({ root, slug: savedId });
        expect(h.network.requests).toEqual([fixture.descriptor.assetUrl]);
        await h.authority.flush();
        expectPendingSibling(h, siblingBefore);
        const before = projectTree(h.fs.durableSnapshot(), root);
        const catalogBefore = h.catalog.snapshot();
        await h.close();

        h.network.requests.length = 0;
        restarted = await openSavedSnapshotOwner(h.network, h.fs.restartFromDurableState(), prefix);
        expectPendingSibling(restarted, siblingBefore);
        opened = await restarted.owner.openProject(
          savedSnapshotDefinition(savedId, fixture.descriptor),
        );
        expect(opened.acquisition).toMatchObject({ kind: 'saved' });
        expect(h.network.requests).toEqual([]);
        expect(restarted.catalog.snapshot()).toEqual(catalogBefore);
        expect(projectTree(restarted.fs.liveSnapshot(), root)).toEqual(before);
        expect(projectTree(restarted.fs.durableSnapshot(), root)).toEqual(before);
        expectRetainedFiles({ ...h, ...restarted }, root);
        expect(restarted.authority.existsSync(h.sourceRoot)).toBe(false);
        expect(restarted.authority.existsSync(scratchRoot)).toBe(false);
        const reopenedStamp = readInstallStampSync(restarted.authority, root);
        expect(reopenedStamp !== null && stampTrusted(reopenedStamp)).toBe(true);
        expect(reopenedStamp).toMatchObject({ root, slug: savedId });
        expectPendingSibling(restarted, siblingBefore);
      } finally {
        await opened?.close();
        await restarted?.close();
        await h.close();
      }
    },
  );
});

interface RecordedMigrationJournal {
  readonly refs: readonly {
    readonly id: string;
    readonly sourceRoot: string;
    readonly phase: { readonly kind: string };
  }[];
}

function recordedJournal(bytes: Uint8Array | undefined): RecordedMigrationJournal {
  if (bytes === undefined) throw new Error('real migration journal bytes missing');
  return JSON.parse(decoder.decode(bytes)) as RecordedMigrationJournal;
}

/** Backward-reader input: actual completed receipt, actual installed tree/claim. */
async function seedCompletedReceipt(id: 'scratch' | 'legacy-project') {
  const h = await seedLegacy(id, [], true);
  let opened: OpenedPlaygroundProject | undefined;
  try {
    h.fs.armPersistFailure(Number.MAX_SAFE_INTEGER, 'quota-report');
    const adopted = await openLegacy(h, 'overwrite');
    expect(adopted.failure).toBeUndefined();
    opened = adopted.opened;
    if (opened === undefined) throw new Error('real legacy adoption did not admit a session');
    expect(opened.acquisition).toMatchObject({
      kind: 'ready',
      provenance: { outcome: 'snapshot', snapshotId: fixture.snapshotId },
    });
    const root = opened.projectRoot;
    expectRetainedFiles(h, root);
    const stamp = readInstallStampSync(h.authority, root);
    expect(stamp !== null && stampTrusted(stamp)).toBe(true);
    await h.authority.flush();
    const receipt = h.fs.trace.find((entry) => {
      if (
        entry.outcome !== 'success' ||
        entry.primitive.kind !== 'write' ||
        entry.primitive.path !== migrationJournal
      )
        return false;
      const journal = recordedJournal(entry.primitive.bytes);
      return (
        journal.refs.some((ref) => ref.id === id && ref.phase.kind === 'adopted') &&
        journal.refs.some((ref) => ref.id === siblingId && ref.phase.kind === 'pending')
      );
    })?.primitive.bytes;
    expect(
      receipt,
      'capture the actual durable adopted receipt before possible retirement',
    ).toBeDefined();
    if (receipt === undefined) throw new Error('real adopted receipt not emitted');
    await opened.close();
    opened = undefined;
    await h.close();
    const storage = h.fs.restartFromDurableState();
    // The old reader persisted this receipt; keep its matching real tree/claim untouched.
    storage.writeFileSync(migrationJournal, receipt.slice());
    await storage.flush();
    return { id, root, tree: storage.durableSnapshot() };
  } finally {
    h.fs.disarmPersistFailure();
    await opened?.close();
    await h.close();
  }
}

type ReceiptOwner = Awaited<ReturnType<typeof openSavedSnapshotOwner>>;
type FollowingOperation = 'apply' | 'save';
const receiptSaveId = 'receipt-saved-project';

async function followingMutation(
  h: ReceiptOwner,
  operation: FollowingOperation,
  artifact: SavedSnapshotFixture,
): Promise<OpenedPlaygroundProject | undefined> {
  if (operation === 'apply') {
    return h.owner.openProject(
      savedSnapshotDefinition('legacy-project', artifact.descriptor, {
        packageJsonText: artifact.payload.packageJsonText,
        source: "console.log('must not replace legacy source');\n",
        application: { mode: 'apply-snapshot', conflict: 'overwrite' },
      }),
    );
  }
  await h.catalog.saveScratch({
    id: receiptSaveId,
    name: 'Retired receipt Save',
    definition: savedSnapshotDefinition(receiptSaveId, fixture.descriptor, {
      source: "console.log('must not replace legacy source');\n",
    }),
  });
  return undefined;
}

function expectFollowingMutation(
  h: ReceiptOwner,
  operation: FollowingOperation,
  artifact: SavedSnapshotFixture,
  opened: OpenedPlaygroundProject | undefined,
): void {
  const id = operation === 'apply' ? 'legacy-project' : receiptSaveId;
  const root = `/.rifty/workbench/v1/projects/${id}/tree`;
  if (operation === 'apply') {
    expect(opened?.acquisition).toMatchObject({
      kind: 'ready',
      provenance: { outcome: 'snapshot', snapshotId: artifact.snapshotId },
    });
  } else {
    expect(h.catalog.snapshot()).toMatchObject({ active: { kind: 'project', id }, scratch: null });
    expect(h.authority.existsSync('/.rifty/workbench/v1/projects/scratch/tree')).toBe(false);
  }
  const expected = operation === 'apply' ? artifact : fixture;
  expect(decoder.decode(h.authority.readFileBytesSync(`${root}/package.json`))).toBe(
    expected.payload.packageJsonText,
  );
  expect(decoder.decode(h.authority.readFileBytesSync(`${root}/package-lock.json`))).toBe(
    expected.payload.lockfile,
  );
  expect(decoder.decode(h.authority.readFileBytesSync(`${root}/main.cjs`))).toBe(sourceText);
  expect(decoder.decode(h.authority.readFileBytesSync(`${root}/user.txt`))).toBe(
    'legacy user bytes\n',
  );
  expect(decoder.decode(h.authority.readFileBytesSync(`${root}/node_modules/ms/local.txt`))).toBe(
    'legacy dependency extra\n',
  );
  for (const file of expected.payload.nodeModules.files) {
    expect(h.authority.readFileBytesSync(`${root}/node_modules/${file.path}`)).toEqual(
      Uint8Array.from(atob(file.content), (character) => character.charCodeAt(0)),
    );
  }
  const stamp = readInstallStampSync(h.authority, root);
  expect(stamp !== null && stampTrusted(stamp)).toBe(true);
  expect(stamp).toMatchObject({
    root,
    slug: id,
    packageJsonText: expected.payload.packageJsonText,
  });
}

async function retirementOrdinal(
  before: ExactFsTree,
  operation: FollowingOperation,
  artifact: SavedSnapshotFixture,
): Promise<number> {
  const network = installSnapshotNetwork(fixture, artifact);
  const h = await openSavedSnapshotOwner(network, createDurableOwnerFsFromTree(before), prefix);
  let opened: OpenedPlaygroundProject | undefined;
  try {
    expect(h.fs.liveSnapshot()).toEqual(before);
    expect(h.fs.pendingPrimitiveCount).toBe(0);
    const journalBefore = recordedJournal(before.files[migrationJournal]);
    expect(journalBefore.refs.filter((ref) => ref.phase.kind === 'adopted')).toHaveLength(1);
    const retired = {
      ...journalBefore,
      refs: journalBefore.refs.filter((ref) => ref.phase.kind !== 'adopted'),
    };
    expect(retired.refs).toHaveLength(1);
    expect(retired.refs[0]).toMatchObject({ id: siblingId, phase: { kind: 'pending' } });
    h.fs.armPersistFailure(Number.MAX_SAFE_INTEGER, 'quota-report');
    opened = await followingMutation(h, operation, artifact);
    await h.authority.flush();
    expectFollowingMutation(h, operation, artifact, opened);
    expectPendingSibling(h, pendingSiblingState(before));
    const pointer = h.fs.trace.find(
      (entry) =>
        entry.outcome === 'success' &&
        entry.primitive.kind === 'write' &&
        entry.primitive.path === migrationJournal &&
        JSON.stringify(recordedJournal(entry.primitive.bytes)) === JSON.stringify(retired),
    );
    expect(
      pointer,
      'successful request must durably retire only its completed migration ref',
    ).toBeDefined();
    if (pointer === undefined) throw new Error('real completed-ref retirement write not found');
    expect(
      h.fs.trace.filter((entry) => entry.ordinal < pointer.ordinal),
      'retirement precedes transaction, project, cache and claim persistence',
    ).toEqual([]);
    return pointer.ordinal;
  } finally {
    h.fs.disarmPersistFailure();
    await opened?.close();
    await h.close();
  }
}

describe('ADR-0397 completed migration receipt retirement', () => {
  it.each([
    ['apply', 'quota-report'],
    ['apply', 'permission-rejection'],
    ['save', 'quota-report'],
    ['save', 'permission-rejection'],
  ] as const)(
    '%s rejects %s during retirement without changing prior state, then same-owner reopen/retry works',
    async (operation, failureMode) => {
      const artifact = await bakeSavedSnapshotFixture({
        description: 'explicit update after receipt retirement',
        assetUrl: 'https://host.test/receipt-replacement.tar.gz',
      });
      const before = await seedCompletedReceipt(
        operation === 'apply' ? 'legacy-project' : 'scratch',
      );
      const ordinal = await retirementOrdinal(before.tree, operation, artifact);
      const network = installSnapshotNetwork(fixture, artifact);
      const h = await openSavedSnapshotOwner(
        network,
        createDurableOwnerFsFromTree(before.tree),
        prefix,
      );
      const catalogBefore = h.catalog.snapshot();
      let opened: OpenedPlaygroundProject | undefined;
      try {
        h.fs.armPersistFailure(ordinal, failureMode);
        let failure: unknown;
        try {
          opened = await followingMutation(h, operation, artifact);
        } catch (error) {
          failure = error;
        }
        h.fs.disarmPersistFailure();
        expect(h.fs.didInjectFailure).toBe(true);
        expect(h.fs.trace.find((entry) => entry.outcome === 'injected-failure')).toMatchObject({
          ordinal,
          primitive: { kind: 'write', path: migrationJournal },
        });
        expect(failure).toBeInstanceOf(Error);
        expect(String(failure)).toMatch(/quota|persist|permission/i);
        expect(opened).toBeUndefined();
        expect(h.catalog.snapshot()).toEqual(catalogBefore);
        expect(h.fs.liveSnapshot()).toEqual(before.tree);
        expect(h.fs.durableSnapshot()).toEqual(before.tree);
        expect(h.fs.pendingPrimitiveCount).toBe(0);
        expectPendingSibling(h, pendingSiblingState(before.tree));
        expect(network.requests).toEqual(
          operation === 'apply' ? [artifact.descriptor.assetUrl] : [],
        );

        network.requests.length = 0;
        opened = await h.owner.openProject(
          savedSnapshotDefinition(before.id, {
            ...fixture.descriptor,
            snapshotId: `sha256:${'0'.repeat(64)}`,
            assetUrl: 'https://host.test/unused-after-retirement-failure.tar.gz',
          }),
        );
        expect(opened.acquisition).toMatchObject({ kind: 'saved' });
        expect(network.requests).toEqual([]);
        expect(h.fs.liveSnapshot()).toEqual(before.tree);
        expect(h.fs.durableSnapshot()).toEqual(before.tree);
        await opened.close();
        opened = undefined;

        opened = await followingMutation(h, operation, artifact);
        await h.authority.flush();
        expectFollowingMutation(h, operation, artifact, opened);
        expectPendingSibling(h, pendingSiblingState(before.tree));
        expect(network.requests).toEqual(
          operation === 'apply' ? [artifact.descriptor.assetUrl] : [],
        );
        const journal = recordedJournal(h.fs.durableSnapshot().files[migrationJournal]);
        expect(journal.refs).toEqual(
          recordedJournal(before.tree.files[migrationJournal]).refs.filter(
            (ref) => ref.phase.kind !== 'adopted',
          ),
        );
      } finally {
        h.fs.disarmPersistFailure();
        await opened?.close();
        await h.close();
      }
    },
  );

  it('rejects a corrupted pending sibling beside a valid completed receipt before retirement, twice without effects', async () => {
    const before = await seedCompletedReceipt('legacy-project');
    const storage = createDurableOwnerFsFromTree(before.tree);
    const journal = recordedJournal(storage.readFileBytesSync(migrationJournal));
    storage.writeFileSync(
      migrationJournal,
      encoder.encode(
        JSON.stringify({
          ...journal,
          refs: journal.refs.map((ref) =>
            ref.id === siblingId
              ? { ...ref, sourceRoot: `${prefix}/projects/wrong-sibling-source` }
              : ref,
          ),
        }),
      ),
    );
    await storage.flush();
    const corrupted = storage.durableSnapshot();
    for (let attempt = 0; attempt < 2; attempt++) {
      const fs = createDurableOwnerFsFromTree(corrupted);
      const network = installSnapshotNetwork(fixture);
      let h: ReceiptOwner | undefined;
      try {
        await expect(
          openSavedSnapshotOwner(network, fs, prefix).then((owner) => {
            h = owner;
          }),
        ).rejects.toThrow(/migration|source|identity/i);
        expect(h).toBeUndefined();
        expect(network.requests).toEqual([]);
        expect(fs.liveSnapshot()).toEqual(corrupted);
        expect(fs.durableSnapshot()).toEqual(corrupted);
        expect(fs.pendingPrimitiveCount).toBe(0);
      } finally {
        await h?.close();
      }
    }
  });
});

describe('I8 real saved trust replaces legacy snapshot-initializer identity rejection', () => {
  it.each(['trusted', 'absent'] as const)(
    'changed unavailable snapshot uses saved %s claim without arrival or byte changes',
    async (claimState) => {
      const saved = await seedCompletedReceipt('legacy-project');
      const storage = createDurableOwnerFsFromTree(saved.tree);
      if (claimState === 'absent') storage.rmSync(installStampPath(saved.root), {});
      await storage.flush();
      const before = storage.durableSnapshot();
      const network = installSnapshotNetwork(fixture);
      const h = await openSavedSnapshotOwner(network, storage.restartFromDurableState(), prefix);
      const catalogBefore = h.catalog.snapshot();
      let opened: OpenedPlaygroundProject | undefined;
      let failure: unknown;
      try {
        try {
          opened = await h.owner.openProject(
            savedSnapshotDefinition(
              saved.id,
              {
                ...fixture.descriptor,
                snapshotId: `sha256:${'0'.repeat(64)}`,
                assetUrl: 'https://host.test/unused-legacy-snapshot.tar.gz',
              },
              { source: "console.log('unused arriving source initializer');\n" },
            ),
          );
        } catch (error) {
          failure = error;
        }
        expect(
          failure,
          'ADR-0415 saved access is independent of the install claim',
        ).toBeUndefined();
        expect(opened?.acquisition).toEqual({ kind: 'saved' });
        const stamp = readInstallStampSync(h.authority, saved.root);
        if (claimState === 'trusted') expect(stamp !== null && stampTrusted(stamp)).toBe(true);
        else expect(stamp).toBeNull();
        expect(network.requests).toEqual([]);
        expect(h.catalog.snapshot()).toEqual(catalogBefore);
        expect(h.fs.liveSnapshot()).toEqual(before);
        expect(h.fs.durableSnapshot()).toEqual(before);
        expectPendingSibling(h, pendingSiblingState(before));
      } finally {
        await opened?.close();
        await h.close();
      }
    },
  );
});

/** The native persistence boundary remains unavailable after its first refusal. */
class PermissionLostReceiptFs extends DurableOwnerFs {
  permissionLost = false;
  deniedFlushes = 0;

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
    if (this.permissionLost) {
      this.deniedFlushes++;
      throw new Error('permission denied: receipt persistence remains unavailable');
    }
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

function isReceiptPermissionFailure(error: unknown): boolean {
  if (error instanceof AggregateError) {
    return (
      error.errors.length > 0 &&
      error.errors.every(isReceiptPermissionFailure) &&
      (error.cause === undefined || isReceiptPermissionFailure(error.cause))
    );
  }
  return (
    error instanceof Error &&
    (/permission denied/i.test(error.message) ||
      (error.cause !== undefined && isReceiptPermissionFailure(error.cause)))
  );
}

async function closeWithoutReceiptPermission(h: ReceiptOwner): Promise<void> {
  try {
    await h.close();
  } catch (error) {
    if (!isReceiptPermissionFailure(error)) throw error;
  }
}

it('ADR-0397 unproved retirement compensation fences the owner until fresh durable recovery', async () => {
  const artifact = await bakeSavedSnapshotFixture({
    description: 'payload must not apply after receipt permission loss',
    assetUrl: 'https://host.test/receipt-permission-loss.tar.gz',
  });
  const before = await seedCompletedReceipt('legacy-project');
  const ordinal = await retirementOrdinal(before.tree, 'apply', artifact);
  const network = installSnapshotNetwork(fixture, artifact);
  const fs = new PermissionLostReceiptFs(before.tree);
  const h = await openSavedSnapshotOwner(network, fs, prefix);
  const catalogBefore = h.catalog.snapshot();
  let opened: OpenedPlaygroundProject | undefined;
  let closed = false;
  try {
    fs.armPersistFailure(ordinal, 'permission-rejection');
    let failure: unknown;
    try {
      opened = await followingMutation(h, 'apply', artifact);
    } catch (error) {
      failure = error;
    }
    expect(fs.permissionLost).toBe(true);
    expect(fs.deniedFlushes, 'the compensating journal flush also lost permission').toBeGreaterThan(
      0,
    );
    expect(fs.trace.find((entry) => entry.outcome === 'injected-failure')).toMatchObject({
      ordinal,
      primitive: { kind: 'write', path: migrationJournal },
    });
    expect(failure).toBeInstanceOf(Error);
    expect(String(failure)).toMatch(/retirement|persist|permission/i);
    expect(opened).toBeUndefined();
    expect(network.requests).toEqual([artifact.descriptor.assetUrl]);
    expect(h.catalog.snapshot()).toEqual(catalogBefore);
    expect(fs.liveSnapshot()).toEqual(before.tree);
    expect(fs.durableSnapshot()).toEqual(before.tree);
    expectPendingSibling(h, pendingSiblingState(before.tree));
    expect(h.installStampClaims.read(before.root)).toEqual(
      before.tree.files[installStampPath(before.root)],
    );
    expect(fs.trace.every((entry) => entry.primitive.path === migrationJournal)).toBe(true);
    expect(
      fs.liveSnapshot().files['/.rifty/workbench/playground/transaction.json'],
    ).toBeUndefined();

    const liveAtFence = fs.liveSnapshot();
    const durableAtFence = fs.durableSnapshot();
    const pendingAtFence = fs.pendingPrimitiveCount;
    const revisionAtFence = h.authority.treeRevision;
    const traceAtFence = fs.trace;
    const deniedAtFence = fs.deniedFlushes;
    network.requests.length = 0;
    let openFailure: unknown;
    try {
      opened = await h.owner.openProject(
        savedSnapshotDefinition(before.id, {
          ...fixture.descriptor,
          assetUrl: 'https://host.test/unused-while-receipt-fenced.tar.gz',
        }),
      );
    } catch (error) {
      openFailure = error;
    }
    expect(openFailure, 'unproved receipt compensation must refuse saved admission').toBeInstanceOf(
      Error,
    );
    expect(opened).toBeUndefined();
    let applyFailure: unknown;
    try {
      opened = await followingMutation(h, 'apply', artifact);
    } catch (error) {
      applyFailure = error;
    }
    expect(applyFailure, 'unproved receipt compensation must refuse another apply').toBeInstanceOf(
      Error,
    );
    expect(opened).toBeUndefined();
    expect(network.requests).toEqual([]);
    expect(h.catalog.snapshot()).toEqual(catalogBefore);
    expect(fs.liveSnapshot()).toEqual(liveAtFence);
    expect(fs.durableSnapshot()).toEqual(durableAtFence);
    expect(fs.pendingPrimitiveCount).toBe(pendingAtFence);
    expect(h.authority.treeRevision).toBe(revisionAtFence);
    expect(fs.trace).toEqual(traceAtFence);
    expect(fs.deniedFlushes).toBe(deniedAtFence);

    await closeWithoutReceiptPermission(h);
    closed = true;
    expect(fs.durableSnapshot()).toEqual(durableAtFence);
    fs.releasePermission();
    const recoveredNetwork = installSnapshotNetwork(fixture, artifact);
    // Restart from bytes actually persisted, excluding the dying owner's queued writes.
    const recovered = await openSavedSnapshotOwner(
      recoveredNetwork,
      createDurableOwnerFsFromTree(fs.durableSnapshot()),
      prefix,
    );
    let reopened: OpenedPlaygroundProject | undefined;
    try {
      expect(recovered.fs.liveSnapshot()).toEqual(before.tree);
      expect(recovered.fs.durableSnapshot()).toEqual(before.tree);
      expect(recovered.catalog.snapshot()).toEqual(catalogBefore);
      expectPendingSibling(recovered, pendingSiblingState(before.tree));
      reopened = await recovered.owner.openProject(
        savedSnapshotDefinition(before.id, {
          ...fixture.descriptor,
          assetUrl: 'https://host.test/unused-after-receipt-recovery.tar.gz',
        }),
      );
      expect(reopened.acquisition).toMatchObject({ kind: 'saved' });
      expect(recoveredNetwork.requests).toEqual([]);
      expect(recovered.fs.liveSnapshot()).toEqual(before.tree);
      expect(recovered.fs.durableSnapshot()).toEqual(before.tree);
      const stamp = readInstallStampSync(recovered.authority, before.root);
      expect(stamp !== null && stampTrusted(stamp)).toBe(true);
      expect(recovered.installStampClaims.read(before.root)).toEqual(
        before.tree.files[installStampPath(before.root)],
      );
      expectPendingSibling(recovered, pendingSiblingState(before.tree));
    } finally {
      await reopened?.close();
      await recovered.close();
    }
  } finally {
    await opened?.close();
    if (!closed) await closeWithoutReceiptPermission(h);
    fs.releasePermission();
  }
});
