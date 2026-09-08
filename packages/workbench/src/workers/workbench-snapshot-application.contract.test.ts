import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { RegistryClient } from '@riftydev/npm-client';
import {
  MemoryFsSync,
  createMemoryFs,
  resetSyncMirror,
  setSyncMirror,
} from '@riftydev/vfs/internal';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildDepSnapshot, serializeDepSnapshot } from '../glue/dep-snapshot.ts';
import { createInstallStampAuthority } from '../glue/install-stamp-authority.ts';
import { SyncMirrorVfs } from '../glue/sync-mirror-vfs.ts';
import { ProjectDefinitionMismatchError } from '../workbench/errors.ts';
import { createPlaygroundProjectCatalog } from '../workbench/internal/playground-project-catalog.ts';
import { definePlaygroundProject } from '../workbench/internal/playground-project-definition.ts';
import type { PlaygroundProjectCatalog, VitePlaygroundPlan } from '../workbench/playground.ts';
import type {
  ProjectAcquisitionPlan,
  ProjectAcquisitionRequest,
} from '../workbench/project-materialization.ts';
import type { ProjectDefinition } from '../workbench/public.ts';
import { createOwnerPackageState } from './owner-package-state.ts';
import { createOwnerVfsAuthorityComposition } from './owner-vfs-authority.ts';
import {
  type PackageAcquisitionAuthority,
  createPackageAcquisitionAuthority,
} from './package-acquisition-authority.ts';
import {
  type PlaygroundProjectAuthority,
  createPlaygroundProjectAuthority,
} from './playground-project-authority.ts';
import { workbenchPackageConfig } from './workbench-package-config.ts';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const CAPTURED_URL_CONTEXT = Object.freeze({
  apiBaseUrl: 'https://playground.invalid/app/',
  clientUrl: 'https://playground.invalid/app/index.html',
});
const EDITED_AT = '2026-07-16T12:00:00.000Z';
const SCRATCH_ROOT = '/.rifty/workbench/v1/projects/scratch/tree';
const PROJECT_A_ROOT = '/.rifty/workbench/v1/projects/project-a/tree';

type SnapshotApplication =
  | { readonly mode: 'initial-deployment-only' }
  | { readonly mode: 'apply'; readonly conflict?: 'error' | 'overwrite' };

type OpenedProject = Awaited<ReturnType<PlaygroundProjectAuthority['openProject']>>;

function plan(
  id: string,
  snapshotId: string,
  assetUrl: string,
  overrides: Partial<VitePlaygroundPlan> = {},
): VitePlaygroundPlan {
  return {
    kind: 'vite',
    id,
    starterId: 'starter-a',
    templateId: 'vite-template-v1',
    files: {
      '/index.html': '<main>catalog contract</main>\n',
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
    ...overrides,
  };
}

function definition(
  id: string,
  snapshotId: string,
  assetUrl: string,
  overrides: Partial<VitePlaygroundPlan> = {},
): ProjectDefinition<unknown> {
  return definePlaygroundProject(plan(id, snapshotId, assetUrl, overrides), CAPTURED_URL_CONTEXT);
}

function withApplication(
  input: {
    readonly definition: ProjectDefinition<unknown>;
    readonly preserveDirtySameStarter?: boolean;
  },
  snapshotApplication: SnapshotApplication,
): Parameters<PlaygroundProjectCatalog['createScratch']>[0] {
  return { ...input, snapshotApplication } as Parameters<
    PlaygroundProjectCatalog['createScratch']
  >[0];
}

function isConflictError(error: unknown): error is Error & { readonly paths: readonly string[] } {
  return (
    error instanceof Error &&
    error.name === 'SnapshotApplicationConflictError' &&
    'paths' in error &&
    Array.isArray((error as { paths: unknown }).paths)
  );
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
    encoder.encode('{"name":"app","dependencies":{"pin":"1.0.0"}}\n'),
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
        deps: { pin: '1.0.0' },
        packages: 1,
      }),
    ),
  );
  return {
    gzip: gzipSync(bytes),
    snapshotId: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
  };
}

interface CatalogHarness {
  readonly authority: ReturnType<typeof createOwnerVfsAuthorityComposition>['authority'];
  readonly owner: PlaygroundProjectAuthority;
  readonly catalog: PlaygroundProjectCatalog;
  readonly fetchSnapshot: ReturnType<typeof vi.fn>;
}

function catalogPackageAdapter() {
  return {
    readTrustedPackageLock: async () => ({ lockfileVersion: 3, packages: {} }),
    planSnapshotRestore: async () => ({ status: 'rejected' as const, reason: 'not requested' }),
    install: async () => {
      throw new Error('snapshot-application catalog harness must not install');
    },
    reset: async () => {},
    switchProject: async () => {},
  };
}

async function catalogHarness(fs: MemoryFsSync = new MemoryFsSync()): Promise<CatalogHarness> {
  const composition = createOwnerVfsAuthorityComposition(fs, {
    ownerEpoch: 'snapshot-application-catalog-owner',
    initialRoots: ['/', '/.rifty'],
  });
  const vfs = new SyncMirrorVfs();
  const stamps = createInstallStampAuthority({
    vfs,
    fsSync: composition.authority,
    claimIo: composition.installStampClaims,
  });
  const packages = createPackageAcquisitionAuthority({
    stamps,
    stampTransition: { flush: () => composition.authority.flush() },
    adapter: catalogPackageAdapter(),
  }) as Pick<PackageAcquisitionAuthority, 'projectSave'>;
  let stages = 0;
  const owner = await createPlaygroundProjectAuthority({
    ...composition,
    persistence: 'required',
    now: () => EDITED_AT,
    createStageId: () => `snapshot-application-stage-${String(++stages)}`,
    acquisition: Object.freeze({
      ensure: async () => Object.freeze({ kind: 'install' as const, snapshotFailures: [] }),
    }),
    projectSave: packages,
  });
  return {
    authority: composition.authority,
    owner,
    catalog: createPlaygroundProjectCatalog(owner),
    fetchSnapshot: vi.fn(),
  };
}

async function acquisitionHarness(
  assets: Readonly<Record<string, Uint8Array>>,
): Promise<CatalogHarness> {
  const pair = createMemoryFs();
  const composition = createOwnerVfsAuthorityComposition(pair.fsSync, {
    ownerEpoch: 'snapshot-application-acquisition-owner',
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
      fetch: async () => new Response('', { status: 599 }),
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
    createStageId: () => `snapshot-application-acq-stage-${String(++stages)}`,
    acquisition: Object.freeze({
      ensure: async (request: ProjectAcquisitionRequest): Promise<ProjectAcquisitionPlan> =>
        (await packageState.activateAndEnsure(
          workbenchPackageConfig(request.definition, request.projectRoot, {
            packageJsonBytes: composition.authority.readFileBytesSync(
              `${request.projectRoot}/package.json`,
            ),
          }),
        )) as unknown as ProjectAcquisitionPlan,
    }),
    projectSave: packageState,
  });
  return {
    authority: composition.authority,
    owner,
    catalog: createPlaygroundProjectCatalog(owner),
    fetchSnapshot,
  };
}

async function close(opened: OpenedProject): Promise<void> {
  await opened.close();
}

async function markDirty(
  h: CatalogHarness,
  def: ProjectDefinition<unknown>,
  files: Readonly<Record<string, string>>,
): Promise<void> {
  const scratch = await h.owner.openProject(def);
  for (const [path, text] of Object.entries(files)) {
    const full = `${scratch.projectRoot}${path}`;
    const parent = full.slice(0, full.lastIndexOf('/'));
    if (parent !== scratch.projectRoot) h.authority.mkdirSync(parent, { recursive: true });
    h.authority.writeFileSync(full, encoder.encode(text));
  }
  await h.owner.recordMutation({
    kind: 'guest',
    project: scratch,
    treeRevision: h.owner.treeRevision(),
  });
  await close(scratch);
}

async function seedDirtyScratch(
  h: CatalogHarness,
  def: ProjectDefinition<unknown>,
  files: Readonly<Record<string, string>>,
): Promise<void> {
  await h.catalog.createScratch({ definition: def });
  await markDirty(h, def, files);
}

function readText(h: CatalogHarness, root: string, path: string): string {
  return decoder.decode(h.authority.readFileBytesSync(`${root}${path}`));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetSyncMirror();
});

describe('snapshot application policy (I8)', () => {
  it('keeps dirty Scratch files when only snapshotId changes (default initial-only)', async () => {
    const first = snapshotFixture('{"lockfileVersion":3,"packages":{}}\n', 'pin-a\n');
    const next = snapshotFixture(
      '{"lockfileVersion":3,"packages":{"node_modules/pin":{}}}\n',
      'pin-b\n',
    );
    const h = await catalogHarness();
    const initial = definition('scratch', first.snapshotId, '/snapshots/a.json.gz');
    await seedDirtyScratch(h, initial, { '/user.txt': 'user edit' });
    const before = h.catalog.snapshot();
    expect(before.scratch?.dirty).toBe(true);

    const after = await h.catalog.createScratch({
      definition: definition('scratch', next.snapshotId, '/snapshots/b.json.gz'),
    });

    expect(after.scratch?.dirty).toBe(true);
    expect(readText(h, SCRATCH_ROOT, '/user.txt')).toBe('user edit');
    expect(readText(h, SCRATCH_ROOT, '/src/main.ts')).toBe(
      'document.body.dataset.ready = "yes";\n',
    );
    await h.owner.close();
  });

  it('keeps dirty Scratch when initial-deployment-only is requested with preserveDirtySameStarter', async () => {
    const first = snapshotFixture('{"lockfileVersion":3,"packages":{}}\n', 'pin-a\n');
    const next = snapshotFixture(
      '{"lockfileVersion":3,"packages":{"node_modules/pin":{}}}\n',
      'pin-b\n',
    );
    const h = await catalogHarness();
    const initial = definition('scratch', first.snapshotId, '/snapshots/a.json.gz');
    await seedDirtyScratch(h, initial, { '/user.txt': 'user edit' });

    await h.catalog.createScratch(
      withApplication(
        {
          definition: definition('scratch', next.snapshotId, '/snapshots/b.json.gz'),
          preserveDirtySameStarter: true,
        },
        { mode: 'initial-deployment-only' },
      ),
    );

    expect(h.catalog.snapshot().scratch?.dirty).toBe(true);
    expect(readText(h, SCRATCH_ROOT, '/user.txt')).toBe('user edit');
    await h.owner.close();
  });

  it('opens a named saved project when only snapshotId changes', async () => {
    const first = snapshotFixture('{"lockfileVersion":3,"packages":{}}\n', 'pin-a\n');
    const next = snapshotFixture(
      '{"lockfileVersion":3,"packages":{"node_modules/pin":{}}}\n',
      'pin-b\n',
    );
    const h = await catalogHarness();
    const scratchDef = definition('scratch', first.snapshotId, '/snapshots/a.json.gz');
    await seedDirtyScratch(h, scratchDef, { '/notes/user.txt': 'keep me' });
    await h.catalog.saveScratch({
      id: 'project-a',
      name: 'Project A',
      definition: definition('project-a', first.snapshotId, '/snapshots/a.json.gz'),
    });

    const opened = await h.owner.openProject(
      definition('project-a', next.snapshotId, '/snapshots/b.json.gz'),
    );

    expect(readText(h, PROJECT_A_ROOT, '/notes/user.txt')).toBe('keep me');
    await close(opened);
    await h.owner.close();
  });

  it('does not treat apply as a whole-tree reseed', async () => {
    const first = snapshotFixture('{"lockfileVersion":3,"packages":{}}\n', 'pin-a\n');
    const next = snapshotFixture(
      '{"lockfileVersion":3,"packages":{"node_modules/pin":{}}}\n',
      'pin-b\n',
    );
    const h = await acquisitionHarness({
      '/snapshots/a.json.gz': first.gzip,
      '/snapshots/b.json.gz': next.gzip,
    });
    await seedDirtyScratch(h, definition('scratch', first.snapshotId, '/snapshots/a.json.gz'), {
      '/user.txt': 'extra',
      '/src/main.ts': 'dirty main\n',
    });

    await h.catalog.createScratch(
      withApplication(
        {
          definition: definition('scratch', next.snapshotId, '/snapshots/b.json.gz'),
          preserveDirtySameStarter: true,
        },
        { mode: 'apply', conflict: 'overwrite' },
      ),
    );

    expect(readText(h, SCRATCH_ROOT, '/user.txt')).toBe('extra');
    expect(readText(h, SCRATCH_ROOT, '/src/main.ts')).toBe('dirty main\n');
    await h.owner.close();
  });

  it('apply error reports conflicting payload paths and writes nothing', async () => {
    const first = snapshotFixture('{"lockfileVersion":3,"packages":{}}\n', 'pin-a\n');
    const next = snapshotFixture('{"lockfileVersion":3,"packages":{"x":{}}}\n', 'pin-b\n');
    const assets = {
      '/snapshots/a.json.gz': first.gzip,
      '/snapshots/b.json.gz': next.gzip,
    };
    const h = await acquisitionHarness(assets);
    const initial = definition('scratch', first.snapshotId, '/snapshots/a.json.gz');
    await seedDirtyScratch(h, initial, {
      '/user.txt': 'extra',
      '/package-lock.json': 'saved-lock\n',
    });
    const beforeLock = readText(h, SCRATCH_ROOT, '/package-lock.json');
    const beforePkg = readText(h, SCRATCH_ROOT, '/package.json');

    let caught: unknown;
    try {
      await h.catalog.createScratch(
        withApplication(
          { definition: definition('scratch', next.snapshotId, '/snapshots/b.json.gz') },
          { mode: 'apply', conflict: 'error' },
        ),
      );
      await h.owner.openProject(definition('scratch', next.snapshotId, '/snapshots/b.json.gz'));
    } catch (error) {
      caught = error;
    }

    expect(isConflictError(caught)).toBe(true);
    if (isConflictError(caught)) {
      expect(caught.paths).toEqual(expect.arrayContaining(['/package-lock.json']));
    }
    expect(caught).not.toBeInstanceOf(ProjectDefinitionMismatchError);
    expect(readText(h, SCRATCH_ROOT, '/user.txt')).toBe('extra');
    expect(readText(h, SCRATCH_ROOT, '/package-lock.json')).toBe(beforeLock);
    expect(readText(h, SCRATCH_ROOT, '/package.json')).toBe(beforePkg);
    expect(h.authority.existsSync(`${SCRATCH_ROOT}/added-only.txt`)).toBe(false);
    await h.owner.close();
  });

  it('apply overwrite replaces conflicts, adds missing payload files, and keeps extras', async () => {
    const first = snapshotFixture('{"lockfileVersion":3,"packages":{}}\n', 'pin-a\n');
    const next = snapshotFixture(
      '{"lockfileVersion":3,"packages":{"node_modules/pin":{}}}\n',
      'pin-b\n',
    );
    const h = await acquisitionHarness({
      '/snapshots/a.json.gz': first.gzip,
      '/snapshots/b.json.gz': next.gzip,
    });
    await seedDirtyScratch(h, definition('scratch', first.snapshotId, '/snapshots/a.json.gz'), {
      '/user.txt': 'extra',
      '/src/main.ts': 'dirty main\n',
    });
    h.authority.mkdirSync(`${SCRATCH_ROOT}/node_modules/local-patch`, { recursive: true });
    h.authority.writeFileSync(
      `${SCRATCH_ROOT}/node_modules/local-patch/keep.txt`,
      encoder.encode('keep-me\n'),
    );

    await h.catalog.createScratch(
      withApplication(
        { definition: definition('scratch', next.snapshotId, '/snapshots/b.json.gz') },
        { mode: 'apply', conflict: 'overwrite' },
      ),
    );
    const opened = await h.owner.openProject(
      definition('scratch', next.snapshotId, '/snapshots/b.json.gz'),
    );

    expect(readText(h, SCRATCH_ROOT, '/user.txt')).toBe('extra');
    expect(readText(h, SCRATCH_ROOT, '/src/main.ts')).toBe('dirty main\n');
    expect(readText(h, SCRATCH_ROOT, '/node_modules/local-patch/keep.txt')).toBe('keep-me\n');
    expect(readText(h, SCRATCH_ROOT, '/node_modules/pin/readme.txt')).toBe('pin-b\n');
    await close(opened);
    await h.owner.close();
  });

  it('apply evaluates payload when snapshotId is unchanged', async () => {
    const asset = snapshotFixture('{"lockfileVersion":3,"packages":{}}\n', 'pin-a\n');
    const h = await acquisitionHarness({ '/snapshots/a.json.gz': asset.gzip });
    const def = definition('scratch', asset.snapshotId, '/snapshots/a.json.gz');
    await seedDirtyScratch(h, def, {
      '/user.txt': 'extra',
      '/package-lock.json': 'drifted-lock\n',
    });

    let caught: unknown;
    try {
      await h.catalog.createScratch(
        withApplication({ definition: def, preserveDirtySameStarter: true }, { mode: 'apply' }),
      );
      await h.owner.openProject(def);
    } catch (error) {
      caught = error;
    }

    expect(isConflictError(caught)).toBe(true);
    expect(readText(h, SCRATCH_ROOT, '/user.txt')).toBe('extra');
    expect(readText(h, SCRATCH_ROOT, '/package-lock.json')).toBe('drifted-lock\n');
    await h.owner.close();
  });

  it('identical payload bytes are not conflicts and extras remain', async () => {
    const asset = snapshotFixture('{"lockfileVersion":3,"packages":{}}\n', 'pin-a\n');
    const h = await acquisitionHarness({ '/snapshots/a.json.gz': asset.gzip });
    const def = definition('scratch', asset.snapshotId, '/snapshots/a.json.gz');
    await h.catalog.createScratch({ definition: def });
    const opened = await h.owner.openProject(def);
    await close(opened);
    await markDirty(h, def, { '/user.txt': 'extra' });

    await h.catalog.createScratch(
      withApplication({ definition: def }, { mode: 'apply', conflict: 'error' }),
    );
    const reopened = await h.owner.openProject(def);

    expect(readText(h, SCRATCH_ROOT, '/user.txt')).toBe('extra');
    await close(reopened);
    await h.owner.close();
  });

  it('treats file-vs-directory clashes as conflicts', async () => {
    const first = snapshotFixture('{"lockfileVersion":3,"packages":{}}\n', 'pin-a\n');
    const next = snapshotFixture(
      '{"lockfileVersion":3,"packages":{"node_modules/pin":{}}}\n',
      'pin-b\n',
    );
    const h = await acquisitionHarness({
      '/snapshots/a.json.gz': first.gzip,
      '/snapshots/b.json.gz': next.gzip,
    });
    const initial = definition('scratch', first.snapshotId, '/snapshots/a.json.gz');
    await h.catalog.createScratch({ definition: initial });
    h.authority.mkdirSync(`${SCRATCH_ROOT}/node_modules`, { recursive: true });
    h.authority.writeFileSync(`${SCRATCH_ROOT}/node_modules/pin`, encoder.encode('i-am-a-file\n'));

    let caught: unknown;
    try {
      await h.catalog.createScratch(
        withApplication(
          { definition: definition('scratch', next.snapshotId, '/snapshots/b.json.gz') },
          { mode: 'apply', conflict: 'error' },
        ),
      );
      await h.owner.openProject(definition('scratch', next.snapshotId, '/snapshots/b.json.gz'));
    } catch (error) {
      caught = error;
    }

    expect(isConflictError(caught)).toBe(true);
    if (isConflictError(caught)) expect(caught.paths).toContain('/node_modules/pin');
    expect(readText(h, SCRATCH_ROOT, '/node_modules/pin')).toBe('i-am-a-file\n');
    await h.owner.close();
  });

  it('does not fetch an unused new snapshot under initial-only', async () => {
    const first = snapshotFixture('{"lockfileVersion":3,"packages":{}}\n', 'pin-a\n');
    const next = snapshotFixture(
      '{"lockfileVersion":3,"packages":{"node_modules/pin":{}}}\n',
      'pin-b\n',
    );
    const h = await acquisitionHarness({
      '/snapshots/a.json.gz': first.gzip,
      '/snapshots/b.json.gz': next.gzip,
    });
    const initial = definition('scratch', first.snapshotId, '/snapshots/a.json.gz');
    await h.catalog.createScratch({ definition: initial });
    const firstOpen = await h.owner.openProject(initial);
    await close(firstOpen);
    await markDirty(h, initial, { '/user.txt': 'user edit' });
    const fetchesAfterSeed = h.fetchSnapshot.mock.calls.length;

    await h.catalog.createScratch({
      definition: definition('scratch', next.snapshotId, '/snapshots/b.json.gz'),
    });
    const reopened = await h.owner.openProject(
      definition('scratch', next.snapshotId, '/snapshots/b.json.gz'),
    );

    expect(readText(h, SCRATCH_ROOT, '/user.txt')).toBe('user edit');
    expect(
      h.fetchSnapshot.mock.calls.map(
        (call) => new URL(String(call[0]), 'https://playground.invalid/app/').pathname,
      ),
    ).not.toContain('/snapshots/b.json.gz');
    expect(h.fetchSnapshot.mock.calls.length).toBe(fetchesAfterSeed);
    await close(reopened);
    await h.owner.close();
  });

  it('does not treat missing install trust as an absent project', async () => {
    const first = snapshotFixture('{"lockfileVersion":3,"packages":{}}\n', 'pin-a\n');
    const next = snapshotFixture(
      '{"lockfileVersion":3,"packages":{"node_modules/pin":{}}}\n',
      'pin-b\n',
    );
    const h = await catalogHarness();
    const initial = definition('scratch', first.snapshotId, '/snapshots/a.json.gz');
    await seedDirtyScratch(h, initial, { '/user.txt': 'user edit' });
    h.authority.rmSync('/.rifty/workbench/v1/projects/scratch/.rifty', {
      recursive: true,
      force: true,
    });

    const after = await h.catalog.createScratch({
      definition: definition('scratch', next.snapshotId, '/snapshots/b.json.gz'),
    });

    expect(after.scratch).not.toBeNull();
    expect(readText(h, SCRATCH_ROOT, '/user.txt')).toBe('user edit');
    await h.owner.close();
  });

  it('keeps dirty Scratch on snapshotId drift when persisted adoption lacks applicationFingerprint', async () => {
    const first = snapshotFixture('{"lockfileVersion":3,"packages":{}}\n', 'pin-a\n');
    const next = snapshotFixture(
      '{"lockfileVersion":3,"packages":{"node_modules/pin":{}}}\n',
      'pin-b\n',
    );
    const fs = new MemoryFsSync();
    const seeded = await catalogHarness(fs);
    await seedDirtyScratch(
      seeded,
      definition('scratch', first.snapshotId, '/snapshots/a.json.gz'),
      { '/user.txt': 'user edit' },
    );
    const catalogPath = '/.rifty/workbench/playground/catalog.json';
    const raw = JSON.parse(decoder.decode(seeded.authority.readFileBytesSync(catalogPath))) as {
      scratch: { adoption: { applicationFingerprint?: string } };
    };
    raw.scratch.adoption.applicationFingerprint = undefined;
    seeded.authority.writeFileSync(
      catalogPath,
      encoder.encode(`${JSON.stringify(raw, null, 2)}\n`),
    );
    await seeded.owner.close();

    const h = await catalogHarness(fs);
    await h.catalog.createScratch({
      definition: definition('scratch', next.snapshotId, '/snapshots/b.json.gz'),
    });

    expect(readText(h, SCRATCH_ROOT, '/user.txt')).toBe('user edit');
    expect(h.catalog.snapshot().scratch?.dirty).toBe(true);
    await h.owner.close();
  });

  it('rejects a snapshot whose bytes do not match the declared snapshotId before mutation', async () => {
    const first = snapshotFixture('{"lockfileVersion":3,"packages":{}}\n', 'pin-a\n');
    const declared = snapshotFixture(
      '{"lockfileVersion":3,"packages":{"node_modules/pin":{}}}\n',
      'pin-b\n',
    );
    const impostor = snapshotFixture('{"lockfileVersion":3,"packages":{"x":{}}}\n', 'IMPOSTOR\n');
    const h = await acquisitionHarness({
      '/snapshots/a.json.gz': first.gzip,
      '/snapshots/b.json.gz': impostor.gzip,
    });
    await seedDirtyScratch(h, definition('scratch', first.snapshotId, '/snapshots/a.json.gz'), {
      '/user.txt': 'extra',
      '/package-lock.json': 'saved-lock\n',
    });
    const beforeLock = readText(h, SCRATCH_ROOT, '/package-lock.json');

    await expect(
      h.catalog.createScratch(
        withApplication(
          {
            definition: definition('scratch', declared.snapshotId, '/snapshots/b.json.gz'),
          },
          { mode: 'apply', conflict: 'overwrite' },
        ),
      ),
    ).rejects.toThrow(/snapshot-id-mismatch/);

    expect(readText(h, SCRATCH_ROOT, '/user.txt')).toBe('extra');
    expect(readText(h, SCRATCH_ROOT, '/package-lock.json')).toBe(beforeLock);
    expect(h.authority.existsSync(`${SCRATCH_ROOT}/node_modules/pin/readme.txt`)).toBe(false);
    await h.owner.close();
  });

  it('applies overwrite through openProject snapshotApplication', async () => {
    const first = snapshotFixture('{"lockfileVersion":3,"packages":{}}\n', 'pin-a\n');
    const next = snapshotFixture(
      '{"lockfileVersion":3,"packages":{"node_modules/pin":{}}}\n',
      'pin-b\n',
    );
    const h = await acquisitionHarness({
      '/snapshots/a.json.gz': first.gzip,
      '/snapshots/b.json.gz': next.gzip,
    });
    await seedDirtyScratch(h, definition('scratch', first.snapshotId, '/snapshots/a.json.gz'), {
      '/user.txt': 'extra',
    });
    h.authority.mkdirSync(`${SCRATCH_ROOT}/node_modules/local-patch`, { recursive: true });
    h.authority.writeFileSync(
      `${SCRATCH_ROOT}/node_modules/local-patch/keep.txt`,
      encoder.encode('keep-me\n'),
    );

    const opened = await h.owner.openProject(
      definition('scratch', next.snapshotId, '/snapshots/b.json.gz'),
      undefined,
      { mode: 'apply', conflict: 'overwrite' },
    );

    expect(readText(h, SCRATCH_ROOT, '/user.txt')).toBe('extra');
    expect(readText(h, SCRATCH_ROOT, '/node_modules/local-patch/keep.txt')).toBe('keep-me\n');
    expect(readText(h, SCRATCH_ROOT, '/node_modules/pin/readme.txt')).toBe('pin-b\n');
    await close(opened);
    await h.owner.close();
  });
});

describe('snapshot application public surface', () => {
  it('exposes SnapshotApplicationConflictError from the workbench package', async () => {
    const workbench = (await import('../workbench/public.ts')) as {
      SnapshotApplicationConflictError?: unknown;
    };
    expect(workbench.SnapshotApplicationConflictError).toBeTypeOf('function');
  });
});
