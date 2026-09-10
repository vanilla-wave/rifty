import { resetSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { installStampPath } from '../glue/install-stamp.ts';
import {
  type SavedSnapshotFixture,
  bakeSavedSnapshotFixture,
  installSnapshotNetwork,
  openSavedSnapshotOwner,
  savedSnapshotDefinition,
} from './test-fixtures/snapshot-saved-state.ts';

const encoder = new TextEncoder();
let fixture: SavedSnapshotFixture;
beforeAll(async () => {
  fixture = await bakeSavedSnapshotFixture();
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetSyncMirror();
});

describe('PR323 readable saved projects are independent of install certification', () => {
  it.each(['absent', 'pending', 'incompatible', 'malformed-lock', 'missing-package'] as const)(
    '%s: preserves saved bytes and admits a child without automatic acquisition',
    async (fault) => {
      const network = installSnapshotNetwork(fixture);
      const first = await openSavedSnapshotOwner(network);
      const definition = savedSnapshotDefinition('scratch', fixture.descriptor);
      await first.catalog.createScratch({ definition });
      const original = await first.owner.openProject(definition);
      const root = original.projectRoot;
      first.authority.writeFileSync(
        `${root}/local.cjs`,
        encoder.encode("console.log('local source');\n"),
      );
      await original.close();
      if (fault === 'pending') {
        await first.packages.mutations.packageJsonEdit({ root }, async () => {
          first.authority.writeFileSync(
            `${root}/package.json`,
            encoder.encode('{"dependencies":{"ms":"2.0.0","lodash":"4.17.21"}}'),
          );
        });
      }
      await first.authority.flush();
      await first.close();
      const storage = first.fs.restartFromDurableState();
      if (fault === 'absent') storage.rmSync(installStampPath(root), {});
      if (fault === 'incompatible') {
        const stamp = JSON.parse(
          new TextDecoder().decode(storage.readFileBytesSync(installStampPath(root))),
        ) as Record<string, unknown>;
        storage.writeFileSync(
          installStampPath(root),
          encoder.encode(
            JSON.stringify({ ...stamp, installArtifactIdentity: `sha256:${'f'.repeat(64)}` }),
          ),
        );
      }
      if (fault === 'malformed-lock')
        storage.writeFileSync(`${root}/package-lock.json`, encoder.encode('not JSON'));
      if (fault === 'missing-package')
        storage.rmSync(`${root}/node_modules/ms`, { recursive: true });
      await storage.flush();
      const before = storage.durableSnapshot();
      network.requests.length = 0;
      const fresh = await openSavedSnapshotOwner(network, storage.restartFromDurableState());
      try {
        const project = await fresh.owner.openProject(definition);
        const child = await fresh.packages.reserveChildAdmission(root);
        expect(child.snapshot.runtimeBindings).toEqual([]);
        child.commit();
        expect(network.requests).toEqual([]);
        expect(fresh.fs.liveSnapshot()).toEqual(before);
        expect(fresh.fs.durableSnapshot()).toEqual(before);
        await project.close();
      } finally {
        await fresh.close();
      }
    },
  );
});
