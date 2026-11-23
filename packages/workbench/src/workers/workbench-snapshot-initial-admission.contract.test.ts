import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { TARBALL_CACHE_ROOT } from '@riftydev/npm-client';
import { resetSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { parseDepSnapshot, serializeDepSnapshot } from '../glue/dep-snapshot.ts';
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
      expect
        .soft(failure, 'ADR-0415 saved access does not consume new acquisition')
        .toBeUndefined();
      expect.soft(opened?.acquisition).toEqual({ kind: 'saved' });
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
      expect
        .soft(failure, 'ADR-0415 saved access does not consume new acquisition')
        .toBeUndefined();
      expect.soft(opened?.acquisition).toEqual({ kind: 'saved' });
      expect.soft(network.requests).toEqual([]);
      expect.soft(reopened.fs.liveSnapshot()).toEqual(before);
      expect.soft(reopened.fs.durableSnapshot()).toEqual(before);
    } finally {
      await opened?.close();
      await reopened.close();
    }
  });

  it('[fault: poisoned-cache] rejects a corrupt replay cache before any cache, tree or claim write', async () => {
    // Real replay-capable baked asset (the ms fixture has no replay closure).
    const baked = parseDepSnapshot(
      gunzipSync(
        readFileSync(
          new URL(
            '../../../../apps/playground/public/snapshots/vite-node-modules.json.gz',
            import.meta.url,
          ),
        ),
      ).toString('utf8'),
    );
    expect(baked.tarballCache.files.length).toBeGreaterThan(0);
    const corrupt = {
      ...baked,
      tarballCache: {
        ...baked.tarballCache,
        files: baked.tarballCache.files.map((file) => ({
          ...file,
          content: Buffer.from('corrupt replay bytes').toString('base64'),
        })),
      },
    };
    const bytes = new TextEncoder().encode(serializeDepSnapshot(corrupt));
    const descriptor = {
      snapshotId: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
      templateId: baked.templateId,
      assetUrl: 'https://host.test/corrupt-replay.json',
    };
    const requests: string[] = [];
    const fetch = async (input: string | URL | Request): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      requests.push(url);
      if (url === descriptor.assetUrl) return new Response(bytes.slice());
      throw new Error(`Network unavailable: ${url}`);
    };
    vi.stubGlobal('fetch', fetch);
    const network = { requests, fetch };
    const definition = savedSnapshotDefinition('scratch', descriptor, {
      packageJsonText: baked.packageJsonText,
    });
    const first = await openSavedSnapshotOwner(network);
    await first.catalog.createScratch({ definition });
    await first.close();
    const root = '/.rifty/workbench/v2/projects/scratch/tree';
    const dependencyState = (tree: ExactFsTree) =>
      Object.keys(tree.files).filter(
        (path) =>
          path.startsWith(`${TARBALL_CACHE_ROOT}/`) ||
          path.startsWith(`${root}/node_modules/`) ||
          path === `${root}/package-lock.json` ||
          isInstallStampPath(path),
      );
    const reopened = await openSavedSnapshotOwner(network, first.fs.restartFromDurableState());
    let opened: OpenedPlaygroundProject | undefined;
    try {
      opened = await reopened.owner.openProject(definition);
      expect(opened.acquisition).toEqual({
        kind: 'install',
        snapshotFailures: [
          {
            snapshotId: descriptor.snapshotId,
            reason: expect.stringMatching(
              /^snapshot-restore-plan-failed: Dep snapshot replay cache integrity mismatch for /,
            ),
          },
        ],
      });
      expect(requests).toEqual([descriptor.assetUrl]);
      await opened.close();
      opened = undefined;
      await reopened.authority.flush();
      expect(dependencyState(reopened.fs.liveSnapshot()), 'no cache/tree/claim write').toEqual([]);
      expect(dependencyState(reopened.fs.durableSnapshot())).toEqual([]);
    } finally {
      await opened?.close();
      await reopened.close();
    }
    // The deferred install consumed the receipt: the next open is saved, with no fetch.
    requests.length = 0;
    const again = await openSavedSnapshotOwner(network, reopened.fs.restartFromDurableState());
    try {
      const saved = await again.owner.openProject(definition);
      expect(saved.acquisition).toEqual({ kind: 'saved' });
      expect(requests).toEqual([]);
      await saved.close();
    } finally {
      await again.close();
    }
  }, 60_000);

  it.each([
    [
      'replay bytes',
      /^snapshot-restore-plan-failed: Frozen dep snapshot must not contain replay cache entries$/,
    ],
    ['an unsafe payload path', /^snapshot-restore-plan-failed: .*unsafe archive path/i],
  ] as const)(
    '[fault: poisoned-cache] rejects a frozen v5 carrying %s before any cache, tree or claim write',
    async (fault, reason) => {
      const frozen = {
        ...fixture.payload,
        version: 5,
        profile: 'frozen',
        tarballCache: {
          version: 1,
          root: TARBALL_CACHE_ROOT,
          files:
            fault === 'replay bytes'
              ? [{ path: 'smuggled.tgz', encoding: 'base64', content: btoa('smuggled') }]
              : [],
        },
        ...(fault === 'an unsafe payload path'
          ? {
              nodeModules: {
                ...fixture.payload.nodeModules,
                files: [{ path: '../outside', encoding: 'base64', content: btoa('bad') }],
              },
            }
          : {}),
      } as const;
      const bytes = new TextEncoder().encode(JSON.stringify(frozen));
      const descriptor = {
        snapshotId: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
        templateId: fixture.payload.templateId,
        assetUrl: 'https://host.test/poisoned-frozen.json',
      };
      const requests: string[] = [];
      const fetch = async (input: string | URL | Request): Promise<Response> => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        requests.push(url);
        if (url === descriptor.assetUrl) return new Response(bytes.slice());
        throw new Error(`Network unavailable: ${url}`);
      };
      vi.stubGlobal('fetch', fetch);
      const definition = savedSnapshotDefinition('scratch', descriptor, {
        packageJsonText: fixture.payload.packageJsonText,
      });
      const first = await openSavedSnapshotOwner({ requests, fetch });
      await first.catalog.createScratch({ definition });
      await first.close();
      const root = '/.rifty/workbench/v2/projects/scratch/tree';
      const dependencyState = (tree: ExactFsTree) =>
        Object.keys(tree.files).filter(
          (path) =>
            path.startsWith(`${TARBALL_CACHE_ROOT}/`) ||
            path.startsWith(`${root}/node_modules/`) ||
            path === `${root}/package-lock.json` ||
            isInstallStampPath(path),
        );
      const reopened = await openSavedSnapshotOwner(
        { requests, fetch },
        first.fs.restartFromDurableState(),
      );
      let opened: OpenedPlaygroundProject | undefined;
      try {
        opened = await reopened.owner.openProject(definition);
        expect(opened.acquisition).toEqual({
          kind: 'install',
          snapshotFailures: [
            { snapshotId: descriptor.snapshotId, reason: expect.stringMatching(reason) },
          ],
        });
        expect(requests).toEqual([descriptor.assetUrl]);
        await opened.close();
        opened = undefined;
        await reopened.authority.flush();
        expect(dependencyState(reopened.fs.liveSnapshot()), 'no cache/tree/claim write').toEqual(
          [],
        );
        expect(dependencyState(reopened.fs.durableSnapshot())).toEqual([]);
      } finally {
        await opened?.close();
        await reopened.close();
      }
    },
    60_000,
  );

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
      expect(opened.acquisition).toMatchObject({ kind: 'saved' });
      expect(network.requests).toEqual([]);
      expect(reopened.fs.durableSnapshot()).toEqual(before);
      await opened.close();
    } finally {
      await opened?.close();
      await reopened.close();
    }
  });
});
