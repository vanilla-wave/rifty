import { serializePackageJson } from '@riftydev/npm-client';
import { resetSyncMirror, setSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { restoreDepSnapshot } from '../glue/dep-snapshot.ts';
import { createInstallStampAuthority } from '../glue/install-stamp-authority.ts';
import { installStampPath, readInstallStampSync, stampTrusted } from '../glue/install-stamp.ts';
import { SyncMirrorVfs } from '../glue/sync-mirror-vfs.ts';
import type { OpenedPlaygroundProject } from './playground-project-authority.ts';
import { DurableOwnerFs } from './test-fixtures/durable-owner-fs.ts';
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

async function seedLegacy(id: 'scratch' | 'legacy-project') {
  const network = installSnapshotNetwork(fixture);
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
  write(
    fs,
    legacyIndex,
    JSON.stringify({
      activeId: id,
      scratch: id === 'scratch' ? { starter: 'saved-ms-starter', dirty: true, editedAt } : null,
      projects:
        id === 'scratch'
          ? []
          : [{ id, name: 'Legacy project', starter: 'saved-ms-starter', editedAt }],
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
        expect
          .soft(reopened.acquisition)
          .toMatchObject({ kind: 'ready', provenance: { outcome: 'existing' } });
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
