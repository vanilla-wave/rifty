import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { RegistryClient } from '@riftydev/npm-client';
import { createMemoryFs, resetSyncMirror, setSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildDepSnapshot, serializeDepSnapshot } from '../glue/dep-snapshot.ts';
import { SyncMirrorVfs } from '../glue/sync-mirror-vfs.ts';
import { createPlaygroundProjectCatalog } from '../workbench/internal/playground-project-catalog.ts';
import { definePlaygroundProject } from '../workbench/internal/playground-project-definition.ts';
import type { VitePlaygroundPlan } from '../workbench/playground.ts';
import type {
  ProjectAcquisitionPlan,
  ProjectAcquisitionRequest,
} from '../workbench/project-materialization.ts';
import type { ProjectDefinition } from '../workbench/public.ts';
import { createOwnerPackageState } from './owner-package-state.ts';
import { createOwnerVfsAuthorityComposition } from './owner-vfs-authority.ts';
import { createPlaygroundProjectAuthority } from './playground-project-authority.ts';
import { workbenchFirstMaterializationPackageConfig } from './workbench-package-config.ts';

const encoder = new TextEncoder();
const CAPTURED_URL_CONTEXT = Object.freeze({
  apiBaseUrl: 'https://playground.invalid/app/',
  clientUrl: 'https://playground.invalid/app/index.html',
});
const EDITED_AT = '2026-07-16T12:00:00.000Z';

function plan(id: string, snapshotId: string, assetUrl: string): VitePlaygroundPlan {
  return {
    kind: 'vite',
    id,
    starterId: 'starter-a',
    templateId: 'vite-template-v1',
    files: {
      '/index.html': '<main>snapshot-only</main>\n',
      '/package.json':
        '{"name":"app","scripts":{"dev":"vite"},"devDependencies":{"vite":"8.0.0"}}\n',
      '/src/main.ts': 'document.body.dataset.ready = "yes";\n',
    },
    devDependencies: { vite: '8.0.0' },
    port: 5173,
    firstMaterialization: {
      kind: 'snapshot',
      snapshot: { snapshotId, assetUrl, templateId: 'vite-template-v1' },
    },
  };
}

function definition(id: string, snapshotId: string, assetUrl: string): ProjectDefinition<unknown> {
  return definePlaygroundProject(plan(id, snapshotId, assetUrl), CAPTURED_URL_CONTEXT);
}

function snapshotFixture(
  lockfile: string,
  marker: string,
): {
  readonly gzip: Uint8Array;
  readonly snapshotId: string;
} {
  const { fsSync } = createMemoryFs();
  const root = '/bake';
  fsSync.mkdirSync(`${root}/node_modules/pin`, { recursive: true });
  fsSync.writeFileSync(
    `${root}/package.json`,
    encoder.encode('{"name":"app","scripts":{"dev":"vite"},"devDependencies":{"vite":"8.0.0"}}\n'),
  );
  fsSync.writeFileSync(`${root}/package-lock.json`, encoder.encode(lockfile));
  fsSync.writeFileSync(
    `${root}/node_modules/pin/package.json`,
    encoder.encode('{"name":"pin","version":"1.0.0"}\n'),
  );
  fsSync.writeFileSync(`${root}/node_modules/pin/readme.txt`, encoder.encode(marker));
  const bytes = encoder.encode(
    serializeDepSnapshot(
      buildDepSnapshot(fsSync, root, {
        templateId: 'vite-template-v1',
        deps: { vite: '8.0.0' },
        packages: 1,
      }),
    ),
  );
  return {
    gzip: gzipSync(bytes),
    snapshotId: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
  };
}

async function acquisitionHarness(
  assets: Readonly<Record<string, Uint8Array>>,
  registryFetch = vi.fn(async () => new Response('', { status: 599 })),
) {
  const pair = createMemoryFs();
  const composition = createOwnerVfsAuthorityComposition(pair.fsSync, {
    ownerEpoch: 'snapshot-only-acquisition-owner',
    initialRoots: ['/', '/.rifty'],
  });
  setSyncMirror(composition.authority, { async: pair.vfs });
  const fetchSnapshot = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'https://playground.invalid/app/');
    const body = assets[url.pathname];
    if (body === undefined) return new Response('missing', { status: 404 });
    return new Response(body.slice(), { headers: { 'Content-Type': 'application/gzip' } });
  });
  vi.stubGlobal('fetch', fetchSnapshot);
  const packageState = createOwnerPackageState({
    vfs: new SyncMirrorVfs(),
    fsSync: composition.authority,
    installStampClaims: composition.installStampClaims,
    flush: () => composition.authority.flush(),
    nodeWorkerRuntimeEnv: {},
    log: () => {},
    registry: new RegistryClient({
      baseUrl: 'https://registry.invalid/',
      fetch: registryFetch,
    }),
    resolverUrl: () => undefined,
    resolverBundleBaseUrl: () => undefined,
    resolverPin: () => undefined,
  });
  let stages = 0;
  const owner = await createPlaygroundProjectAuthority({
    ...composition,
    persistence: 'required',
    now: () => EDITED_AT,
    createStageId: () => `snapshot-only-stage-${String(++stages)}`,
    acquisition: Object.freeze({
      ensure: async (request: ProjectAcquisitionRequest): Promise<ProjectAcquisitionPlan> =>
        (await packageState.activateAndEnsure(
          workbenchFirstMaterializationPackageConfig(request.definition, request.projectRoot, {
            packageJsonBytes: composition.authority.readFileBytesSync(
              `${request.projectRoot}/package.json`,
            ),
          }),
        )) as unknown as ProjectAcquisitionPlan,
    }),
    projectSave: packageState,
  });
  return {
    owner,
    catalog: createPlaygroundProjectCatalog(owner),
    fetchSnapshot,
    registryFetch,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetSyncMirror();
});

describe('snapshot-only acquisition (I3)', () => {
  it('rejects a missing required snapshot instead of returning deferred install', async () => {
    const h = await acquisitionHarness({});
    const def = definition('scratch', 'sha256:deadbeef', '/snapshots/missing.json.gz');
    await h.catalog.createScratch({ definition: def });
    await expect(h.owner.openProject(def)).rejects.toThrow(/snapshot/);
    await h.owner.close();
  });

  it('rejects a snapshot-id mismatch before guest start and does not return install', async () => {
    const asset = snapshotFixture('{"lockfileVersion":3,"packages":{}}\n', 'pin-a\n');
    const impostor = snapshotFixture('{"lockfileVersion":3,"packages":{"x":{}}}\n', 'IMPOSTOR\n');
    const h = await acquisitionHarness({ '/snapshots/a.json.gz': impostor.gzip });
    const def = definition('scratch', asset.snapshotId, '/snapshots/a.json.gz');
    await h.catalog.createScratch({ definition: def });
    await expect(h.owner.openProject(def)).rejects.toThrow(/snapshot-id-mismatch|snapshot/);
    await h.owner.close();
  });

  it('restores a compatible snapshot as ready without scheduling install', async () => {
    const asset = snapshotFixture('{"lockfileVersion":3,"packages":{}}\n', 'pin-a\n');
    const registryFetch = vi.fn(async () => new Response('', { status: 599 }));
    const h = await acquisitionHarness({ '/snapshots/a.json.gz': asset.gzip }, registryFetch);
    const def = definition('scratch', asset.snapshotId, '/snapshots/a.json.gz');
    await h.catalog.createScratch({ definition: def });
    const opened = await h.owner.openProject(def);
    expect(opened.acquisition).toMatchObject({ kind: 'ready' });
    expect(registryFetch).not.toHaveBeenCalled();
    await opened.close();
    await h.owner.close();
  });
});
