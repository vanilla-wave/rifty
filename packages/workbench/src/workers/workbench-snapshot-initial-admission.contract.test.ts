import { resetSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { isInstallStampPath } from '../glue/install-stamp.ts';
import type { OpenedPlaygroundProject } from './playground-project-authority.ts';
import type { ExactFsTree } from './test-fixtures/durable-owner-fs.ts';
import {
  type SavedSnapshotFixture,
  bakeSavedSnapshotFixture,
  installSnapshotNetwork,
  openSavedSnapshotOwner,
  savedSnapshotDefinition,
  snapshotAssetUrl,
  unusedSnapshotAssetUrl,
} from './test-fixtures/snapshot-saved-state.ts';

let fixture: SavedSnapshotFixture;
beforeAll(async () => {
  fixture = await bakeSavedSnapshotFixture();
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetSyncMirror();
});

function projectAndCatalog(tree: ExactFsTree): ExactFsTree {
  const belongs = (path: string) => path.startsWith('/.rifty/workbench/');
  return {
    directories: tree.directories.filter(belongs),
    files: Object.fromEntries(Object.entries(tree.files).filter(([path]) => belongs(path))),
  };
}

describe('snapshot first acquisition admission survives the catalog lifetime', () => {
  it('does not transfer unused first-admission entitlement through Save', async () => {
    const network = installSnapshotNetwork(fixture);
    const h = await openSavedSnapshotOwner(network);
    await h.catalog.createScratch({
      definition: savedSnapshotDefinition('scratch', fixture.descriptor),
    });
    const id = 'saved-before-first-open';
    const definition = savedSnapshotDefinition(id, fixture.descriptor);
    await h.catalog.saveScratch({ id, name: 'Unopened saved seed', definition });
    await h.authority.flush();
    await h.close();
    const before = h.fs.durableSnapshot();
    expect(network.requests).toEqual([]);
    const reopened = await openSavedSnapshotOwner(network, h.fs.restartFromDurableState());
    let opened: OpenedPlaygroundProject | undefined;
    let failure: unknown;
    try {
      try {
        opened = await reopened.owner.openProject(definition);
      } catch (error) {
        failure = error;
      }
      expect.soft(failure).toBeInstanceOf(Error);
      expect.soft(opened).toBeUndefined();
      expect.soft(network.requests).toEqual([]);
      expect.soft(reopened.fs.liveSnapshot()).toEqual(before);
      expect.soft(reopened.fs.durableSnapshot()).toEqual(before);
    } finally {
      await opened?.close();
      await reopened.close();
    }
  });

  it('permits the first acquisition after create, close and reload', async () => {
    const network = installSnapshotNetwork(fixture);
    const first = await openSavedSnapshotOwner(network);
    const definition = savedSnapshotDefinition('scratch', fixture.descriptor);
    await first.catalog.createScratch({ definition });
    expect(network.requests).toEqual([]);
    await first.close();
    const reopened = await openSavedSnapshotOwner(network, first.fs.restartFromDurableState());
    try {
      const opened = await reopened.owner.openProject(definition);
      expect(opened.acquisition).toMatchObject({
        kind: 'ready',
        provenance: { outcome: 'snapshot' },
      });
      expect(network.requests).toEqual([snapshotAssetUrl]);
      await opened.close();
    } finally {
      await reopened.close();
    }
  });

  it('restores a failed first admission exactly and permits a same-owner retry', async () => {
    const network = installSnapshotNetwork(fixture);
    const seeded = await openSavedSnapshotOwner(network);
    const definition = savedSnapshotDefinition('scratch', fixture.descriptor);
    await seeded.catalog.createScratch({ definition });
    const before = seeded.fs.durableSnapshot();
    await seeded.close();
    const probe = await openSavedSnapshotOwner(network, seeded.fs.restartFromDurableState());
    probe.fs.armPersistFailure(Number.MAX_SAFE_INTEGER, 'quota-report');
    const reference = await probe.owner.openProject(definition);
    await reference.close();
    const target = probe.fs.trace.find(
      (entry) => entry.primitive.kind === 'write' && isInstallStampPath(entry.primitive.path),
    );
    await probe.close();
    if (target === undefined) throw new Error('first admission did not write its real claim');
    const h = await openSavedSnapshotOwner(network, seeded.fs.restartFromDurableState());
    h.fs.armPersistFailure(target.ordinal, 'quota-report');
    let opened: OpenedPlaygroundProject | undefined;
    let failure: unknown;
    try {
      try {
        opened = await h.owner.openProject(definition);
      } catch (error) {
        failure = error;
      }
      expect.soft(failure).toBeInstanceOf(Error);
      await opened?.close();
      opened = undefined;
      expect(h.fs.didInjectFailure).toBe(true);
      expect
        .soft(
          projectAndCatalog(h.fs.liveSnapshot()),
          'failed admission must retain exact seed and receipt',
        )
        .toEqual(projectAndCatalog(before));
      expect
        .soft(projectAndCatalog(h.fs.durableSnapshot()), 'rollback is durable before retry')
        .toEqual(projectAndCatalog(before));
      h.fs.disarmPersistFailure();
      network.requests.length = 0;
      opened = await h.owner.openProject(definition);
      expect(opened.acquisition).toMatchObject({
        kind: 'ready',
        provenance: { outcome: 'snapshot' },
      });
      expect(network.requests).toEqual([snapshotAssetUrl]);
      await opened.close();
    } finally {
      await opened?.close();
      await h.close();
    }
  });

  it('consumes the first admission when returning a deferred install session', async () => {
    const network = installSnapshotNetwork(fixture);
    const first = await openSavedSnapshotOwner(network);
    const unavailable = savedSnapshotDefinition('scratch', {
      ...fixture.descriptor,
      assetUrl: unusedSnapshotAssetUrl,
    });
    await first.catalog.createScratch({ definition: unavailable });
    const deferred = await first.owner.openProject(unavailable);
    expect(deferred.acquisition).toMatchObject({ kind: 'install' });
    expect(network.requests, 'no install before the session can run').toEqual([
      unusedSnapshotAssetUrl,
    ]);
    await deferred.close();
    await first.close();
    const before = first.fs.durableSnapshot();
    network.requests.length = 0;
    const reopened = await openSavedSnapshotOwner(network, first.fs.restartFromDurableState());
    let opened: OpenedPlaygroundProject | undefined;
    let failure: unknown;
    try {
      try {
        opened = await reopened.owner.openProject(
          savedSnapshotDefinition('scratch', fixture.descriptor),
        );
      } catch (error) {
        failure = error;
      }
      expect.soft(failure).toBeInstanceOf(Error);
      expect.soft(opened).toBeUndefined();
      expect.soft(network.requests).toEqual([]);
      expect.soft(reopened.fs.liveSnapshot()).toEqual(before);
      expect.soft(reopened.fs.durableSnapshot()).toEqual(before);
    } finally {
      await opened?.close();
      await reopened.close();
    }
  });

  it('reopens the old four-field catalog shape without rewriting it', async () => {
    const network = installSnapshotNetwork(fixture);
    const h = await openSavedSnapshotOwner(network);
    const definition = savedSnapshotDefinition('scratch', fixture.descriptor);
    await h.catalog.createScratch({ definition });
    const seeded = await h.owner.openProject(definition);
    await seeded.close();
    await h.authority.flush();
    await h.close();
    const fs = h.fs.restartFromDurableState();
    const path = '/.rifty/workbench/playground/catalog.json';
    const catalog = JSON.parse(new TextDecoder().decode(fs.readFileBytesSync(path))) as Record<
      string,
      unknown
    >;
    fs.writeFileSync(
      path,
      new TextEncoder().encode(
        JSON.stringify(
          Object.fromEntries(
            ['version', 'active', 'scratch', 'projects'].map((key) => [key, catalog[key]]),
          ),
        ),
      ),
    );
    await fs.flush();
    const before = fs.durableSnapshot();
    network.requests.length = 0;
    const reopened = await openSavedSnapshotOwner(network, fs.restartFromDurableState());
    let opened: OpenedPlaygroundProject | undefined;
    try {
      opened = await reopened.owner.openProject(definition);
      expect(opened.acquisition).toMatchObject({
        kind: 'ready',
        provenance: { outcome: 'existing' },
      });
      expect(network.requests).toEqual([]);
      expect(reopened.fs.durableSnapshot()).toEqual(before);
      await opened.close();
    } finally {
      await opened?.close();
      await reopened.close();
    }
  });
});
