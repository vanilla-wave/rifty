import { readFile } from 'node:fs/promises';
import { Shell } from '@riftydev/shell';
import { resetSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { createPlaygroundNpmObserver } from './playground-package-mutations.ts';
import {
  type SavedSnapshotFixture,
  bakeSavedSnapshotFixture,
  installSnapshotNetwork,
  openSavedSnapshotOwner,
  savedSnapshotDefinition,
} from './test-fixtures/snapshot-saved-state.ts';

const catalogPath = '/.rifty/workbench/playground/catalog.json';
const decoder = new TextDecoder();
let snapshot: SavedSnapshotFixture;
let packageTarball: Uint8Array<ArrayBuffer>;
let packageTarballUrl: string;

beforeAll(async () => {
  snapshot = await bakeSavedSnapshotFixture();
  const registry = new URL('../../../../tests/integration/fixtures/registry/', import.meta.url);
  packageTarball = new Uint8Array(await readFile(new URL('ms-2.0.0.tgz', registry)));
  const metadata = JSON.parse(await readFile(new URL('ms-2.0.0.json', registry), 'utf8')) as {
    readonly dist: { readonly upstreamTarball: string };
  };
  packageTarballUrl = metadata.dist.upstreamTarball;
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetSyncMirror();
});

// ADR-0414: an installed package cannot turn failed durable dirty reflection into npm success.
it.each(['quota-report', 'permission-rejection'] as const)(
  '%s while saving npm dirty state fails the command and preserves the catalog across reload',
  async (fault) => {
    const snapshotNetwork = installSnapshotNetwork(snapshot);
    const network = {
      requests: snapshotNetwork.requests,
      async fetch(input: string | URL | Request): Promise<Response> {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (url !== packageTarballUrl) return snapshotNetwork.fetch(input);
        network.requests.push(url);
        return new Response(packageTarball.slice());
      },
    };
    vi.stubGlobal('fetch', network.fetch);
    const definition = savedSnapshotDefinition('scratch', snapshot.descriptor);
    const seed = await openSavedSnapshotOwner(network);
    await seed.catalog.createScratch({ definition });
    await (await seed.owner.openProject(definition)).close();
    await seed.close();

    const open = async () => {
      const h = await openSavedSnapshotOwner(network, seed.fs.restartFromDurableState());
      const project = await h.owner.openProject(definition);
      const shell = new Shell({ cwd: project.projectRoot });
      shell.registerCommand(
        'npm',
        h.packages.createNpmCommand(
          async () => {
            throw new Error('unexpected npm script');
          },
          {
            observeOperation: createPlaygroundNpmObserver(h.authority, (kind, treeRevision) =>
              h.owner.recordMutation({ kind, treeRevision, project }),
            ),
          },
        ),
      );
      return { ...h, project, shell };
    };

    // Select the actual catalog persistence primitive from the same successful npm command.
    const healthy = await open();
    let catalogWriteOrdinal: number;
    try {
      healthy.fs.armPersistFailure(Number.MAX_SAFE_INTEGER, fault);
      const result = await healthy.shell.run('npm install --save-dev ms@2.0.0');
      expect(result).toMatchObject({ exitCode: 0, stderr: '' });
      expect(healthy.catalog.snapshot().scratch?.dirty).toBe(true);
      const write = healthy.fs.trace.find(
        ({ primitive }) => primitive.kind === 'write' && primitive.path === catalogPath,
      );
      if (write === undefined) throw new Error('npm did not persist its catalog dirty state');
      catalogWriteOrdinal = write.ordinal;
    } finally {
      await healthy.project.close();
      await healthy.close();
    }

    const failed = await open();
    const before = failed.catalog.snapshot();
    try {
      failed.fs.armPersistFailure(catalogWriteOrdinal, fault);
      const result = await failed.shell.run('npm install --save-dev ms@2.0.0');
      expect(failed.fs.trace.filter(({ outcome }) => outcome === 'injected-failure')).toEqual([
        expect.objectContaining({ primitive: expect.objectContaining({ path: catalogPath }) }),
      ]);
      const manifest = JSON.parse(
        decoder.decode(
          failed.authority.readFileBytesSync(`${failed.project.projectRoot}/package.json`),
        ),
      );
      expect(manifest.devDependencies).toEqual({ ms: '2.0.0' });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/quota|permission/);
      expect(failed.catalog.snapshot()).toEqual(before);
    } finally {
      await failed.project.close();
      await failed.close();
    }

    const reopened = await openSavedSnapshotOwner(network, failed.fs.restartFromDurableState());
    try {
      expect(reopened.catalog.snapshot()).toEqual(before);
    } finally {
      await reopened.close();
    }
  },
);
