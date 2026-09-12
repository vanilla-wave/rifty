import { Buffer } from 'node:buffer';
import { serializePackageJson } from '@riftydev/npm-client';
import { resetSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { restoreDepSnapshot } from '../glue/dep-snapshot.ts';
import { readInstallStampSync, stampTrusted } from '../glue/install-stamp.ts';
import type { OpenedPlaygroundProject } from './playground-project-authority.ts';
import { DurableOwnerFs, type ExactFsTree } from './test-fixtures/durable-owner-fs.ts';
import {
  type SavedSnapshotFixture,
  bakeSavedSnapshotFixture,
  installSnapshotNetwork,
  openSavedSnapshotOwner,
  savedSnapshotDefinition,
} from './test-fixtures/snapshot-saved-state.ts';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const legacyPrefix = '/workspaces/manifest_target';
const sourceText = "console.log('saved source outside payload');\n";
type Endpoint = 'scratch' | 'named' | 'legacy';
type ManifestState = 'absent' | 'malformed' | 'directory';
type Owner = Awaited<ReturnType<typeof openSavedSnapshotOwner>>;
let fixture: SavedSnapshotFixture;
let initializerManifest: string;
beforeAll(async () => {
  fixture = await bakeSavedSnapshotFixture();
  initializerManifest = serializePackageJson({
    ...(JSON.parse(fixture.payload.packageJsonText) as Record<string, unknown>),
    description: 'owned initializer, never the final applied manifest',
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetSyncMirror();
});

function damageManifest(
  fs: Pick<DurableOwnerFs, 'rmSync' | 'mkdirSync' | 'writeFileSync'>,
  root: string,
  state: ManifestState,
): void {
  const path = `${root}/package.json`;
  fs.rmSync(path, { recursive: true, force: true });
  if (state === 'malformed') fs.writeFileSync(path, encoder.encode('{ edited incomplete'));
  if (state === 'directory') {
    fs.mkdirSync(path, { recursive: true });
    fs.writeFileSync(`${path}/saved.txt`, encoder.encode('saved conflicting subtree\n'));
  }
}

function writeRetained(
  fs: Pick<DurableOwnerFs, 'mkdirSync' | 'writeFileSync'>,
  root: string,
): void {
  fs.writeFileSync(`${root}/main.cjs`, encoder.encode(sourceText));
  fs.writeFileSync(`${root}/user.bin`, new Uint8Array([0, 255, 128, 1]));
  fs.writeFileSync(`${root}/node_modules/ms/local.txt`, encoder.encode('saved dependency extra\n'));
  fs.mkdirSync(`${root}/empty-local`, { recursive: true });
}

async function seed(endpoint: Endpoint, state: ManifestState) {
  const network = installSnapshotNetwork(fixture);
  if (endpoint === 'legacy') {
    const id = 'manifest-legacy';
    const sourceRoot = `${legacyPrefix}/projects/${id}`;
    const fs = new DurableOwnerFs();
    fs.mkdirSync(sourceRoot, { recursive: true });
    fs.writeFileSync(`${sourceRoot}/package.json`, encoder.encode(fixture.payload.packageJsonText));
    await restoreDepSnapshot(fs, sourceRoot, fixture.payload);
    writeRetained(fs, sourceRoot);
    damageManifest(fs, sourceRoot, state);
    fs.writeFileSync(
      `${legacyPrefix}/.rifty-project-index.json`,
      encoder.encode(
        JSON.stringify({
          activeId: id,
          scratch: null,
          projects: [
            {
              id,
              name: 'Legacy manifest target',
              starter: 'saved-ms-starter',
              editedAt: '2026-09-01T00:00:00.000Z',
            },
          ],
        }),
      ),
    );
    await fs.flush();
    const h = await openSavedSnapshotOwner(network, fs.restartFromDurableState(), legacyPrefix);
    expect(h.catalog.snapshot().active).toEqual({ kind: 'project', id });
    expect(
      h.installStampClaims.read(sourceRoot),
      'legacy source carries bytes without invented trust',
    ).toBeNull();
    expect(network.requests).toEqual([]);
    return { h, network, id, sourceRoot };
  }

  const h = await openSavedSnapshotOwner(network);
  let opened: OpenedPlaygroundProject | undefined;
  try {
    const scratch = savedSnapshotDefinition('scratch', fixture.descriptor);
    await h.catalog.createScratch({ definition: scratch });
    opened = await h.owner.openProject(scratch);
    expect(opened.acquisition).toMatchObject({
      kind: 'ready',
      provenance: { outcome: 'snapshot', snapshotId: fixture.snapshotId },
    });
    const id = endpoint === 'named' ? 'manifest-named' : 'scratch';
    if (endpoint === 'named') {
      await opened.close();
      opened = undefined;
      const definition = savedSnapshotDefinition(id, fixture.descriptor);
      await h.catalog.saveScratch({ id, name: 'Named manifest target', definition });
      opened = await h.owner.openProject(definition);
      expect(opened.acquisition).toMatchObject({ kind: 'saved' });
    }
    const sourceRoot = opened.projectRoot;
    const prior = readInstallStampSync(h.authority, sourceRoot);
    expect(prior !== null && stampTrusted(prior)).toBe(true);
    await h.packages.mutations.guardedMutation(
      [
        { kind: 'replace', path: `${sourceRoot}/package.json` },
        { kind: 'write', path: `${sourceRoot}/main.cjs` },
        { kind: 'write', path: `${sourceRoot}/user.bin` },
        { kind: 'write', path: `${sourceRoot}/node_modules/ms/local.txt` },
        { kind: 'mkdir', path: `${sourceRoot}/empty-local` },
      ],
      async () => {
        writeRetained(h.authority, sourceRoot);
        damageManifest(h.authority, sourceRoot, state);
      },
    );
    await h.owner.recordMutation({
      project: opened,
      kind: 'file',
      treeRevision: h.authority.treeRevision,
    });
    await h.authority.flush();
    expect(network.requests).toEqual([fixture.descriptor.assetUrl]);
    network.requests.length = 0;
    return { h, network, id, sourceRoot };
  } catch (error) {
    await opened?.close();
    await h.close();
    throw error;
  } finally {
    await opened?.close();
  }
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

function expectRestored(h: Owner, root: string): void {
  expect(h.authority.statSyncOrNull(`${root}/package.json`)?.isFile).toBe(true);
  expect(decoder.decode(h.authority.readFileBytesSync(`${root}/package.json`))).toBe(
    fixture.payload.packageJsonText,
  );
  expect(decoder.decode(h.authority.readFileBytesSync(`${root}/package-lock.json`))).toBe(
    fixture.payload.lockfile,
  );
  expect(h.authority.existsSync(`${root}/package.json/saved.txt`)).toBe(false);
  expect(decoder.decode(h.authority.readFileBytesSync(`${root}/main.cjs`))).toBe(sourceText);
  expect(h.authority.readFileBytesSync(`${root}/user.bin`)).toEqual(
    new Uint8Array([0, 255, 128, 1]),
  );
  expect(decoder.decode(h.authority.readFileBytesSync(`${root}/node_modules/ms/local.txt`))).toBe(
    'saved dependency extra\n',
  );
  expect(h.authority.statSyncOrNull(`${root}/empty-local`)?.isDirectory).toBe(true);
  for (const file of fixture.payload.nodeModules.files) {
    const bytes = Uint8Array.from(atob(file.content), (character) => character.charCodeAt(0));
    expect(
      Buffer.compare(h.authority.readFileBytesSync(`${root}/node_modules/${file.path}`), bytes),
    ).toBe(0);
  }
  const stamp = readInstallStampSync(h.authority, root);
  expect(stamp !== null && stampTrusted(stamp)).toBe(true);
  expect(
    stamp?.packageJsonText,
    'verified payload owns final manifest/claim before readiness',
  ).toBe(fixture.payload.packageJsonText);
}

const cases = (['scratch', 'named', 'legacy'] as const).flatMap((endpoint) =>
  (['absent', 'malformed', 'directory'] as const).flatMap((state) =>
    (['error', 'overwrite'] as const).map((conflict) => ({ endpoint, state, conflict })),
  ),
);

describe('I8 snapshot application treats saved package.json as an ordinary payload target', () => {
  it.each(cases)(
    '$endpoint $state package.json obeys $conflict with saved unrelated bytes retained',
    async ({ endpoint, state, conflict }) => {
      const { h, network, id } = await seed(endpoint, state);
      const before = h.fs.durableSnapshot();
      expectExactTree(h.fs.liveSnapshot(), before);
      let opened: OpenedPlaygroundProject | undefined;
      let failure: unknown;
      try {
        try {
          opened = await h.owner.openProject(
            savedSnapshotDefinition(id, fixture.descriptor, {
              packageJsonText: initializerManifest,
              application: { mode: 'apply-snapshot', conflict },
            }),
          );
        } catch (error) {
          failure = error;
        }
        expect
          .soft(network.requests, 'one selected payload fetch, no registry fallback')
          .toEqual([fixture.descriptor.assetUrl]);
        if (conflict === 'error' && state !== 'absent') {
          expect.soft(failure).toMatchObject({
            name: 'SnapshotApplicationConflictError',
            conflictingPaths: ['/package.json'],
          });
          expect.soft(opened).toBeUndefined();
          expectExactTree(h.fs.liveSnapshot(), before);
          expectExactTree(h.fs.durableSnapshot(), before);
        } else {
          expect.soft(failure).toBeUndefined();
          expect.soft(opened?.acquisition).toMatchObject({
            kind: 'ready',
            provenance: { outcome: 'snapshot', snapshotId: fixture.snapshotId },
          });
          if (opened === undefined) return;
          const root = opened.projectRoot;
          expectRestored(h, root);
          await opened.close();
          opened = undefined;
          network.requests.length = 0;
          opened = await h.owner.openProject(
            savedSnapshotDefinition(
              id,
              {
                ...fixture.descriptor,
                assetUrl: 'https://host.test/unused-manifest-initializer.tar.gz',
              },
              { packageJsonText: initializerManifest },
            ),
          );
          expect(opened.acquisition).toMatchObject({ kind: 'saved' });
          expect(network.requests, 'default reopen uses CURRENT manifest, not initializer').toEqual(
            [],
          );
          expectRestored(h, root);
        }
      } finally {
        await opened?.close();
        await h.close();
      }
    },
  );
});
