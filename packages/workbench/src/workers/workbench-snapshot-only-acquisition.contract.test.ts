import { resetSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { sha256Identity } from '../glue/dep-snapshot.ts';
import { installStampPath, readInstallStampSync, stampTrusted } from '../glue/install-stamp.ts';
import {
  deserializeWorkbenchOwnerError,
  serializeWorkbenchOwnerError,
} from '../workbench/errors.ts';
import { inspectWorkbenchOwnerToPageMessage } from '../workbench/owner-protocol.ts';
import type { PlaygroundTrustedSnapshot } from '../workbench/playground.ts';
import { defineNodeCliProject, inspectProjectDefinition } from '../workbench/project-definition.ts';
import type { OpenedPlaygroundProject } from './playground-project-authority.ts';
import {
  installOnlyDefinition,
  openSnapshotOnlyOwner,
  snapshotOnlyNetwork,
} from './test-fixtures/snapshot-only-owner.ts';
import { bakeSnapshotOnlyShadowFixture } from './test-fixtures/snapshot-only-producer.ts';
import {
  type SavedSnapshotFixture,
  bakeSavedSnapshotFixture,
  savedSnapshotDefinition,
  savedSnapshotManifest,
  savedSnapshotSource,
} from './test-fixtures/snapshot-saved-state.ts';
import { workbenchPackageConfig } from './workbench-package-config.ts';

const encoder = new TextEncoder();
const assetUrl = 'https://host.test/required-asset.tar.gz';
let fixture: SavedSnapshotFixture;
beforeAll(async () => {
  fixture = await bakeSavedSnapshotFixture({ assetUrl });
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetSyncMirror();
});

function publicFailure(error: unknown): Error {
  const frame = inspectWorkbenchOwnerToPageMessage(
    structuredClone({
      type: 'workbench:failure',
      opId: 'required-snapshot',
      error: serializeWorkbenchOwnerError(error),
    }),
  );
  if (frame.type !== 'workbench:failure') throw new Error('failure frame required');
  return deserializeWorkbenchOwnerError(frame.error);
}

function assertTrusted(h: Awaited<ReturnType<typeof openSnapshotOnlyOwner>>, root: string) {
  const stamp = readInstallStampSync(h.authority, root);
  expect(stamp).not.toBeNull();
  expect(stamp !== null && stampTrusted(stamp)).toBe(true);
  expect(
    JSON.parse(
      new TextDecoder().decode(
        h.authority.readFileBytesSync(`${root}/node_modules/ms/package.json`),
      ),
    ),
  ).toMatchObject({ name: 'ms', version: '2.0.0' });
}

async function seededOwner() {
  const network = snapshotOnlyNetwork();
  network.routes.set(assetUrl, () => new Response(fixture.archive.slice()));
  const h = await openSnapshotOnlyOwner(network);
  const definition = savedSnapshotDefinition('scratch', fixture.descriptor);
  await h.catalog.createScratch({ definition });
  const opened = await h.owner.openProject(definition);
  expect(opened.acquisition).toMatchObject({
    kind: 'ready',
    provenance: { outcome: 'snapshot', packages: 1 },
  });
  assertTrusted(h, opened.projectRoot);
  return { h, network, definition, opened };
}

type FailureKind =
  | 'http-refusal'
  | 'hash-mismatch'
  | 'template-mismatch'
  | 'artifact-mismatch'
  | 'corrupt'
  | 'over-limit';

async function rejectedAsset(kind: FailureKind) {
  let descriptor: PlaygroundTrustedSnapshot = fixture.descriptor;
  let response = () => new Response(fixture.archive.slice());
  let reason: RegExp;
  switch (kind) {
    case 'http-refusal':
      response = () => new Response('external storage unavailable', { status: 503 });
      reason = /503/;
      break;
    case 'hash-mismatch':
      descriptor = { ...descriptor, snapshotId: `sha256:${'0'.repeat(64)}` };
      reason = /(?:hash|identity|snapshot-id).*(?:mismatch|does not match)/i;
      break;
    case 'template-mismatch': {
      const bytes = encoder.encode(
        JSON.stringify({ ...fixture.payload, templateId: 'different-template' }),
      );
      descriptor = { ...descriptor, snapshotId: await sha256Identity(bytes) };
      response = () => new Response(bytes.slice());
      reason = /template.*mismatch/i;
      break;
    }
    case 'artifact-mismatch': {
      const bytes = encoder.encode(
        JSON.stringify({
          ...fixture.payload,
          installArtifactIdentity: `sha256:${'f'.repeat(64)}`,
        }),
      );
      descriptor = { ...descriptor, snapshotId: await sha256Identity(bytes) };
      response = () => new Response(bytes.slice());
      reason = /install-artifact-identity-mismatch/;
      break;
    }
    case 'corrupt': {
      const bytes = encoder.encode('{ invalid json');
      descriptor = { ...descriptor, snapshotId: await sha256Identity(bytes) };
      response = () => new Response(bytes.slice());
      reason = /parse|JSON|malformed/i;
      break;
    }
    case 'over-limit':
      response = () =>
        new Response('bounded asset must reject before draining', {
          headers: { 'Content-Length': String(128 * 1024 * 1024 + 1) },
        });
      reason = /limit|exceed|too large/i;
      break;
  }
  return { descriptor, response, reason };
}

describe('I3 owner policy without a registry capability', () => {
  it('admits a genuine producer artifact, then reuses its trusted tree without acquisition', async () => {
    const { h, network, definition, opened } = await seededOwner();
    try {
      expect(network.requests).toEqual([assetUrl]);
      expect(h.authority.readFileBytesSync(`${opened.projectRoot}/main.cjs`)).toEqual(
        encoder.encode(savedSnapshotSource),
      );
      await opened.close();
      const before = h.fs.durableSnapshot();
      network.requests.length = 0;
      const warm = await h.owner.openProject(definition);
      expect(warm.acquisition).toMatchObject({
        kind: 'ready',
        provenance: { outcome: 'existing' },
      });
      assertTrusted(h, warm.projectRoot);
      expect(network.requests).toEqual([]);
      expect(h.fs.liveSnapshot()).toEqual(before);
      await warm.close();
    } finally {
      await opened.close();
      await h.close();
    }
  });

  it.each<FailureKind>([
    'http-refusal',
    'hash-mismatch',
    'template-mismatch',
    'artifact-mismatch',
    'corrupt',
    'over-limit',
  ])(
    'required %s failure rejects, retains first-admission bytes and preserves a public reason',
    async (kind) => {
      const rejected = await rejectedAsset(kind);
      const network = snapshotOnlyNetwork();
      network.routes.set(assetUrl, rejected.response);
      const h = await openSnapshotOnlyOwner(network);
      const definition = savedSnapshotDefinition('scratch', rejected.descriptor);
      await h.catalog.createScratch({ definition });
      const before = h.fs.durableSnapshot();
      let opened: OpenedPlaygroundProject | undefined;
      let failure: unknown;
      try {
        try {
          opened = await h.owner.openProject(definition);
        } catch (error) {
          failure = error;
        }
        expect
          .soft(failure, 'snapshot-only must never admit deferred installation')
          .toBeInstanceOf(Error);
        expect
          .soft(opened, 'no guest/session-ready handle after required snapshot failure')
          .toBeUndefined();
        expect
          .soft(publicFailure(failure).message, 'concrete reason must cross the actual owner wire')
          .toMatch(rejected.reason);
        expect
          .soft(network.requests, 'snapshot asset only; no registry/Eddy fallback')
          .toEqual([assetUrl]);
        expect
          .soft(h.fs.liveSnapshot(), 'receipt, catalog, files, cache and claims remain exact')
          .toEqual(before);
        expect.soft(h.fs.durableSnapshot()).toEqual(before);
        if (kind === 'http-refusal') {
          await opened?.close();
          opened = undefined;
          network.routes.set(assetUrl, () => new Response(fixture.archive.slice()));
          let retried: OpenedPlaygroundProject | undefined;
          let retryFailure: unknown;
          try {
            retried = await h.owner.openProject(definition);
          } catch (error) {
            retryFailure = error;
          }
          expect
            .soft(retryFailure, 'failed first acquisition must remain retryable on the same owner')
            .toBeUndefined();
          expect
            .soft(retried?.acquisition)
            .toMatchObject({ kind: 'ready', provenance: { outcome: 'snapshot' } });
          expect.soft(network.requests).toEqual([assetUrl, assetUrl]);
          await retried?.close();
        }
      } finally {
        await opened?.close();
        await h.close();
      }
    },
  );

  it('cold companion install cannot become a deferred plan', async () => {
    const network = snapshotOnlyNetwork();
    const h = await openSnapshotOnlyOwner(network);
    const definition = installOnlyDefinition();
    await h.catalog.createScratch({ definition });
    const before = h.fs.durableSnapshot();
    let opened: OpenedPlaygroundProject | undefined;
    let failure: unknown;
    try {
      try {
        opened = await h.owner.openProject(definition);
      } catch (error) {
        failure = error;
      }
      expect.soft(failure).toBeInstanceOf(Error);
      expect.soft(opened).toBeUndefined();
      expect
        .soft(publicFailure(failure).message)
        .toMatch(/snapshot-only|registry.*unavailable|acquisition.*unavailable/i);
      expect.soft(h.fs.liveSnapshot()).toEqual(before);
      expect.soft(h.fs.durableSnapshot()).toEqual(before);
      expect.soft(network.requests).toEqual([]);
    } finally {
      await opened?.close();
      await h.close();
    }
  });

  it('missing actual LightningCSS replay bytes cannot be softened into a deferred install', async () => {
    const native = await bakeSnapshotOnlyShadowFixture();
    const bytes = encoder.encode(
      JSON.stringify({
        ...native.payload,
        tarballCache: { ...native.payload.tarballCache, files: [] },
      }),
    );
    const descriptor = { ...native.descriptor, snapshotId: await sha256Identity(bytes) };
    const network = snapshotOnlyNetwork();
    network.routes.set(descriptor.assetUrl, () => new Response(bytes.slice()));
    const h = await openSnapshotOnlyOwner(network);
    const definition = savedSnapshotDefinition('scratch', descriptor, {
      packageJsonText: native.payload.packageJsonText,
    });
    await h.catalog.createScratch({ definition });
    const before = h.fs.durableSnapshot();
    let opened: OpenedPlaygroundProject | undefined;
    let failure: unknown;
    try {
      try {
        opened = await h.owner.openProject(definition);
      } catch (error) {
        failure = error;
      }
      expect.soft(failure).toBeInstanceOf(Error);
      expect.soft(opened).toBeUndefined();
      expect
        .soft(publicFailure(failure).message)
        .toMatch(/replay.*(?:missing|absent)|(?:missing|absent).*replay/i);
      expect.soft(h.fs.liveSnapshot()).toEqual(before);
      expect.soft(h.fs.durableSnapshot()).toEqual(before);
      expect.soft(network.requests).toEqual([descriptor.assetUrl]);
    } finally {
      await opened?.close();
      await h.close();
    }
  }, 30_000);

  it('the core actor automatic entry cannot bypass policy with its install fallback', async () => {
    const network = snapshotOnlyNetwork();
    const h = await openSnapshotOnlyOwner(network);
    const root = '/core-project';
    const definition = inspectProjectDefinition(
      defineNodeCliProject({
        id: 'core-project',
        entryPath: '/main.cjs',
        files: { '/package.json': savedSnapshotManifest, '/main.cjs': savedSnapshotSource },
      }),
    );
    h.authority.mkdirSync(root, { recursive: true });
    for (const [path, bytes] of Object.entries(definition.files))
      h.authority.writeFileSync(`${root}${path}`, bytes);
    h.authority.mkdirSync(`${root}/node_modules`, { recursive: true });
    h.authority.writeFileSync(
      `${root}/node_modules/retained-local.txt`,
      encoder.encode('untrusted retained user bytes'),
    );
    h.authority.writeFileSync(`${root}/user.txt`, encoder.encode('ordinary core project file'));
    await h.authority.flush();
    const before = h.fs.durableSnapshot();
    let failure: unknown;
    try {
      try {
        await h.packages.activateAndEnsure(
          workbenchPackageConfig(definition, root, {
            packageJsonBytes: h.authority.readFileBytesSync(`${root}/package.json`),
          }),
        );
      } catch (error) {
        failure = error;
      }
      expect.soft(failure).toBeInstanceOf(Error);
      expect
        .soft(publicFailure(failure).message)
        .toMatch(/snapshot-only|registry.*unavailable|acquisition.*unavailable/i);
      expect
        .soft(h.fs.liveSnapshot(), 'refuse automatic install before claim demotion and preparation')
        .toEqual(before);
      expect.soft(h.fs.durableSnapshot()).toEqual(before);
      expect.soft(network.requests).toEqual([]);
    } finally {
      await h.close();
    }
  });

  it('registry-enabled companion keeps its existing deferred fallback with recorded reason', async () => {
    const network = snapshotOnlyNetwork();
    network.routes.set(assetUrl, () => new Response('unavailable', { status: 503 }));
    const h = await openSnapshotOnlyOwner(network, undefined, 'registry');
    const definition = savedSnapshotDefinition('scratch', fixture.descriptor);
    await h.catalog.createScratch({ definition });
    const opened = await h.owner.openProject(definition);
    try {
      expect(opened.acquisition).toMatchObject({
        kind: 'install',
        snapshotFailures: [{ reason: expect.stringContaining('503') }],
      });
      expect(network.requests).toEqual([assetUrl]);
    } finally {
      await opened.close();
      await h.close();
    }
  });

  it('saved edits ignore an unused changed asset; explicitly applying it refuses without changes', async () => {
    const { h, network, opened } = await seededOwner();
    h.authority.writeFileSync(
      `${opened.projectRoot}/main.cjs`,
      encoder.encode("console.log('saved source');\n"),
    );
    h.authority.writeFileSync(
      `${opened.projectRoot}/node_modules/ms/index.js`,
      encoder.encode("module.exports = () => 'saved dependency';\n"),
    );
    h.authority.writeFileSync(`${opened.projectRoot}/user.txt`, encoder.encode('retained extra'));
    await h.owner.recordMutation({
      project: opened,
      kind: 'file',
      treeRevision: h.authority.treeRevision,
    });
    await opened.close();
    const named = savedSnapshotDefinition('saved-project', fixture.descriptor);
    await h.catalog.saveScratch({ id: 'saved-project', name: 'Saved', definition: named });
    await h.close();
    network.requests.length = 0;
    const restarted = await openSnapshotOnlyOwner(network, h.fs.restartFromDurableState());
    const changed = {
      ...fixture.descriptor,
      snapshotId: `sha256:${'0'.repeat(64)}`,
      assetUrl: 'https://host.test/unused-asset.tar.gz',
    };
    network.routes.set(changed.assetUrl, () => new Response('unavailable', { status: 503 }));
    const before = restarted.fs.durableSnapshot();
    let saved: OpenedPlaygroundProject | undefined;
    let applied: OpenedPlaygroundProject | undefined;
    try {
      saved = await restarted.owner.openProject(savedSnapshotDefinition('saved-project', changed));
      expect(saved.acquisition).toMatchObject({
        kind: 'ready',
        provenance: { outcome: 'existing' },
      });
      assertTrusted(restarted, saved.projectRoot);
      expect(network.requests).toEqual([]);
      expect(restarted.fs.liveSnapshot()).toEqual(before);
      await saved.close();
      let failure: unknown;
      try {
        applied = await restarted.owner.openProject(
          savedSnapshotDefinition('saved-project', changed, {
            application: { mode: 'apply-snapshot', conflict: 'overwrite' },
          }),
        );
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(Error);
      expect(applied).toBeUndefined();
      expect(publicFailure(failure).message).toMatch(/503/);
      expect(network.requests).toEqual([changed.assetUrl]);
      expect(restarted.fs.liveSnapshot()).toEqual(before);
      expect(restarted.fs.durableSnapshot()).toEqual(before);
    } finally {
      await saved?.close();
      await applied?.close();
      await restarted.close();
    }
  });

  it('missing saved claim cannot relabel user bytes as initial deployment', async () => {
    const { h, network, definition, opened } = await seededOwner();
    const root = opened.projectRoot;
    await opened.close();
    await h.close();
    const storage = h.fs.restartFromDurableState();
    storage.rmSync(installStampPath(root), {});
    await storage.flush();
    network.requests.length = 0;
    const restarted = await openSnapshotOnlyOwner(network, storage.restartFromDurableState());
    const before = restarted.fs.durableSnapshot();
    try {
      await expect(restarted.owner.openProject(definition)).rejects.toThrow(/saved|trusted|stamp/i);
      expect(network.requests).toEqual([]);
      expect(restarted.fs.liveSnapshot()).toEqual(before);
      expect(restarted.fs.durableSnapshot()).toEqual(before);
    } finally {
      await restarted.close();
    }
  });
});
