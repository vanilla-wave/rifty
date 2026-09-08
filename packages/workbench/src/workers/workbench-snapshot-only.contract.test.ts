import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { createMemoryFs, resetSyncMirror, setSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildDepSnapshot, serializeDepSnapshot } from '../glue/dep-snapshot.ts';
import { SyncMirrorVfs } from '../glue/sync-mirror-vfs.ts';
import { createPlaygroundProjectCatalog } from '../workbench/internal/playground-project-catalog.ts';
import { definePlaygroundProject } from '../workbench/internal/playground-project-definition.ts';
import type { VitePlaygroundPlan } from '../workbench/playground.ts';
import { inspectProjectDefinition } from '../workbench/project-definition.ts';
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
const decoder = new TextDecoder('utf-8', { fatal: true });
const CAPTURED_URL_CONTEXT = Object.freeze({
  apiBaseUrl: 'https://playground.invalid/app/',
  clientUrl: 'https://playground.invalid/app/index.html',
});
const EDITED_AT = '2026-07-16T12:00:00.000Z';
const MISSING_SNAPSHOT_ID = `sha256:${'0'.repeat(64)}`;

function plan(
  id: string,
  firstMaterialization: VitePlaygroundPlan['firstMaterialization'],
): VitePlaygroundPlan {
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
    firstMaterialization,
  };
}

function definition(id: string, snapshotId: string, assetUrl: string): ProjectDefinition<unknown> {
  return definePlaygroundProject(
    plan(id, {
      kind: 'snapshot',
      snapshot: { snapshotId, assetUrl, templateId: 'vite-template-v1' },
    }),
    CAPTURED_URL_CONTEXT,
  );
}

function dependencyMap(packageJsonText: string): Record<string, string> {
  const manifest = JSON.parse(packageJsonText) as Record<string, unknown>;
  const result: Record<string, string> = {};
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    const value = manifest[field];
    if (value === undefined) continue;
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`Test manifest ${field} is invalid`);
    }
    for (const [name, version] of Object.entries(value)) {
      if (typeof version !== 'string') throw new Error(`Test manifest ${field}.${name} is invalid`);
      result[name] = version;
    }
  }
  return result;
}

function gzipBytes(bytes: Uint8Array): Uint8Array {
  const compressed = gzipSync(bytes);
  const copied = new Uint8Array(compressed.byteLength);
  copied.set(compressed);
  return copied;
}

function snapshotIdFor(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function compatibleSnapshot(
  id: string,
  marker = 'vite-pin\n',
): {
  readonly gzip: Uint8Array;
  readonly snapshotId: string;
} {
  const probe = definePlaygroundProject(plan(id, { kind: 'install' }), CAPTURED_URL_CONTEXT);
  const packageJson = inspectProjectDefinition(probe).files['/package.json'];
  if (packageJson === undefined) throw new Error('vite definition omitted /package.json');
  const packageJsonText = decoder.decode(packageJson);
  const { fsSync } = createMemoryFs();
  const root = '/bake';
  fsSync.mkdirSync(`${root}/node_modules/vite`, { recursive: true });
  fsSync.writeFileSync(`${root}/package.json`, packageJson);
  fsSync.writeFileSync(
    `${root}/package-lock.json`,
    encoder.encode('{"lockfileVersion":3,"packages":{}}\n'),
  );
  fsSync.writeFileSync(
    `${root}/node_modules/vite/package.json`,
    encoder.encode('{"name":"vite","version":"8.0.0"}\n'),
  );
  fsSync.writeFileSync(`${root}/node_modules/vite/readme.txt`, encoder.encode(marker));
  const bytes = encoder.encode(
    serializeDepSnapshot(
      buildDepSnapshot(fsSync, root, {
        templateId: 'vite-template-v1',
        deps: dependencyMap(packageJsonText),
        packages: 1,
      }),
    ),
  );
  return { gzip: gzipBytes(bytes), snapshotId: snapshotIdFor(bytes) };
}

function corruptSnapshot(): { readonly gzip: Uint8Array; readonly snapshotId: string } {
  const bytes = encoder.encode('{"version":1}');
  return { gzip: gzipBytes(bytes), snapshotId: snapshotIdFor(bytes) };
}

async function acquisitionHarness(
  assets: Readonly<Record<string, Uint8Array>>,
  registryFetch = vi.fn(async () => new Response('', { status: 599 })),
  networkInstall = vi.fn(async () => {
    throw new Error('network install must not run');
  }),
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
          request.skipUnusedSnapshot === true ? { skipUnusedSnapshot: true } : {},
        )) as unknown as ProjectAcquisitionPlan,
    }),
    projectSave: packageState,
  });
  return {
    owner,
    catalog: createPlaygroundProjectCatalog(owner),
    fetchSnapshot,
    registryFetch,
    networkInstall,
    packageState,
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
    const def = definition('scratch', MISSING_SNAPSHOT_ID, '/snapshots/missing.json.gz');
    await h.catalog.createScratch({ definition: def });
    await expect(h.owner.openProject(def)).rejects.toThrow(/snapshot/);
    expect(h.registryFetch).not.toHaveBeenCalled();
    await h.owner.close();
  });

  it('rejects a corrupt required snapshot instead of returning deferred install', async () => {
    const asset = corruptSnapshot();
    const h = await acquisitionHarness({ '/snapshots/corrupt.json.gz': asset.gzip });
    const def = definition('scratch', asset.snapshotId, '/snapshots/corrupt.json.gz');
    await h.catalog.createScratch({ definition: def });
    await expect(h.owner.openProject(def)).rejects.toThrow(/snapshot/);
    expect(h.registryFetch).not.toHaveBeenCalled();
    await h.owner.close();
  });

  it('rejects a snapshot-id mismatch before guest start and does not return install', async () => {
    const asset = compatibleSnapshot('scratch-declared', 'declared-pin\n');
    const impostor = compatibleSnapshot('scratch-impostor', 'IMPOSTOR\n');
    const h = await acquisitionHarness({ '/snapshots/a.json.gz': impostor.gzip });
    const def = definition('scratch', asset.snapshotId, '/snapshots/a.json.gz');
    await h.catalog.createScratch({ definition: def });
    await expect(h.owner.openProject(def)).rejects.toThrow(/snapshot-id-mismatch|snapshot/);
    expect(h.registryFetch).not.toHaveBeenCalled();
    await h.owner.close();
  });

  it('restores a compatible snapshot as ready and refuses a later network install', async () => {
    const asset = compatibleSnapshot('scratch');
    const registryFetch = vi.fn(async () => new Response('', { status: 599 }));
    const networkInstall = vi.fn(async () => {
      throw new Error('network install must not run');
    });
    const h = await acquisitionHarness(
      { '/snapshots/a.json.gz': asset.gzip },
      registryFetch,
      networkInstall,
    );
    const def = definition('scratch', asset.snapshotId, '/snapshots/a.json.gz');
    await h.catalog.createScratch({ definition: def });
    const opened = await h.owner.openProject(def);
    expect(opened.acquisition).toMatchObject({ kind: 'ready' });
    expect(registryFetch).not.toHaveBeenCalled();

    const stderr: string[] = [];
    const sink = {
      write: (chunk: string | Uint8Array): void => {
        stderr.push(typeof chunk === 'string' ? chunk : decoder.decode(chunk));
      },
    };
    const npm = h.packageState.createNpmCommand(async () => 1);
    const code = await npm(['install', 'left-pad@1.3.0'], {
      cwd: opened.projectRoot,
      env: {},
      stdout: sink,
      stderr: sink,
    });
    expect(code).not.toBe(0);
    expect(stderr.join('')).toMatch(/snapshot-only|registryUrl|packageAcquisition/);
    expect(registryFetch).not.toHaveBeenCalled();
    expect(networkInstall).not.toHaveBeenCalled();
    await opened.close();
    await h.owner.close();
  });
});
