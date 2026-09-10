import { resetSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { installStampPath, readInstallStampSync, stampTrusted } from '../glue/install-stamp.ts';
import type { PlaygroundTrustedSnapshot } from '../workbench/playground.ts';
import type { OpenedPlaygroundProject } from './playground-project-authority.ts';
import {
  type SavedSnapshotFixture,
  bakeSavedSnapshotFixture,
  installSnapshotNetwork,
  openSavedSnapshotOwner,
  savedSnapshotDefinition,
  savedSnapshotSource,
  snapshotAssetUrl,
  unusedSnapshotAssetUrl,
} from './test-fixtures/snapshot-saved-state.ts';

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

type Endpoint = 'scratch' | 'named';

async function seed(endpoint: Endpoint, edited: boolean) {
  const network = installSnapshotNetwork(fixture);
  const h = await openSavedSnapshotOwner(network);
  const scratch = savedSnapshotDefinition('scratch', fixture.descriptor);
  await h.catalog.createScratch({ definition: scratch });
  const opened = await h.owner.openProject(scratch);
  expect(opened.acquisition).toMatchObject({
    kind: 'ready',
    provenance: { outcome: 'snapshot', snapshotId: fixture.snapshotId, packages: 1 },
  });
  const stamp = h.installStampClaims.read(opened.projectRoot);
  expect(stamp).not.toBeNull();
  const parsedStamp = readInstallStampSync(h.authority, opened.projectRoot);
  expect(parsedStamp).not.toBeNull();
  expect(parsedStamp !== null && stampTrusted(parsedStamp)).toBe(true);
  expect(network.requests).toEqual([snapshotAssetUrl]);
  expect(h.authority.readFileBytesSync(`${opened.projectRoot}/main.cjs`)).toEqual(
    encoder.encode(savedSnapshotSource),
  );
  expect(
    JSON.parse(
      decoder.decode(
        h.authority.readFileBytesSync(`${opened.projectRoot}/node_modules/ms/package.json`),
      ),
    ),
  ).toMatchObject({ name: 'ms', version: '2.0.0' });
  if (edited) {
    for (const [path, text] of [
      ['main.cjs', "console.log('local source');\n"],
      ['node_modules/ms/index.js', "module.exports = () => 'local dependency';\n"],
      ['node_modules/ms/local.txt', 'retained dependency extra\n'],
      ['user.txt', 'retained source extra\n'],
    ]) {
      h.authority.writeFileSync(`${opened.projectRoot}/${path}`, encoder.encode(text));
    }
    await h.owner.recordMutation({
      project: opened,
      kind: 'file',
      treeRevision: h.authority.treeRevision,
    });
  }
  await opened.close();
  const id = endpoint === 'scratch' ? 'scratch' : 'saved-project';
  const definition = savedSnapshotDefinition(id, fixture.descriptor);
  if (endpoint === 'named') {
    await h.catalog.saveScratch({ id, name: 'Saved snapshot', definition });
    const saved = await h.owner.openProject(definition);
    expect(saved.acquisition).toMatchObject({ kind: 'saved' });
    await saved.close();
    expect(network.requests).toEqual([snapshotAssetUrl]);
  }
  await h.authority.flush();
  const root = `/.rifty/workbench/v1/projects/${id}/tree`;
  return { h, network, definition, id, root };
}

function changedSnapshot(): PlaygroundTrustedSnapshot {
  return {
    ...fixture.descriptor,
    snapshotId: `sha256:${'0'.repeat(64)}`,
    assetUrl: unusedSnapshotAssetUrl,
  };
}

describe('I8 default snapshot application keeps saved state', () => {
  it.each([
    ['scratch', true],
    ['scratch', false],
    ['named', true],
    ['named', false],
  ] as const)(
    '%s saved project (edited=%s) ignores a changed unavailable snapshot',
    async (endpoint, edited) => {
      const { h, network, id } = await seed(endpoint, edited);
      const before = h.fs.durableSnapshot();
      const catalogBefore = h.catalog.snapshot();
      await h.close();
      network.requests.length = 0;
      const reopened = await openSavedSnapshotOwner(network, h.fs.restartFromDurableState());
      const arriving = savedSnapshotDefinition(id, changedSnapshot());
      let opened: OpenedPlaygroundProject | undefined;
      let failure: unknown;
      try {
        try {
          if (endpoint === 'scratch') {
            await reopened.catalog.createScratch({
              definition: arriving,
              preserveDirtySameStarter: true,
            });
          }
          opened = await reopened.owner.openProject(arriving);
        } catch (error) {
          failure = error;
        }
        expect.soft(failure, 'saved project must open despite the unused asset').toBeUndefined();
        expect.soft(opened?.acquisition).toMatchObject({ kind: 'saved' });
        expect.soft(network.requests, 'unused snapshot must never be fetched').toEqual([]);
        expect
          .soft(reopened.catalog.snapshot(), 'saved catalog provenance must remain unchanged')
          .toEqual(catalogBefore);
        expect
          .soft(reopened.fs.liveSnapshot(), 'all saved paths, types and bytes survive')
          .toEqual(before);
        expect.soft(reopened.fs.durableSnapshot(), 'no saved durability mutation').toEqual(before);
      } finally {
        await opened?.close();
        await reopened.close();
      }
    },
  );

  it.each([
    ['scratch', 'absent'],
    ['scratch', 'pending'],
    ['scratch', 'incompatible'],
    ['named', 'absent'],
    ['named', 'pending'],
    ['named', 'incompatible'],
  ] as const)(
    '%s consumed saved state with %s claim opens without acquisition or writes',
    async (endpoint, claimState) => {
      const { h, network, id, root } = await seed(endpoint, true);
      if (claimState === 'pending') {
        const interrupted = new Error('stop after real durable demotion');
        await expect(
          h.packages.mutations.packageJsonEdit({ root }, async () => {
            throw interrupted;
          }),
        ).rejects.toBe(interrupted);
      }
      await h.close();
      const storage = h.fs.restartFromDurableState();
      if (claimState === 'absent') {
        // Storage boundary: a lost claim cannot turn the retained tree into a new project.
        storage.rmSync(installStampPath(root), {});
      } else if (claimState === 'incompatible') {
        // Persisted claim from a different runtime recipe; all package bytes remain intact.
        const stamp = JSON.parse(
          decoder.decode(storage.readFileBytesSync(installStampPath(root))),
        ) as Record<string, unknown>;
        storage.writeFileSync(
          installStampPath(root),
          encoder.encode(
            JSON.stringify({ ...stamp, installArtifactIdentity: `sha256:${'f'.repeat(64)}` }),
          ),
        );
      }
      await storage.flush();
      const before = storage.durableSnapshot();
      network.requests.length = 0;
      const reopened = await openSavedSnapshotOwner(network, storage.restartFromDurableState());
      let opened: OpenedPlaygroundProject | undefined;
      let failure: unknown;
      try {
        try {
          opened = await reopened.owner.openProject(
            savedSnapshotDefinition(id, fixture.descriptor),
          );
        } catch (error) {
          failure = error;
        }
        expect.soft(failure, 'ADR-0415: install proof cannot reject saved access').toBeUndefined();
        expect.soft(opened?.acquisition).toEqual({ kind: 'saved' });
        expect
          .soft(network.requests, 'saved-state miss cannot trigger snapshot or registry arrival')
          .toEqual([]);
        expect
          .soft(reopened.fs.liveSnapshot(), 'no additions, deletes, source edits or stamp writes')
          .toEqual(before);
        expect
          .soft(reopened.fs.durableSnapshot(), 'preserve the complete persisted state')
          .toEqual(before);
      } finally {
        await opened?.close();
        await reopened.close();
      }
    },
  );
});
