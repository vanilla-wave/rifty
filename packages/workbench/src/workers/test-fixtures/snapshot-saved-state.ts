import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { RegistryClient, serializePackageJson } from '@riftydev/npm-client';
import { setSyncMirror } from '@riftydev/vfs/internal';
import { vi } from 'vitest';
import {
  type ProducedDependencySnapshot,
  produceDependencySnapshot,
} from '../../glue/dep-snapshot-producer.ts';
import { decodeDepSnapshotTar } from '../../glue/dep-snapshot-tar.ts';
import { type DepSnapshotV3, parseDepSnapshot } from '../../glue/dep-snapshot.ts';
import { SyncMirrorVfs } from '../../glue/sync-mirror-vfs.ts';
import { createPlaygroundProjectCatalog } from '../../workbench/internal/playground-project-catalog.ts';
import { definePlaygroundProject } from '../../workbench/internal/playground-project-definition.ts';
import type { PlaygroundTrustedSnapshot } from '../../workbench/playground.ts';
import { createOwnerPackageState } from '../owner-package-state.ts';
import { createOwnerVfsAuthorityComposition } from '../owner-vfs-authority.ts';
import { createPlaygroundProjectAuthority } from '../playground-project-authority.ts';
import { workbenchFirstMaterializationPackageConfig } from '../workbench-package-config.ts';
import { DurableOwnerFs } from './durable-owner-fs.ts';

const registryUrl = 'https://registry.test';
const urlContext = Object.freeze({
  apiBaseUrl: 'https://host.test/',
  clientUrl: 'https://host.test/app/',
});
const manifest = {
  name: 'saved-snapshot-ms',
  version: '1.0.0',
  dependencies: { ms: '2.0.0' },
};
export const savedSnapshotManifest = serializePackageJson(manifest);
export const savedSnapshotSource = "console.log(require('ms')('2s'));\n";
export const snapshotAssetUrl = 'https://host.test/snapshot.tar.gz';
export const unusedSnapshotAssetUrl = 'https://host.test/unavailable-new-snapshot.tar.gz';

export interface SavedSnapshotFixture extends ProducedDependencySnapshot {
  readonly descriptor: PlaygroundTrustedSnapshot;
  readonly payload: DepSnapshotV3;
}

export interface SnapshotDefinitionOptions {
  readonly packageJsonText?: string;
  readonly source?: string;
  readonly application?: {
    readonly mode: 'apply-snapshot';
    readonly conflict?: 'error' | 'overwrite';
  };
}

function requestUrl(input: string | URL | Request): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}

/** Real locked ms tarball, real producer; only network delivery is controlled. */
export async function bakeSavedSnapshotFixture(
  options: { readonly description?: string; readonly assetUrl?: string } = {},
): Promise<SavedSnapshotFixture> {
  const fixtureRoot = new URL(
    '../../../../../tests/integration/fixtures/registry/',
    import.meta.url,
  );
  const metadata = JSON.parse(await readFile(new URL('ms-2.0.0.json', fixtureRoot), 'utf8')) as {
    readonly dist: { readonly upstreamTarball: string; readonly upstreamIntegrity: string };
  };
  const tarball = new Uint8Array(await readFile(new URL('ms-2.0.0.tgz', fixtureRoot)));
  vi.stubGlobal('fetch', async (input: string | URL | Request) => {
    const url = requestUrl(input);
    if (url === `${registryUrl}/ms/-/ms-2.0.0.tgz`) return new Response(tarball.slice());
    throw new Error(`Unexpected producer request: ${url}`);
  });
  const selectedManifest = {
    ...manifest,
    ...(options.description === undefined ? {} : { description: options.description }),
  };
  const produced = await produceDependencySnapshot({
    templateId: 'saved-ms',
    packageJsonText: serializePackageJson(selectedManifest),
    packageLockText: JSON.stringify({
      name: manifest.name,
      version: manifest.version,
      lockfileVersion: 3,
      requires: true,
      packages: {
        '': selectedManifest,
        'node_modules/ms': {
          version: '2.0.0',
          resolved: metadata.dist.upstreamTarball,
          integrity: metadata.dist.upstreamIntegrity,
        },
      },
    }),
    registryUrl,
  });
  return {
    ...produced,
    payload: parseDepSnapshot(
      JSON.stringify(decodeDepSnapshotTar(new Uint8Array(gunzipSync(produced.archive)))),
    ),
    descriptor: {
      snapshotId: produced.snapshotId,
      templateId: 'saved-ms',
      assetUrl: options.assetUrl ?? snapshotAssetUrl,
    },
  };
}

export function savedSnapshotDefinition(
  id: string,
  snapshot: PlaygroundTrustedSnapshot,
  options: SnapshotDefinitionOptions = {},
) {
  return definePlaygroundProject(
    {
      kind: 'node-cli',
      id,
      starterId: 'saved-ms-starter',
      templateId: 'saved-ms',
      entryPath: '/main.cjs',
      files: {
        '/package.json': options.packageJsonText ?? savedSnapshotManifest,
        '/main.cjs': options.source ?? savedSnapshotSource,
      },
      firstMaterialization: {
        kind: 'snapshot',
        snapshot,
        ...(options.application === undefined ? {} : { application: options.application }),
      },
    },
    urlContext,
  );
}

export function installSnapshotNetwork(
  fixture: SavedSnapshotFixture,
  ...additional: SavedSnapshotFixture[]
) {
  const artifacts = new Map(
    [fixture, ...additional].map((artifact) => [artifact.descriptor.assetUrl, artifact]),
  );
  const requests: string[] = [];
  const fetch = async (input: string | URL | Request): Promise<Response> => {
    const url = requestUrl(input);
    requests.push(url);
    const artifact = artifacts.get(url);
    if (artifact !== undefined) return new Response(artifact.archive.slice());
    throw new Error(`Network unavailable: ${url}`);
  };
  vi.stubGlobal('fetch', fetch);
  return { requests, fetch };
}

/** Same ownership graph as workbench-owner-runtime; no acquisition/installer doubles. */
export async function openSavedSnapshotOwner(
  network: ReturnType<typeof installSnapshotNetwork>,
  fs = new DurableOwnerFs(),
  legacyWorkspacePrefix?: string,
) {
  const composition = createOwnerVfsAuthorityComposition(fs, {
    ownerEpoch: 'snapshot-saved-state-owner',
    initialRoots: ['/', '/.rifty'],
  });
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
    persistence: 'required',
    ...(legacyWorkspacePrefix === undefined ? {} : { legacyWorkspacePrefix }),
    now: () => '2026-09-08T00:00:00.000Z',
    createStageId: () => globalThis.crypto.randomUUID(),
    acquisition: {
      ensure: (request) =>
        packages.activateAndEnsure(
          workbenchFirstMaterializationPackageConfig(request, composition.authority),
          request.snapshotAdmission,
        ),
    },
    projectSave: packages,
  });
  return {
    ...composition,
    fs,
    owner,
    packages,
    catalog: createPlaygroundProjectCatalog(owner),
    async close() {
      await owner.close();
      await packages.quiesce();
    },
  };
}
