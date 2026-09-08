import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { gunzipSync, gzipSync } from 'node:zlib';
import { RegistryClient, serializePackageJson } from '@riftydev/npm-client';
import { MemoryFsSync, resetSyncMirror, setSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { produceDependencySnapshot } from '../glue/dep-snapshot-producer.ts';
import { decodeDepSnapshotTar } from '../glue/dep-snapshot-tar.ts';
import { parseDepSnapshot, serializeDepSnapshotTar } from '../glue/dep-snapshot.ts';
import { readInstallStampSync, stampTrusted } from '../glue/install-stamp.ts';
import { SyncMirrorVfs } from '../glue/sync-mirror-vfs.ts';
import { createOwnerPackageState } from './owner-package-state.ts';
import { createOwnerVfsAuthorityComposition } from './owner-vfs-authority.ts';
import {
  type OpenedPlaygroundProject,
  createPlaygroundProjectAuthority,
} from './playground-project-authority.ts';
import { type ExactFsTree, snapshotExactFsTree } from './test-fixtures/durable-owner-fs.ts';
import {
  type SavedSnapshotFixture,
  installSnapshotNetwork,
  savedSnapshotDefinition,
} from './test-fixtures/snapshot-saved-state.ts';
import { workbenchFirstMaterializationPackageConfig } from './workbench-package-config.ts';

const registryUrl = 'https://snapshot-registry.test';
const source = "console.log('snapshot validation fixture');\n";
const decoder = new TextDecoder();
type Fault = 'corrupt-replay-cache' | 'missing-replay-cache' | 'incompatible-install-artifact';
let valid: SavedSnapshotFixture;
let invalid: Readonly<Record<Fault, SavedSnapshotFixture>>;

async function produceLightningSnapshot(): Promise<SavedSnapshotFixture> {
  const fixtureRoot = new URL('../../../../tools/shadow-registry/src/fixtures/', import.meta.url);
  const metadata = JSON.parse(
    await readFile(new URL('lightningcss-wasm-1.32.0-registry.json', fixtureRoot), 'utf8'),
  ) as {
    readonly name: string;
    readonly version: string;
    readonly dist: { readonly integrity: string };
  };
  const lock = JSON.parse(
    await readFile(
      new URL(
        '../../../../tests/e2e/fixtures/npm-lock-replay/vite8/package-lock.json',
        import.meta.url,
      ),
      'utf8',
    ),
  ) as {
    readonly packages: Readonly<Record<string, unknown>>;
  };
  const nativePin = lock.packages['node_modules/lightningcss'];
  expect(nativePin, 'real caller lock must contain the native source pin').toBeDefined();
  const tarball = new Uint8Array(
    await readFile(new URL('lightningcss-wasm-1.32.0.tgz', fixtureRoot)),
  );
  const tarballUrl = `${registryUrl}/lightningcss-wasm/-/lightningcss-wasm-1.32.0.tgz`;
  const requests: string[] = [];
  vi.stubGlobal('fetch', async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    requests.push(url);
    if (url === `${registryUrl}/lightningcss-wasm`)
      return Response.json({
        name: metadata.name,
        'dist-tags': { latest: metadata.version },
        versions: {
          [metadata.version]: { ...metadata, dist: { ...metadata.dist, tarball: tarballUrl } },
        },
      });
    if (url === tarballUrl) return new Response(tarball.slice());
    throw new Error(`Unexpected producer network: ${url}`);
  });
  const manifest = {
    name: 'apply-validation',
    version: '1.0.0',
    dependencies: { lightningcss: '^1.32.0' },
  };
  const produced = await produceDependencySnapshot({
    templateId: 'saved-ms',
    registryUrl,
    packageJsonText: serializePackageJson(manifest),
    packageLockText: JSON.stringify({
      name: manifest.name,
      version: manifest.version,
      lockfileVersion: 3,
      requires: true,
      packages: { '': manifest, 'node_modules/lightningcss': nativePin },
    }),
  });
  expect(requests).toEqual([`${registryUrl}/lightningcss-wasm`, tarballUrl]);
  const payload = parseDepSnapshot(
    JSON.stringify(decodeDepSnapshotTar(new Uint8Array(gunzipSync(produced.archive)))),
  );
  expect(payload.tarballCache.files).toHaveLength(1);
  const cached = payload.tarballCache.files[0];
  expect(cached).toBeDefined();
  if (cached === undefined) throw new Error('real producer omitted LightningCSS replay bytes');
  expect(
    Buffer.compare(
      Uint8Array.from(atob(cached.content), (character) => character.charCodeAt(0)),
      tarball,
    ),
  ).toBe(0);
  return {
    ...produced,
    payload,
    descriptor: {
      snapshotId: produced.snapshotId,
      templateId: payload.templateId,
      assetUrl: 'https://host.test/lightning-valid.tar.gz',
    },
  };
}

function invalidArtifact(fault: Fault): SavedSnapshotFixture {
  const payload =
    fault === 'incompatible-install-artifact'
      ? { ...valid.payload, installArtifactIdentity: `sha256:${'0'.repeat(64)}` }
      : {
          ...valid.payload,
          tarballCache: {
            ...valid.payload.tarballCache,
            files:
              fault === 'missing-replay-cache'
                ? []
                : valid.payload.tarballCache.files.map((file) => ({
                    ...file,
                    content: btoa('corrupted replay bytes'),
                  })),
          },
        };
  const tar = serializeDepSnapshotTar(payload);
  const snapshotId = `sha256:${createHash('sha256').update(tar).digest('hex')}`;
  expect(snapshotId).not.toBe(valid.snapshotId);
  expect(parseDepSnapshot(JSON.stringify(decodeDepSnapshotTar(tar))).packageJsonText).toBe(
    valid.payload.packageJsonText,
  );
  return {
    archive: new Uint8Array(gzipSync(tar)),
    snapshotId,
    installArtifactIdentity: payload.installArtifactIdentity,
    payload,
    descriptor: { ...valid.descriptor, snapshotId, assetUrl: `https://host.test/${fault}.tar.gz` },
  };
}

beforeAll(async () => {
  valid = await produceLightningSnapshot();
  invalid = {
    'corrupt-replay-cache': invalidArtifact('corrupt-replay-cache'),
    'missing-replay-cache': invalidArtifact('missing-replay-cache'),
    'incompatible-install-artifact': invalidArtifact('incompatible-install-artifact'),
  };
}, 30_000);
afterEach(() => {
  vi.unstubAllGlobals();
  resetSyncMirror();
});

/** Real memory owner graph; persistence faults belong to the separate OPFS carrier. */
async function seedWarmOwner(artifact: SavedSnapshotFixture) {
  const network = installSnapshotNetwork(valid, artifact);
  const fs = new MemoryFsSync();
  const composition = createOwnerVfsAuthorityComposition(fs, { initialRoots: ['/', '/.rifty'] });
  const vfs = new SyncMirrorVfs();
  setSyncMirror(composition.authority, { async: vfs });
  const packages = createOwnerPackageState({
    vfs,
    fsSync: composition.authority,
    installStampClaims: composition.installStampClaims,
    flush: () => composition.authority.flush(),
    nodeWorkerRuntimeEnv: {},
    log: () => {},
    registry: new RegistryClient({ baseUrl: registryUrl, maxRetries: 0, fetch: network.fetch }),
    resolverUrl: () => undefined,
    resolverBundleBaseUrl: () => undefined,
    resolverPin: () => undefined,
  });
  const owner = await createPlaygroundProjectAuthority({
    ...composition,
    persistence: 'ephemeral',
    now: () => '2026-09-08T00:00:00.000Z',
    createStageId: () => globalThis.crypto.randomUUID(),
    acquisition: {
      ensure: (request) =>
        packages.activateAndEnsure(
          workbenchFirstMaterializationPackageConfig(request.definition, request.projectRoot, {
            packageJsonBytes: composition.authority.readFileBytesSync(
              `${request.projectRoot}/package.json`,
            ),
          }),
        ),
    },
    projectSave: packages,
  });
  const definition = savedSnapshotDefinition('scratch', valid.descriptor, {
    packageJsonText: valid.payload.packageJsonText,
    source,
  });
  await owner.createScratch({ definition });
  const initial = await owner.openProject(definition);
  expect(initial.acquisition).toMatchObject({
    kind: 'ready',
    provenance: { outcome: 'snapshot', snapshotId: valid.snapshotId },
  });
  const root = initial.projectRoot;
  await initial.close();
  const warm = await owner.openProject(definition);
  expect(warm.acquisition).toMatchObject({ kind: 'ready', provenance: { outcome: 'existing' } });
  await warm.close();
  expect(network.requests).toEqual([valid.descriptor.assetUrl]);
  expect(decoder.decode(composition.authority.readFileBytesSync(`${root}/package.json`))).toBe(
    artifact.payload.packageJsonText,
  );
  const stamp = readInstallStampSync(composition.authority, root);
  expect(stamp !== null && stampTrusted(stamp)).toBe(true);
  for (const file of valid.payload.tarballCache.files) {
    expect(
      Buffer.compare(
        composition.authority.readFileBytesSync(`${valid.payload.tarballCache.root}/${file.path}`),
        Uint8Array.from(atob(file.content), (character) => character.charCodeAt(0)),
      ),
    ).toBe(0);
  }
  network.requests.length = 0;
  return { ...composition, fs, owner, packages, network };
}

function failureReason(failure: unknown): string {
  if (!(failure instanceof Error)) return String(failure);
  return [
    failure.message,
    'snapshotFailures' in failure ? JSON.stringify(failure.snapshotFailures) : '',
    failure.cause === undefined ? '' : failureReason(failure.cause),
  ].join('\n');
}

function expectExactTree(actual: ExactFsTree, expected: ExactFsTree): void {
  expect.soft(actual.directories).toEqual(expected.directories);
  expect.soft(Object.keys(actual.files)).toEqual(Object.keys(expected.files));
  for (const [path, bytes] of Object.entries(expected.files)) {
    const found = actual.files[path];
    expect.soft(found !== undefined, `retained ${path}`).toBe(true);
    if (found !== undefined)
      expect.soft(Buffer.compare(found, bytes), `exact bytes ${path}`).toBe(0);
  }
}

describe('I8 explicit snapshot apply validates the artifact before effects over a warm tree', () => {
  it.each([
    ['corrupt-replay-cache', /replay.*integrity|cache.*integrity/i],
    ['missing-replay-cache', /cache.*(closure|missing)|missing.*cache/i],
    ['incompatible-install-artifact', /install.artifact.*(identity|mismatch|incompatib)/i],
  ] as const)(
    '%s fails despite compatible manifest and valid cached replay bytes',
    async (fault, reason) => {
      const artifact = invalid[fault];
      const h = await seedWarmOwner(artifact);
      const before = snapshotExactFsTree(h.fs);
      const catalogBefore = h.owner.catalogSnapshot();
      let opened: OpenedPlaygroundProject | undefined;
      let failure: unknown;
      try {
        try {
          const definition = savedSnapshotDefinition('scratch', artifact.descriptor, {
            packageJsonText: artifact.payload.packageJsonText,
            source,
            application: { mode: 'apply-snapshot', conflict: 'overwrite' },
          });
          opened = await h.owner.openProject(definition);
        } catch (error) {
          failure = error;
        }
        expect.soft(failure).toBeInstanceOf(Error);
        expect
          .soft(failureReason(failure), 'reject the actual replay/compatibility defect')
          .toMatch(reason);
        expect
          .soft(failureReason(failure))
          .not.toMatch(/snapshot-id-mismatch|package-json-mismatch/);
        expect.soft(opened, 'no deferred registry install or ready session').toBeUndefined();
        expect
          .soft(h.network.requests, 'exactly the selected asset; zero registry fallback')
          .toEqual([artifact.descriptor.assetUrl]);
        expect.soft(h.owner.catalogSnapshot()).toEqual(catalogBefore);
        expectExactTree(snapshotExactFsTree(h.fs), before);
      } finally {
        await opened?.close();
        await h.owner.close();
        await h.packages.quiesce();
      }
    },
    30_000,
  );
});
