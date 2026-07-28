import { RegistryClient } from '@riftydev/npm-client';
import { Shell } from '@riftydev/shell';
import type { FsSync } from '@riftydev/vfs';
import { MemoryFsSync, resetSyncMirror, setSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, describe, expect, expectTypeOf, it } from 'vitest';
import {
  type InstallStampAuthority,
  createInstallStampAuthority,
} from '../glue/install-stamp-authority.ts';
import { type InstallStamp, installStampPath } from '../glue/install-stamp.ts';
import { SyncMirrorVfs } from '../glue/sync-mirror-vfs.ts';
import { ProjectBusyError, ProjectDefinitionMismatchError } from '../workbench/errors.ts';
import { createPlaygroundProjectCatalog } from '../workbench/internal/playground-project-catalog.ts';
import { definePlaygroundProject } from '../workbench/internal/playground-project-definition.ts';
import { projectRuntimeShellLine } from '../workbench/internal/project-runtime-acquisition.ts';
import type {
  NodeCliPlaygroundPlan,
  NodeServerPlaygroundPlan,
  PlaygroundCatalogSnapshot,
  PlaygroundProjectCatalog,
  PlaygroundProjectPlan,
  VitePlaygroundPlan,
} from '../workbench/playground.ts';
import type { ProjectAcquisitionRequest } from '../workbench/project-materialization.ts';
import type { ProjectDefinition } from '../workbench/public.ts';
import { createOwnerPackageState } from './owner-package-state.ts';
import {
  type OwnerVfsAuthority,
  type OwnerVfsAuthorityComposition,
  createOwnerVfsAuthorityComposition,
} from './owner-vfs-authority.ts';
import {
  type PackageAcquisitionAdapter,
  type PackageAcquisitionAuthority,
  createPackageAcquisitionAuthority,
} from './package-acquisition-authority.ts';
import { recoverOwnerPlaygroundArchiveTransaction } from './playground-archive-integration.ts';
import {
  type PlaygroundProjectAuthority,
  createPlaygroundProjectAuthority,
} from './playground-project-authority.ts';
import {
  type DurableOwnerFault,
  DurableOwnerFs,
  type ExactFsTree,
  createDurableOwnerFsFromTree,
} from './test-fixtures/durable-owner-fs.ts';
import { workbenchFirstMaterializationPackageConfig } from './workbench-package-config.ts';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const CAPTURED_URL_CONTEXT = Object.freeze({
  apiBaseUrl: 'https://playground.invalid/app/',
  clientUrl: 'https://playground.invalid/app/index.html',
});
const EDITED_AT = '2026-07-16T12:00:00.000Z';
const CATALOG_FILE = '/.rifty/workbench/playground/catalog.json';
const CATALOG_TRANSACTION_FILE = '/.rifty/workbench/playground/transaction.json';
const SCRATCH_ROOT = '/.rifty/workbench/v1/projects/scratch/tree';
const SCRATCH_ARCHIVE_TRANSACTION = '/.rifty/workbench/v1/projects/scratch/.playground-archive-v1';

type OpenedProject = Awaited<ReturnType<PlaygroundProjectAuthority['openProject']>>;

function plan(
  id: string,
  starterId = 'starter-a',
  overrides: Partial<VitePlaygroundPlan> = {},
): VitePlaygroundPlan {
  return {
    kind: 'vite',
    id,
    starterId,
    templateId: 'vite-template-v1',
    files: {
      '/index.html': '<main>catalog contract</main>\n',
      '/package.json': '{"scripts":{"dev":"vite"},"devDependencies":{"vite":"8.0.0"}}\n',
      '/src/main.ts': 'document.body.dataset.ready = "yes";\n',
    },
    devDependencies: { vite: '8.0.0' },
    port: 5173,
    firstMaterialization: { kind: 'install' },
    ...overrides,
  };
}

function definition(
  id: string,
  starterId = 'starter-a',
  overrides: Partial<VitePlaygroundPlan> = {},
): ProjectDefinition<unknown> {
  return projectDefinition(plan(id, starterId, overrides));
}

function projectDefinition(plan: PlaygroundProjectPlan): ProjectDefinition<unknown> {
  return definePlaygroundProject(plan, CAPTURED_URL_CONTEXT);
}

function freezeExpected<T>(value: T): T {
  if (value === null || typeof value !== 'object' || value instanceof Uint8Array) return value;
  for (const nested of Object.values(value)) freezeExpected(nested);
  return Object.freeze(value);
}

const EMPTY = freezeExpected<PlaygroundCatalogSnapshot>({
  active: null,
  scratch: null,
  projects: [],
});

interface CatalogHarness {
  readonly fs: MemoryFsSync;
  readonly authority: OwnerVfsAuthority;
  readonly installStampClaims: OwnerVfsAuthorityComposition['installStampClaims'];
  readonly stamps: InstallStampAuthority;
  readonly packages: ProjectSavePackageAuthority;
  readonly owner: PlaygroundProjectAuthority;
  readonly catalog: PlaygroundProjectCatalog;
}

type ProjectSaveStampResult =
  | { readonly status: 'untrusted' }
  | { readonly status: 'trusted'; readonly stamp: InstallStamp };

interface ProjectSavePackageAuthority extends PackageAcquisitionAuthority {
  projectSave<T>(
    input: {
      readonly source: { readonly root: string; readonly slug: string };
      readonly target: { readonly root: string; readonly slug: string };
    },
    operation: (rebind: () => Promise<ProjectSaveStampResult>) => Promise<T>,
  ): Promise<T>;
}

function catalogPackageAdapter(): PackageAcquisitionAdapter {
  return {
    readTrustedPackageLock: async () => ({ lockfileVersion: 3, packages: {} }),
    planSnapshotRestore: async () => ({ status: 'rejected', reason: 'not requested' }),
    install: async () => {
      throw new Error('catalog Save contract must not run package acquisition');
    },
    reset: async () => {},
    switchProject: async () => {},
  };
}

async function harness(
  fs = new MemoryFsSync(),
  now: () => string = () => EDITED_AT,
  persistence: 'required' | 'preferred' | 'ephemeral' = 'required',
): Promise<CatalogHarness> {
  const composition = createOwnerVfsAuthorityComposition(fs, {
    ownerEpoch: 'playground-catalog-contract-owner',
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
  }) as ProjectSavePackageAuthority;
  let stageSequence = 0;
  const owner = await (
    createPlaygroundProjectAuthority as unknown as (
      options: Parameters<typeof createPlaygroundProjectAuthority>[0] & {
        readonly projectSave: ProjectSavePackageAuthority;
      },
    ) => Promise<PlaygroundProjectAuthority>
  )({
    ...composition,
    persistence,
    now,
    createStageId: () => `catalog-stage-${String(++stageSequence)}`,
    acquisition: Object.freeze({
      ensure: async () => Object.freeze({ kind: 'install' as const, snapshotFailures: [] }),
    }),
    projectSave: packages,
  });
  return {
    fs,
    authority: composition.authority,
    installStampClaims: composition.installStampClaims,
    stamps,
    packages,
    owner,
    catalog: createPlaygroundProjectCatalog(owner),
  };
}

async function mintTrusted(
  h: CatalogHarness,
  root: string,
  slug: string,
  packages: number,
): Promise<void> {
  const packageJsonText = decoder.decode(h.authority.readFileBytesSync(`${root}/package.json`));
  const claim = await h.stamps.demote({ root, slug }, { flush: () => h.authority.flush() });
  await expect(
    h.stamps.promote(
      { root, slug, packageJsonText },
      { epoch: claim.epoch, packages, flush: () => h.authority.flush() },
    ),
  ).resolves.toMatchObject({ status: 'trusted' });
  const report = await h.authority.flush();
  expect(report?.total ?? 0).toBe(0);
}

function treeFiles(fs: FsSync, root: string): Readonly<Record<string, readonly number[]>> {
  const files: Record<string, readonly number[]> = {};
  const walk = (directory: string): void => {
    for (const entry of fs.readdirSync(directory)) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory) walk(path);
      else files[path.slice(root.length)] = [...fs.readFileBytesSync(path)];
    }
  };
  walk(root);
  return Object.fromEntries(
    Object.entries(files).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function writeText(authority: OwnerVfsAuthority, path: string, text: string): void {
  authority.mkdirSync(path.slice(0, path.lastIndexOf('/')), { recursive: true });
  authority.writeFileSync(path, encoder.encode(text));
}

function expectFrozenSnapshot(snapshot: PlaygroundCatalogSnapshot): void {
  expect(Object.isFrozen(snapshot)).toBe(true);
  expect(Object.isFrozen(snapshot.projects)).toBe(true);
  if (snapshot.active !== null) expect(Object.isFrozen(snapshot.active)).toBe(true);
  if (snapshot.scratch !== null) expect(Object.isFrozen(snapshot.scratch)).toBe(true);
  for (const project of snapshot.projects) expect(Object.isFrozen(project)).toBe(true);
}

async function close(opened: OpenedProject): Promise<void> {
  await opened.close();
}

async function expectUntrustedSaveOfflineOpen(
  tree: ExactFsTree,
  endpoint: 'scratch' | 'project',
): Promise<void> {
  const fs = createDurableOwnerFsFromTree(tree);
  const vfs = new SyncMirrorVfs();
  const composition = createOwnerVfsAuthorityComposition(fs, {
    ownerEpoch: 'playground-untrusted-save-offline-owner',
    initialRoots: ['/', '/.rifty'],
  });
  setSyncMirror(composition.authority, { async: vfs });
  const registryRequests: string[] = [];
  const packages = createOwnerPackageState({
    vfs,
    fsSync: composition.authority,
    installStampClaims: composition.installStampClaims,
    flush: () => composition.authority.flush(),
    nodeWorkerRuntimeEnv: {},
    log: () => {},
    registry: new RegistryClient({
      baseUrl: 'https://registry.invalid/',
      maxRetries: 0,
      fetch: async (url) => {
        registryRequests.push(url);
        throw new Error('acquisition network unavailable');
      },
    }),
    resolverUrl: () => undefined,
    resolverBundleBaseUrl: () => undefined,
    resolverPin: () => undefined,
  });
  let stageSequence = 0;
  const owner = await createPlaygroundProjectAuthority({
    ...composition,
    persistence: 'required',
    now: () => EDITED_AT,
    createStageId: () => `untrusted-save-offline-stage-${String(++stageSequence)}`,
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
    beforeOpenProject: (projectRoot) =>
      recoverOwnerPlaygroundArchiveTransaction({
        projectRoot,
        owner: composition,
        packages,
      }),
  });
  const projectRoot =
    endpoint === 'scratch'
      ? '/.rifty/workbench/v1/projects/scratch/tree'
      : '/.rifty/workbench/v1/projects/project-a/tree';
  const projectDefinition =
    endpoint === 'scratch' ? definition('scratch') : definition('project-a');
  const slug = endpoint === 'scratch' ? 'scratch' : 'project-a';
  let opened: OpenedProject | null = null;
  try {
    expect(owner.catalogSnapshot().active).toEqual(
      endpoint === 'scratch' ? { kind: 'scratch' } : { kind: 'project', id: 'project-a' },
    );
    if (endpoint === 'scratch') {
      expect(fs.existsSync('/.rifty/workbench/v1/projects/project-a')).toBe(false);
    } else {
      expect(fs.existsSync('/.rifty/workbench/v1/projects/scratch')).toBe(false);
      expect(composition.installStampClaims.read(projectRoot)).toBeNull();
    }
    const stamps = createInstallStampAuthority({
      vfs,
      fsSync: composition.authority,
      claimIo: composition.installStampClaims,
    });
    await expect(stamps.check({ root: projectRoot, slug })).resolves.toEqual({
      status: 'absent',
    });
    expect(registryRequests).toEqual([]);

    opened = await owner.openProject(projectDefinition);
    expect(opened.acquisition).toEqual({
      kind: 'install',
      snapshotFailures: [],
    });
    expect(registryRequests).toEqual([]);

    const shell = new Shell({ cwd: projectRoot });
    let reachedLive = false;
    shell.registerCommand(
      'npm',
      packages.createNpmCommand(async () => {
        throw new Error('untrusted Save offline proof must not dispatch npm run');
      }),
    );
    shell.registerCommand('vite', async () => {
      reachedLive = true;
      return 0;
    });
    const result = await shell.run(
      projectRuntimeShellLine('vite --port 5173', opened.acquisition, '/'),
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe('npm: install failed: acquisition network unavailable\n');
    expect(reachedLive).toBe(false);
    expect(registryRequests).toEqual(['https://registry.invalid/vite']);
    expect(owner.catalogSnapshot().active).toEqual(
      endpoint === 'scratch' ? { kind: 'scratch' } : { kind: 'project', id: 'project-a' },
    );
    const freshStamps = createInstallStampAuthority({
      vfs,
      fsSync: composition.authority,
      claimIo: composition.installStampClaims,
    });
    await expect(freshStamps.check({ root: projectRoot, slug })).resolves.not.toMatchObject({
      status: 'trusted',
    });
  } finally {
    await opened?.close();
    await owner.close();
    await packages.quiesce();
  }
}

afterEach(() => {
  resetSyncMirror();
});

describe('PlaygroundProjectCatalog public contract', () => {
  it('derives Starter provenance only from a companion definition and exposes no owner plumbing', async () => {
    expectTypeOf<Parameters<PlaygroundProjectCatalog['createScratch']>[0]>().toEqualTypeOf<{
      readonly definition: ProjectDefinition<unknown>;
      readonly preserveDirtySameStarter?: boolean;
    }>();

    const h = await harness();
    expect(Object.keys(h.catalog).sort()).toEqual([
      'activate',
      'createScratch',
      'delete',
      'rename',
      'reset',
      'saveScratch',
      'snapshot',
      'subscribe',
    ]);
    expect(h.catalog).not.toHaveProperty('recordMutation');
    expect(h.catalog).not.toHaveProperty('openProject');
    expect(h.catalog).not.toHaveProperty('projectRoot');

    const snapshot = await h.catalog.createScratch({ definition: definition('scratch') });

    expect(snapshot).toEqual({
      active: { kind: 'scratch' },
      scratch: { starterId: 'starter-a', dirty: false, editedAt: EDITED_AT },
      projects: [],
    });
    expectFrozenSnapshot(snapshot);
    await h.owner.close();
  });

  it('starts exact-empty, synchronously replays, publishes frozen snapshots in operation order, and settles after reflection', async () => {
    const h = await harness();
    const observed: PlaygroundCatalogSnapshot[] = [];
    const events: string[] = [];

    expect(h.catalog.snapshot()).toEqual(EMPTY);
    expectFrozenSnapshot(h.catalog.snapshot());
    const unsubscribe = h.catalog.subscribe((snapshot) => {
      observed.push(snapshot);
      events.push(`publish:${snapshot.active?.kind ?? 'empty'}`);
    });
    expect(observed).toEqual([EMPTY]);

    const creating = h.catalog.createScratch({ definition: definition('scratch') });
    void creating.then(() => events.push('resolved:create'));
    await creating;
    expect(events.slice(-2)).toEqual(['publish:scratch', 'resolved:create']);

    const saving = h.catalog.saveScratch({
      id: 'project-a',
      name: 'Project A',
      definition: definition('project-a'),
    });
    void saving.then(() => events.push('resolved:save'));
    const saved = await saving;
    expect(events.slice(-2)).toEqual(['publish:project', 'resolved:save']);
    expect(saved).toEqual({
      active: { kind: 'project', id: 'project-a' },
      scratch: null,
      projects: [
        {
          id: 'project-a',
          name: 'Project A',
          starterId: 'starter-a',
          editedAt: EDITED_AT,
        },
      ],
    });
    expectFrozenSnapshot(saved);
    expect(h.catalog.snapshot()).toBe(observed.at(-1));

    unsubscribe();
    await h.catalog.rename('project-a', 'Renamed');
    expect(observed.at(-1)).toBe(saved);
    await h.owner.close();
  });

  it('saves Scratch as a real owner-backed session project in ephemeral storage', async () => {
    const h = await harness(new MemoryFsSync(), () => EDITED_AT, 'ephemeral');
    await h.catalog.createScratch({ definition: definition('scratch') });
    const scratchRoot = '/.rifty/workbench/v1/projects/scratch/tree';
    const projectRoot = '/.rifty/workbench/v1/projects/project-a/tree';
    const editedBytes = encoder.encode('document.body.dataset.saved = "session";\n');
    h.authority.writeFileSync(`${scratchRoot}/src/main.ts`, editedBytes);

    const saved = await h.catalog.saveScratch({
      id: 'project-a',
      name: 'Project A',
      definition: definition('project-a'),
    });

    expect(saved).toEqual({
      active: { kind: 'project', id: 'project-a' },
      scratch: null,
      projects: [
        {
          id: 'project-a',
          name: 'Project A',
          starterId: 'starter-a',
          editedAt: EDITED_AT,
        },
      ],
    });
    expect(h.fs.existsSync('/.rifty/workbench/v1/projects/scratch')).toBe(false);
    expect(h.fs.readFileBytesSync(`${projectRoot}/src/main.ts`)).toEqual(editedBytes);
    expect(h.fs.existsSync(CATALOG_FILE)).toBe(true);

    const reopened = await h.owner.openProject(definition('project-a'));
    expect(reopened.projectRoot).toBe(projectRoot);
    expect(h.fs.readFileBytesSync(`${reopened.projectRoot}/src/main.ts`)).toEqual(editedBytes);
    await close(reopened);
    await h.owner.close();
  });

  it('uses one stored creation order and exact active-selection rules across Scratch and projects', async () => {
    const h = await harness();
    await h.catalog.createScratch({ definition: definition('scratch') });
    await h.catalog.saveScratch({
      id: 'project-a',
      name: 'Project A',
      definition: definition('project-a'),
    });
    await h.catalog.createScratch({
      definition: definition('scratch', 'starter-b', {
        files: { '/index.html': '<main>starter b</main>\n' },
      }),
    });
    await h.catalog.saveScratch({
      id: 'project-b',
      name: 'Project B',
      definition: definition('project-b', 'starter-b', {
        files: { '/index.html': '<main>starter b</main>\n' },
      }),
    });
    await h.catalog.createScratch({
      definition: definition('scratch', 'starter-c', {
        files: { '/index.html': '<main>starter c</main>\n' },
      }),
    });

    expect(h.catalog.snapshot()).toEqual({
      active: { kind: 'scratch' },
      scratch: { starterId: 'starter-c', dirty: false, editedAt: EDITED_AT },
      projects: [
        {
          id: 'project-a',
          name: 'Project A',
          starterId: 'starter-a',
          editedAt: EDITED_AT,
        },
        {
          id: 'project-b',
          name: 'Project B',
          starterId: 'starter-b',
          editedAt: EDITED_AT,
        },
      ],
    });

    await h.catalog.activate({ kind: 'project', id: 'project-b' });
    await h.catalog.delete('project-b');
    expect(h.catalog.snapshot().active).toEqual({ kind: 'scratch' });
    await h.catalog.activate({ kind: 'project', id: 'project-a' });
    await h.catalog.delete('project-a');
    expect(h.catalog.snapshot().active).toEqual({ kind: 'scratch' });
    await h.catalog.activate({ kind: 'scratch' });
    expect(h.catalog.snapshot().active).toEqual({ kind: 'scratch' });
    await expect(h.catalog.activate({ kind: 'project', id: 'missing' })).rejects.toThrow();
    expect(h.catalog.snapshot().projects).toEqual([]);
    await h.owner.close();

    const withoutScratch = await harness();
    await withoutScratch.catalog.createScratch({ definition: definition('scratch') });
    await withoutScratch.catalog.saveScratch({
      id: 'first',
      name: 'First',
      definition: definition('first'),
    });
    await withoutScratch.catalog.createScratch({ definition: definition('scratch') });
    await withoutScratch.catalog.saveScratch({
      id: 'second',
      name: 'Second',
      definition: definition('second'),
    });
    await withoutScratch.catalog.activate({ kind: 'project', id: 'first' });
    await withoutScratch.catalog.delete('first');
    expect(withoutScratch.catalog.snapshot().active).toEqual({ kind: 'project', id: 'second' });
    await withoutScratch.catalog.delete('second');
    expect(withoutScratch.catalog.snapshot()).toEqual(EMPTY);
    await withoutScratch.owner.close();
  });

  it('rejects absent refs, the reserved named id, and every definition/target-id mismatch before effects', async () => {
    const h = await harness();
    const before = h.catalog.snapshot();

    await expect(h.catalog.activate({ kind: 'scratch' })).rejects.toThrow();
    await expect(
      h.catalog.createScratch({ definition: definition('not-scratch') }),
    ).rejects.toBeInstanceOf(ProjectDefinitionMismatchError);
    expect(h.catalog.snapshot()).toBe(before);

    await h.catalog.createScratch({ definition: definition('scratch') });
    const scratch = h.catalog.snapshot();
    await expect(
      h.catalog.saveScratch({
        id: 'scratch',
        name: 'Reserved',
        definition: definition('scratch'),
      }),
    ).rejects.toThrow();
    await expect(
      h.catalog.saveScratch({
        id: 'project-a',
        name: 'Project A',
        definition: definition('project-b'),
      }),
    ).rejects.toBeInstanceOf(ProjectDefinitionMismatchError);
    await expect(
      h.catalog.reset({
        target: { kind: 'scratch' },
        definition: definition('project-a'),
      }),
    ).rejects.toBeInstanceOf(ProjectDefinitionMismatchError);
    expect(h.catalog.snapshot()).toBe(scratch);

    await h.catalog.saveScratch({
      id: 'project-a',
      name: 'Project A',
      definition: definition('project-a'),
    });
    const project = h.catalog.snapshot();
    await expect(
      h.catalog.reset({
        target: { kind: 'project', id: 'project-a' },
        definition: definition('project-b'),
      }),
    ).rejects.toBeInstanceOf(ProjectDefinitionMismatchError);
    expect(h.catalog.snapshot()).toBe(project);
    await h.owner.close();
  });

  it('preserves the active ref when deleting a non-active project', async () => {
    const h = await harness();
    await h.catalog.createScratch({ definition: definition('scratch') });
    await h.catalog.saveScratch({
      id: 'project-a',
      name: 'Project A',
      definition: definition('project-a'),
    });
    await h.catalog.createScratch({ definition: definition('scratch', 'starter-b') });
    await h.catalog.saveScratch({
      id: 'project-b',
      name: 'Project B',
      definition: definition('project-b', 'starter-b'),
    });
    await h.catalog.activate({ kind: 'project', id: 'project-a' });

    await h.catalog.delete('project-b');

    expect(h.catalog.snapshot().active).toEqual({ kind: 'project', id: 'project-a' });
    expect(h.catalog.snapshot().projects.map((project) => project.id)).toEqual(['project-a']);
    await h.owner.close();
  });
});

describe('Playground catalog baseline provenance', () => {
  it('preserves a dirty exact-baseline Scratch as an identity-level no-op', async () => {
    let now = '2026-07-16T12:00:00.000Z';
    const h = await harness(new MemoryFsSync(), () => now);
    await h.catalog.createScratch({ definition: definition('scratch') });
    const scratch = await h.owner.openProject(definition('scratch'));
    h.authority.writeFileSync(
      `${scratch.projectRoot}/src/main.ts`,
      encoder.encode('user-owned dirty bytes'),
    );
    h.authority.writeFileSync(`${scratch.projectRoot}/user.txt`, encoder.encode('keep me'));
    await h.owner.recordMutation({
      kind: 'guest',
      project: scratch,
      treeRevision: h.owner.treeRevision(),
    });
    const beforeTree = treeFiles(h.fs, scratch.projectRoot);
    await close(scratch);

    const before = h.catalog.snapshot();
    expect(before.scratch).toEqual({
      starterId: 'starter-a',
      dirty: true,
      editedAt: '2026-07-16T12:00:00.000Z',
    });
    const observed: PlaygroundCatalogSnapshot[] = [];
    const unsubscribe = h.catalog.subscribe((snapshot) => observed.push(snapshot));
    now = '2026-07-17T13:00:00.000Z';

    const preserved = await h.catalog.createScratch({
      definition: definition('scratch'),
      preserveDirtySameStarter: true,
    });

    expect(preserved).toBe(before);
    expect(h.catalog.snapshot()).toBe(before);
    expect(observed).toEqual([before]);
    const reopened = await h.owner.openProject(definition('scratch'));
    expect(treeFiles(h.fs, reopened.projectRoot)).toEqual(beforeTree);
    expect(decoder.decode(h.fs.readFileBytesSync(`${reopened.projectRoot}/src/main.ts`))).toBe(
      'user-owned dirty bytes',
    );
    expect(decoder.decode(h.fs.readFileBytesSync(`${reopened.projectRoot}/user.txt`))).toBe(
      'keep me',
    );
    await close(reopened);

    unsubscribe();
    await h.owner.close();
  });

  it.each([
    {
      case: 'the flag is false',
      preserveDirtySameStarter: false,
      candidate: definition('scratch'),
      expectedStarterId: 'starter-a',
      expectedMain: 'document.body.dataset.ready = "yes";\n',
    },
    {
      case: 'the baseline differs under the same Starter id',
      preserveDirtySameStarter: true,
      candidate: definition('scratch', 'starter-a', {
        files: { '/src/main.ts': 'same Starter, replacement baseline\n' },
      }),
      expectedStarterId: 'starter-a',
      expectedMain: 'same Starter, replacement baseline\n',
    },
    {
      case: 'the Starter id differs',
      preserveDirtySameStarter: true,
      candidate: definition('scratch', 'starter-b', {
        files: { '/src/main.ts': 'different Starter baseline\n' },
      }),
      expectedStarterId: 'starter-b',
      expectedMain: 'different Starter baseline\n',
    },
  ])('re-seeds a dirty Scratch when $case', async (testCase) => {
    let now = '2026-07-16T12:00:00.000Z';
    const h = await harness(new MemoryFsSync(), () => now);
    await h.catalog.createScratch({ definition: definition('scratch') });
    const scratch = await h.owner.openProject(definition('scratch'));
    h.authority.writeFileSync(`${scratch.projectRoot}/src/main.ts`, encoder.encode('dirty bytes'));
    h.authority.writeFileSync(`${scratch.projectRoot}/user.txt`, encoder.encode('remove me'));
    await h.owner.recordMutation({
      kind: 'guest',
      project: scratch,
      treeRevision: h.owner.treeRevision(),
    });
    await close(scratch);
    const before = h.catalog.snapshot();
    expect(before.scratch?.dirty).toBe(true);
    const observed: PlaygroundCatalogSnapshot[] = [];
    const unsubscribe = h.catalog.subscribe((snapshot) => observed.push(snapshot));
    now = '2026-07-17T13:00:00.000Z';

    const reseeded = await h.catalog.createScratch({
      definition: testCase.candidate,
      preserveDirtySameStarter: testCase.preserveDirtySameStarter,
    });

    expect(reseeded).not.toBe(before);
    expect(reseeded.scratch).toEqual({
      starterId: testCase.expectedStarterId,
      dirty: false,
      editedAt: '2026-07-17T13:00:00.000Z',
    });
    expect(observed).toEqual([before, reseeded]);
    const opened = await h.owner.openProject(testCase.candidate);
    expect(h.fs.existsSync(`${opened.projectRoot}/user.txt`)).toBe(false);
    expect(decoder.decode(h.fs.readFileBytesSync(`${opened.projectRoot}/src/main.ts`))).toBe(
      testCase.expectedMain,
    );
    await close(opened);

    unsubscribe();
    await h.owner.close();
  });

  it('re-seeds a clean exact-baseline Scratch even when preservation is requested', async () => {
    let now = '2026-07-16T12:00:00.000Z';
    const h = await harness(new MemoryFsSync(), () => now);
    const before = await h.catalog.createScratch({ definition: definition('scratch') });
    const observed: PlaygroundCatalogSnapshot[] = [];
    const unsubscribe = h.catalog.subscribe((snapshot) => observed.push(snapshot));
    now = '2026-07-17T13:00:00.000Z';

    const reseeded = await h.catalog.createScratch({
      definition: definition('scratch'),
      preserveDirtySameStarter: true,
    });

    expect(reseeded).not.toBe(before);
    expect(reseeded.scratch).toEqual({
      starterId: 'starter-a',
      dirty: false,
      editedAt: '2026-07-17T13:00:00.000Z',
    });
    expect(observed).toEqual([before, reseeded]);

    unsubscribe();
    await h.owner.close();
  });

  it('lets durable id vary on Save, rejects every Starter-baseline drift, and leaves Scratch exact on rejection', async () => {
    const h = await harness();
    await h.catalog.createScratch({ definition: definition('scratch') });
    const scratch = await h.owner.openProject(definition('scratch'));
    h.authority.mkdirSync(`${scratch.projectRoot}/notes`, { recursive: true });
    h.authority.writeFileSync(
      `${scratch.projectRoot}/notes/user.txt`,
      encoder.encode('user bytes'),
    );
    await h.owner.recordMutation({
      kind: 'guest',
      project: scratch,
      treeRevision: h.owner.treeRevision(),
    });
    await close(scratch);

    const before = h.catalog.snapshot();
    expect(before.scratch?.dirty).toBe(true);
    const mismatches = [
      definition('project-a', 'starter-b'),
      definition('project-a', 'starter-a', { templateId: 'vite-template-v2' }),
      definition('project-a', 'starter-a', {
        files: { '/index.html': '<main>different baseline</main>\n' },
      }),
      definition('project-a', 'starter-a', { port: 5174 }),
      definition('project-a', 'starter-a', {
        firstMaterialization: {
          kind: 'snapshot',
          snapshot: {
            snapshotId: `sha256:${'a'.repeat(64)}`,
            assetUrl: '/snapshots/vite.json',
            templateId: 'vite-template-v1',
          },
        },
      }),
    ];

    for (const candidate of mismatches) {
      await expect(
        h.catalog.saveScratch({ id: 'project-a', name: 'Project A', definition: candidate }),
      ).rejects.toBeInstanceOf(ProjectDefinitionMismatchError);
      expect(h.catalog.snapshot()).toBe(before);
    }

    await h.catalog.saveScratch({
      id: 'project-a',
      name: 'Project A',
      definition: definition('project-a'),
    });
    const opened = await h.owner.openProject(definition('project-a'));
    expect(decoder.decode(h.fs.readFileBytesSync(`${opened.projectRoot}/notes/user.txt`))).toBe(
      'user bytes',
    );
    await close(opened);
    await h.owner.close();
  });

  it('fingerprints dependency sections and every finite runtime field without a lossy projection', async () => {
    const files = Object.freeze({
      '/entry-a.mjs': 'export const entry = "a";\n',
      '/entry-b.mjs': 'export const entry = "b";\n',
      '/package.json': '{"name":"identity-contract","version":"1.0.0"}\n',
    });
    const materialization = Object.freeze({ kind: 'install' as const });
    const vite = (id: string, overrides: Partial<VitePlaygroundPlan> = {}): VitePlaygroundPlan => ({
      kind: 'vite',
      id,
      starterId: 'identity-starter',
      templateId: 'identity-template',
      files,
      dependencies: { kleur: '4.1.5' },
      devDependencies: { typescript: '5.9.3' },
      port: 5173,
      viteVersion: '8.0.0',
      firstMaterialization: materialization,
      ...overrides,
    });
    const server = (
      id: string,
      overrides: Partial<NodeServerPlaygroundPlan> = {},
    ): NodeServerPlaygroundPlan => ({
      kind: 'node-server',
      id,
      starterId: 'identity-starter',
      templateId: 'identity-template',
      files,
      dependencies: { kleur: '4.1.5' },
      devDependencies: { typescript: '5.9.3' },
      entryPath: '/entry-a.mjs',
      port: 5173,
      firstMaterialization: materialization,
      ...overrides,
    });
    const cli = (
      id: string,
      overrides: Partial<NodeCliPlaygroundPlan> = {},
    ): NodeCliPlaygroundPlan => ({
      kind: 'node-cli',
      id,
      starterId: 'identity-starter',
      templateId: 'identity-template',
      files,
      dependencies: { kleur: '4.1.5' },
      devDependencies: { typescript: '5.9.3' },
      entryPath: '/entry-a.mjs',
      args: ['--mode', 'a'],
      firstMaterialization: materialization,
      ...overrides,
    });
    const cases: readonly {
      readonly name: string;
      readonly initial: PlaygroundProjectPlan;
      readonly mismatches: readonly PlaygroundProjectPlan[];
    }[] = [
      {
        name: 'Vite dependency sections, version and runtime kind',
        initial: vite('scratch'),
        mismatches: [
          vite('project-a', { dependencies: { kleur: '4.1.4' } }),
          vite('project-a', { devDependencies: { typescript: '5.9.2' } }),
          vite('project-a', {
            dependencies: {},
            devDependencies: { typescript: '5.9.3', kleur: '4.1.5' },
          }),
          vite('project-a', { viteVersion: '8.1.0' }),
          server('project-a'),
        ],
      },
      {
        name: 'Node server entry and port',
        initial: server('scratch'),
        mismatches: [
          server('project-a', { entryPath: '/entry-b.mjs' }),
          server('project-a', { port: 5174 }),
        ],
      },
      {
        name: 'Node CLI entry and arguments',
        initial: cli('scratch'),
        mismatches: [
          cli('project-a', { entryPath: '/entry-b.mjs' }),
          cli('project-a', { args: ['--mode', 'b'] }),
          cli('project-a', { args: [] }),
        ],
      },
    ];

    for (const testCase of cases) {
      const h = await harness();
      await h.catalog.createScratch({ definition: projectDefinition(testCase.initial) });
      const before = h.catalog.snapshot();
      for (const candidate of testCase.mismatches) {
        await expect(
          h.catalog.saveScratch({
            id: 'project-a',
            name: testCase.name,
            definition: projectDefinition(candidate),
          }),
        ).rejects.toBeInstanceOf(ProjectDefinitionMismatchError);
        expect(h.catalog.snapshot()).toBe(before);
      }
      await h.owner.close();
    }
  });

  it('excludes snapshot asset location from baseline identity but includes snapshot provenance', async () => {
    const h = await harness();
    const snapshotId = `sha256:${'a'.repeat(64)}`;
    const initialMaterialization = {
      kind: 'snapshot' as const,
      snapshot: {
        snapshotId,
        assetUrl: '/snapshots/vite-node-modules.json.gz',
        templateId: 'vite-template-v1',
      },
    };
    await h.catalog.createScratch({
      definition: definition('scratch', 'starter-a', {
        firstMaterialization: initialMaterialization,
      }),
    });

    const before = h.catalog.snapshot();
    for (const firstMaterialization of [
      {
        kind: 'snapshot' as const,
        snapshot: {
          snapshotId: `sha256:${'b'.repeat(64)}`,
          assetUrl: '/snapshots/vite-node-modules.json.gz',
          templateId: 'vite-template-v1',
        },
      },
      {
        kind: 'snapshot' as const,
        snapshot: {
          snapshotId,
          assetUrl: '/snapshots/vite-node-modules.json.gz',
          templateId: 'shared-vite-dependencies-v2',
        },
      },
    ]) {
      await expect(
        h.catalog.saveScratch({
          id: 'project-a',
          name: 'Project A',
          definition: definition('project-a', 'starter-a', { firstMaterialization }),
        }),
      ).rejects.toBeInstanceOf(ProjectDefinitionMismatchError);
      expect(h.catalog.snapshot()).toBe(before);
    }

    await h.catalog.saveScratch({
      id: 'project-a',
      name: 'Project A',
      definition: definition('project-a', 'starter-a', {
        firstMaterialization: {
          ...initialMaterialization,
          snapshot: {
            ...initialMaterialization.snapshot,
            assetUrl: '/relocated/vite-node-modules.json.gz',
          },
        },
      }),
    });
    expect(h.catalog.snapshot().active).toEqual({ kind: 'project', id: 'project-a' });
    await h.owner.close();
  });

  it('allows only Reset to replace a Scratch or project baseline and re-seeds the whole tree', async () => {
    const h = await harness();
    await h.catalog.createScratch({ definition: definition('scratch') });
    const scratch = await h.owner.openProject(definition('scratch'));
    h.authority.writeFileSync(`${scratch.projectRoot}/stray.txt`, encoder.encode('remove me'));
    await h.owner.recordMutation({
      kind: 'guest',
      project: scratch,
      treeRevision: h.owner.treeRevision(),
    });
    await close(scratch);

    const scratchB = definition('scratch', 'starter-b', {
      files: { '/src/main.ts': 'console.log("starter b");\n' },
      templateId: 'vite-template-v2',
      port: 5174,
    });
    await h.catalog.reset({ target: { kind: 'scratch' }, definition: scratchB });
    expect(h.catalog.snapshot().scratch).toEqual({
      starterId: 'starter-b',
      dirty: false,
      editedAt: EDITED_AT,
    });
    const resetScratch = await h.owner.openProject(scratchB);
    expect(h.fs.existsSync(`${resetScratch.projectRoot}/stray.txt`)).toBe(false);
    expect(decoder.decode(h.fs.readFileBytesSync(`${resetScratch.projectRoot}/src/main.ts`))).toBe(
      'console.log("starter b");\n',
    );
    await close(resetScratch);

    await h.catalog.saveScratch({
      id: 'project-b',
      name: 'Project B',
      definition: definition('project-b', 'starter-b', {
        files: { '/src/main.ts': 'console.log("starter b");\n' },
        templateId: 'vite-template-v2',
        port: 5174,
      }),
    });
    const projectC = definition('project-b', 'starter-c', {
      files: { '/src/main.ts': 'console.log("starter c");\n' },
      templateId: 'vite-template-v3',
      port: 5175,
    });
    await h.catalog.reset({
      target: { kind: 'project', id: 'project-b' },
      definition: projectC,
    });
    expect(h.catalog.snapshot().projects[0]).toEqual({
      id: 'project-b',
      name: 'Project B',
      starterId: 'starter-c',
      editedAt: EDITED_AT,
    });
    const resetProject = await h.owner.openProject(projectC);
    expect(decoder.decode(h.fs.readFileBytesSync(`${resetProject.projectRoot}/src/main.ts`))).toBe(
      'console.log("starter c");\n',
    );
    await close(resetProject);
    await h.owner.close();
  });
});

describe('Playground catalog single owner and busy gate', () => {
  it('acknowledges an exact project-rooted terminal seed from the real owner tree', async () => {
    const h = await harness();
    await h.catalog.createScratch({ definition: definition('scratch') });
    const env = { PATH: '/bin', RIFTY_OWNER_TOKEN: 'opaque-guest-data' };
    const requested = { cwd: '/src', env };

    const opening = h.owner.openProject(definition('scratch'), requested);
    requested.cwd = '/mutated-after-admission';
    env.PATH = '/mutated-after-admission';
    const opened = await opening;

    expect(opened.initialTerminalState).toEqual({
      cwd: '/src',
      env: { PATH: '/bin', RIFTY_OWNER_TOKEN: 'opaque-guest-data' },
    });
    expect(Object.isFrozen(opened.initialTerminalState)).toBe(true);
    expect(Object.isFrozen(opened.initialTerminalState?.env)).toBe(true);
    await close(opened);

    const stale = await h.owner.openProject(definition('scratch'), {
      cwd: '/deleted',
      env: { KEEP: 'yes', RIFTY_OWNER_TOKEN: 'still-guest-data' },
    });
    expect(stale.initialTerminalState).toEqual({
      cwd: '/',
      env: { KEEP: 'yes', RIFTY_OWNER_TOKEN: 'still-guest-data' },
    });
    await close(stale);
    await h.owner.close();
  });

  it.each([
    ['guest', '/mutation-guest.txt', true],
    ['scm', '/.git/index', true],
    ['archive', '/archive.txt', true],
    ['file', '/file.txt', true],
    ['package-manifest', '/package.json', true],
    ['package-lock', '/package-lock.json', true],
    ['seed', '/seed.txt', false],
    ['dependency', '/node_modules/pkg/index.js', false],
    ['reserved-authority', null, false],
  ] as const)(
    'classifies a %s mutation before the originating operation settles',
    async (kind, relativePath, expectedDirty) => {
      const h = await harness();
      await h.catalog.createScratch({ definition: definition('scratch') });
      const opened = await h.owner.openProject(definition('scratch'));
      const observed: boolean[] = [];
      const events: string[] = [];
      h.catalog.subscribe((snapshot) => {
        const dirty = snapshot.scratch?.dirty ?? false;
        observed.push(dirty);
        if (dirty) events.push('published');
      });

      if (relativePath === null) {
        h.installStampClaims.write(opened.projectRoot, encoder.encode('owner claim'), {
          mkdirTree: true,
        });
      } else {
        const path = `${opened.projectRoot}${relativePath}`;
        h.authority.mkdirSync(path.slice(0, path.lastIndexOf('/')), { recursive: true });
        h.authority.writeFileSync(path, encoder.encode(kind));
      }
      const reflected = h.owner.recordMutation({
        kind,
        project: opened,
        treeRevision: h.owner.treeRevision(),
      });
      void reflected.then(() => events.push('resolved'));
      await reflected;

      expect(h.catalog.snapshot().scratch?.dirty).toBe(expectedDirty);
      expect(observed).toEqual(expectedDirty ? [false, true] : [false]);
      expect(events).toEqual(expectedDirty ? ['published', 'resolved'] : ['resolved']);

      await close(opened);
      await h.owner.close();
    },
  );

  it('gates tree-changing catalog/root operations while live, allows rename, and routes both delete surfaces through the same state owner', async () => {
    const h = await harness();
    await h.catalog.createScratch({ definition: definition('scratch') });
    await h.catalog.saveScratch({
      id: 'project-a',
      name: 'Project A',
      definition: definition('project-a'),
    });
    const opened = await h.owner.openProject(definition('project-a'));

    const blocked = [
      h.catalog.createScratch({ definition: definition('scratch') }),
      h.catalog.saveScratch({
        id: 'project-b',
        name: 'Project B',
        definition: definition('project-b'),
      }),
      h.catalog.activate({ kind: 'project', id: 'project-a' }),
      h.catalog.reset({
        target: { kind: 'project', id: 'project-a' },
        definition: definition('project-a'),
      }),
      h.catalog.delete('project-a'),
      h.owner.deleteProject('project-a'),
    ];
    for (const operation of blocked)
      await expect(operation).rejects.toBeInstanceOf(ProjectBusyError);

    await h.catalog.rename('project-a', 'Renamed while live');
    expect(h.catalog.snapshot().projects[0]?.name).toBe('Renamed while live');
    await close(opened);
    await h.owner.deleteProject('project-a');
    expect(h.catalog.snapshot()).toEqual(EMPTY);

    await h.catalog.createScratch({ definition: definition('scratch') });
    await h.catalog.saveScratch({
      id: 'project-b',
      name: 'Project B',
      definition: definition('project-b'),
    });
    await h.catalog.delete('project-b');
    expect(h.catalog.snapshot()).toEqual(EMPTY);
    await h.owner.close();
  });

  it('catalog-gates root open by active ref, exact Starter baseline, and same-companion provenance', async () => {
    const h = await harness();
    await h.catalog.createScratch({ definition: definition('scratch') });
    await h.catalog.saveScratch({
      id: 'project-a',
      name: 'Project A',
      definition: definition('project-a'),
    });
    await h.catalog.createScratch({ definition: definition('scratch') });

    await expect(h.owner.openProject(definition('project-a'))).rejects.toThrow();
    await expect(
      h.owner.openProject(
        definition('scratch', 'starter-a', {
          files: { '/index.html': '<main>forged baseline</main>\n' },
        }),
      ),
    ).rejects.toBeInstanceOf(ProjectDefinitionMismatchError);
    const rootDefinition = definePlaygroundProject(
      plan('scratch'),
      Object.freeze({
        apiBaseUrl: 'https://other.invalid/app/',
        clientUrl: 'https://other.invalid/app/index.html',
      }),
    );
    await expect(h.owner.openProject(rootDefinition)).rejects.toThrow(TypeError);

    const opened = await h.owner.openProject(definition('scratch'));
    await close(opened);
    await h.owner.close();
  });
});

describe('Playground catalog crash recovery', () => {
  // Fault class: torn-state × stale-derived-state. `openProject` is the first
  // public owner seam that may construct package/runtime state after a crash.
  it('rolls an armed archive forward before openProject acquisition reads the owner tree', async () => {
    const durable = new DurableOwnerFs();
    const seeded = await harness(durable);
    await seeded.catalog.createScratch({ definition: definition('scratch') });
    await seeded.authority.flush();
    const recoveredPackageJson =
      '{"name":"recovered","scripts":{"dev":"vite"},"devDependencies":{"vite":"8.0.0"}}\n';
    writeText(
      seeded.authority,
      `${SCRATCH_ARCHIVE_TRANSACTION}/stage/package.json`,
      recoveredPackageJson,
    );
    writeText(
      seeded.authority,
      `${SCRATCH_ARCHIVE_TRANSACTION}/stage/index.html`,
      '<main>recovered</main>\n',
    );
    writeText(
      seeded.authority,
      `${SCRATCH_ARCHIVE_TRANSACTION}/stage/src/main.ts`,
      'document.body.dataset.ready = "recovered";\n',
    );
    writeText(seeded.authority, `${SCRATCH_ARCHIVE_TRANSACTION}/phase`, 'promoting\n');
    seeded.authority.rmSync(`${SCRATCH_ROOT}/package.json`, { force: true });
    seeded.authority.rmSync(`${SCRATCH_ROOT}/src`, { recursive: true, force: true });
    await seeded.authority.flush();

    const fs = durable.restartFromDurableState();
    const vfs = new SyncMirrorVfs();
    setSyncMirror(fs, { async: vfs });
    const composition = createOwnerVfsAuthorityComposition(fs, {
      ownerEpoch: 'playground-open-recovery-owner',
      initialRoots: ['/', '/.rifty'],
    });
    const packages = createOwnerPackageState({
      vfs,
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
    const timeline: string[] = [];
    let stageSequence = 0;
    const owner = await createPlaygroundProjectAuthority({
      ...composition,
      persistence: 'required',
      now: () => EDITED_AT,
      createStageId: () => `open-recovery-stage-${String(++stageSequence)}`,
      beforeOpenProject: async (projectRoot) => {
        timeline.push('recovery:start');
        await recoverOwnerPlaygroundArchiveTransaction({
          projectRoot,
          owner: composition,
          packages,
        });
        timeline.push('recovery:end');
      },
      acquisition: Object.freeze({
        ensure: async ({ projectRoot }: ProjectAcquisitionRequest) => {
          timeline.push('acquisition');
          expect(projectRoot).toBe(SCRATCH_ROOT);
          expect(composition.authority.statSyncOrNull(SCRATCH_ARCHIVE_TRANSACTION)).toBeNull();
          expect(
            decoder.decode(composition.authority.readFileBytesSync(`${projectRoot}/package.json`)),
          ).toBe(recoveredPackageJson);
          expect(decoder.decode(await vfs.readFile(`${projectRoot}/package.json`))).toBe(
            recoveredPackageJson,
          );
          return Object.freeze({ kind: 'install' as const, snapshotFailures: [] });
        },
      }),
      projectSave: packages,
    });

    const opened = await owner.openProject(definition('scratch'));

    expect(timeline).toEqual(['recovery:start', 'recovery:end', 'acquisition']);
    expect(
      decoder.decode(composition.authority.readFileBytesSync(`${SCRATCH_ROOT}/src/main.ts`)),
    ).toBe('document.body.dataset.ready = "recovered";\n');
    await opened.close();
    await owner.close();
    await packages.quiesce();
  });

  it('removes an orphan staged-transaction tree when no journal owns it', async () => {
    const fs = new MemoryFsSync();
    const orphan = '/.rifty/workbench/playground/catalog-transactions/orphan/0-project/after';
    fs.mkdirSync(orphan, { recursive: true });
    fs.writeFileSync(`${orphan}/orphan.txt`, encoder.encode('orphan'));

    const h = await harness(fs);

    expect(h.catalog.snapshot()).toEqual(EMPTY);
    expect(h.fs.existsSync('/.rifty/workbench/playground/catalog-transactions')).toBe(false);
    await h.owner.close();
  });

  it.each([
    { phase: 'apply' as const, expected: 'before' as const },
    { phase: 'commit' as const, expected: 'after' as const },
  ])('recovers a durable v1 inline-tree $phase leftover to exact $expected state', async (row) => {
    const fs = new MemoryFsSync();
    const scratchContainer = '/.rifty/workbench/v1/projects/scratch';
    const legacyBytes = encoder.encode('legacy inline transaction bytes');
    fs.mkdirSync(`${scratchContainer}/tree`, { recursive: true });
    fs.writeFileSync(`${scratchContainer}/tree/partial.txt`, encoder.encode('partial'));
    fs.mkdirSync('/.rifty/workbench/playground', { recursive: true });
    fs.writeFileSync(
      CATALOG_TRANSACTION_FILE,
      encoder.encode(
        JSON.stringify({
          version: 1,
          kind: 'catalog-mutation',
          phase: row.phase,
          beforeCatalog: null,
          afterCatalog: {
            version: 1,
            active: { kind: 'scratch' },
            scratch: {
              starterId: 'starter-a',
              dirty: false,
              editedAt: EDITED_AT,
              adoption: {
                kind: 'adopted',
                definitionIdentity: 'legacy-definition',
                baselineFingerprint: 'legacy-baseline',
              },
            },
            projects: [],
          },
          roots: [
            {
              path: scratchContainer,
              before: null,
              after: {
                directories: ['', 'tree'],
                files: [{ path: 'tree/legacy.txt', bytes: [...legacyBytes] }],
              },
            },
          ],
        }),
      ),
    );

    const h = await harness(fs);

    expect(h.fs.existsSync(CATALOG_TRANSACTION_FILE)).toBe(false);
    if (row.expected === 'before') {
      expect(h.catalog.snapshot()).toEqual(EMPTY);
      expect(h.fs.existsSync(scratchContainer)).toBe(false);
    } else {
      expect(h.catalog.snapshot()).toEqual({
        active: { kind: 'scratch' },
        scratch: { starterId: 'starter-a', dirty: false, editedAt: EDITED_AT },
        projects: [],
      });
      expect(h.fs.readFileBytesSync(`${scratchContainer}/tree/legacy.txt`)).toEqual(legacyBytes);
      expect(h.fs.existsSync(`${scratchContainer}/tree/partial.txt`)).toBe(false);
    }
    await h.owner.close();
  });

  it('keeps transaction metadata bounded while Save preserves a large dependency tree', async () => {
    const fs = new DurableOwnerFs();
    const h = await harness(fs);
    await h.catalog.createScratch({ definition: definition('scratch') });
    const scratchRoot = '/.rifty/workbench/v1/projects/scratch/tree';
    const dependencyPath = `${scratchRoot}/node_modules/large/index.js`;
    const dependencyBytes = new Uint8Array(512 * 1024).fill(0xab);
    h.authority.mkdirSync(dependencyPath.slice(0, dependencyPath.lastIndexOf('/')), {
      recursive: true,
    });
    h.authority.writeFileSync(dependencyPath, dependencyBytes);
    h.installStampClaims.write(scratchRoot, encoder.encode('root-bound claim'), {
      mkdirTree: true,
    });
    const setupFlush = await h.authority.flush();
    expect(setupFlush?.total ?? 0).toBe(0);

    fs.armPersistFailure(Number.MAX_SAFE_INTEGER, 'quota-report');
    await h.catalog.saveScratch({
      id: 'project-a',
      name: 'Project A',
      definition: definition('project-a'),
    });
    fs.disarmPersistFailure();

    const transactionSizes = fs.durabilityBoundaries.flatMap((boundary) => {
      const bytes = boundary.durableState.files[CATALOG_TRANSACTION_FILE];
      return bytes === undefined ? [] : [bytes.byteLength];
    });
    const dependencyCopyCounts = fs.durabilityBoundaries.map(
      (boundary) =>
        Object.keys(boundary.durableState.files).filter((path) =>
          path.endsWith('/node_modules/large/index.js'),
        ).length,
    );
    expect(transactionSizes.length).toBeGreaterThan(0);
    expect(Math.max(...transactionSizes)).toBeLessThan(64 * 1024);
    expect(Math.max(...dependencyCopyCounts)).toBeLessThanOrEqual(2);
    const projectRoot = '/.rifty/workbench/v1/projects/project-a/tree';
    expect(h.fs.readFileBytesSync(`${projectRoot}/node_modules/large/index.js`)).toEqual(
      dependencyBytes,
    );
    expect(h.installStampClaims.read(projectRoot)).toBeNull();
    await expect(h.stamps.check({ root: projectRoot, slug: 'project-a' })).resolves.toEqual({
      status: 'absent',
    });
    expect(h.fs.existsSync('/.rifty/workbench/v1/projects/scratch')).toBe(false);
    await h.owner.close();
  });

  it('rebinds only the trusted top Scratch claim after a claim-free Save copy', async () => {
    const h = await harness();
    await h.catalog.createScratch({ definition: definition('scratch') });
    const scratchRoot = '/.rifty/workbench/v1/projects/scratch/tree';
    const projectRoot = '/.rifty/workbench/v1/projects/project-a/tree';
    const nestedRelative = 'node_modules/pkg/examples/nested';
    const nestedScratchRoot = `${scratchRoot}/${nestedRelative}`;
    const nestedProjectRoot = `${projectRoot}/${nestedRelative}`;
    const markerBytes = encoder.encode('ordinary dependency marker');

    h.authority.mkdirSync(`${scratchRoot}/node_modules/pkg`, { recursive: true });
    h.authority.writeFileSync(`${scratchRoot}/node_modules/pkg/marker.txt`, markerBytes);
    h.authority.mkdirSync(`${nestedScratchRoot}/node_modules/dep`, { recursive: true });
    h.authority.writeFileSync(
      `${nestedScratchRoot}/package.json`,
      encoder.encode('{"name":"nested","dependencies":{"dep":"1.0.0"}}\n'),
    );
    h.authority.writeFileSync(
      `${nestedScratchRoot}/node_modules/dep/package.json`,
      encoder.encode('{"name":"dep","version":"1.0.0"}\n'),
    );
    await mintTrusted(h, scratchRoot, 'scratch', 1);
    await mintTrusted(h, nestedScratchRoot, 'nested', 1);

    await h.catalog.saveScratch({
      id: 'project-a',
      name: 'Project A',
      definition: definition('project-a'),
    });

    await expect(h.stamps.check({ root: projectRoot, slug: 'project-a' })).resolves.toMatchObject({
      status: 'trusted',
      stamp: {
        root: projectRoot,
        slug: 'project-a',
        packages: 1,
      },
    });
    await expect(h.stamps.check({ root: nestedProjectRoot, slug: 'nested' })).resolves.toEqual({
      status: 'absent',
    });
    expect(h.installStampClaims.read(nestedProjectRoot)).toBeNull();
    expect(h.authority.readFileBytesSync(`${projectRoot}/node_modules/pkg/marker.txt`)).toEqual(
      markerBytes,
    );
    expect(h.fs.existsSync('/.rifty/workbench/v1/projects/scratch')).toBe(false);
    await h.owner.close();
  });

  it.each(boundedExistingTreeMutationCases())(
    '$name keeps transaction metadata bounded for a large existing tree',
    async (testCase) => {
      const fs = new DurableOwnerFs();
      const h = await harness(fs);
      const root = await testCase.prepare(h);
      const existingPath = `${root}/large-existing.bin`;
      const existingBytes = new Uint8Array(512 * 1024).fill(0xcd);
      const claimBytes = encoder.encode(`${testCase.name} root-bound claim`);
      h.authority.writeFileSync(existingPath, existingBytes);
      h.installStampClaims.write(root, claimBytes, { mkdirTree: true });
      const setupFlush = await h.authority.flush();
      expect(setupFlush?.total ?? 0).toBe(0);
      expect(h.fs.readFileBytesSync(existingPath)).toEqual(existingBytes);
      expect(h.installStampClaims.read(root)).toEqual(claimBytes);

      fs.armPersistFailure(Number.MAX_SAFE_INTEGER, 'quota-report');
      const outcome = await testCase.mutate(h);
      fs.disarmPersistFailure();

      const transactionSizes = fs.durabilityBoundaries.flatMap((boundary) => {
        const bytes = boundary.durableState.files[CATALOG_TRANSACTION_FILE];
        return bytes === undefined ? [] : [bytes.byteLength];
      });
      expect(transactionSizes.length).toBeGreaterThan(0);
      expect(Math.max(...transactionSizes)).toBeLessThan(64 * 1024);
      expect(outcome).toEqual(testCase.expectedCatalog);
      expect(h.catalog.snapshot()).toBe(outcome);
      if (testCase.expectedFiles === null) {
        expect(h.fs.existsSync(root.slice(0, -'/tree'.length))).toBe(false);
      } else {
        expect(treeFiles(h.fs, root)).toEqual(testCase.expectedFiles);
      }
      expect(h.installStampClaims.read(root)).toBeNull();
      await h.owner.close();
    },
  );

  it.each(catalogMutationCases())(
    '$name survives every $fault persisted primitive, hard restart, retry, and second restart',
    async (testCase) => {
      const baselineFs = new DurableOwnerFs();
      const baseline = await harness(baselineFs);
      await testCase.prepare(baseline);
      expect(baselineFs.pendingPrimitiveCount).toBe(0);
      expect(baselineFs.liveSnapshot()).toEqual(baselineFs.durableSnapshot());
      const expectedPre = Object.freeze({
        catalog: baseline.catalog.snapshot(),
        tree: baselineFs.durableSnapshot(),
      });

      const canonicalPostFs = baselineFs.restartFromDurableState();
      const canonicalPost = await harness(canonicalPostFs);
      await testCase.mutate(canonicalPost);
      expect(canonicalPostFs.pendingPrimitiveCount).toBe(0);
      expect(canonicalPostFs.liveSnapshot()).toEqual(canonicalPostFs.durableSnapshot());
      const expectedPost = Object.freeze({
        catalog: canonicalPost.catalog.snapshot(),
        tree: canonicalPostFs.durableSnapshot(),
      });

      let exhausted = false;
      let rejectedFaults = 0;
      let recoveredCommittedFaults = 0;
      let sawInteriorPartialPersistence = false;
      let recoveredPreStates = 0;
      let recoveredPostStates = 0;
      let recoveredPreTree: ExactFsTree | undefined;
      let recoveredPostTree: ExactFsTree | undefined;
      const absorbRecovery = (recovery: CatalogRecoveryEvidence): void => {
        recoveredPreStates += recovery.pre;
        recoveredPostStates += recovery.post;
        recoveredPreTree ??= recovery.preRecoveredTree;
        recoveredPostTree ??= recovery.postRecoveredTree;
      };
      for (let failAt = 1; failAt <= 200; failAt += 1) {
        const fs = baselineFs.restartFromDurableState();
        const h = await harness(fs);
        const before = h.catalog.snapshot();
        expect(before).toEqual(expectedPre.catalog);
        expect(fs.liveSnapshot()).toEqual(expectedPre.tree);
        expect(fs.durableSnapshot()).toEqual(expectedPre.tree);
        const observed: PlaygroundCatalogSnapshot[] = [];
        const unsubscribe = h.catalog.subscribe((snapshot) => observed.push(snapshot));
        fs.armPersistFailure(failAt, testCase.fault);

        const outcome = await testCase.mutate(h).then(
          (catalog) => Object.freeze({ kind: 'resolved' as const, catalog }),
          (error: unknown) => Object.freeze({ kind: 'rejected' as const, error }),
        );
        fs.disarmPersistFailure();
        expect(fs.pendingPrimitiveCount).toBe(0);

        if (!fs.didInjectFailure) {
          expect(outcome.kind).toBe('resolved');
          expect(fs.persistPrimitiveCount).toBeLessThan(failAt);
          expectCatalogState(h, fs, expectedPost);
          expect(observed).toEqual([expectedPre.catalog, expectedPost.catalog]);
          absorbRecovery(
            await expectEveryCatalogCrashBoundary(
              testCase,
              fs.durabilityBoundaries,
              expectedPre,
              expectedPost,
            ),
          );
          await expectHardRestartState(fs, expectedPost);
          unsubscribe();
          exhausted = true;
          break;
        }

        const injectedIndex = fs.trace.findIndex((entry) => entry.outcome === 'injected-failure');
        expect(injectedIndex).toBeGreaterThanOrEqual(0);
        if (
          fs.trace.slice(0, injectedIndex).some((entry) => entry.outcome === 'success') &&
          fs.trace.slice(injectedIndex + 1).some((entry) => entry.outcome === 'success')
        ) {
          sawInteriorPartialPersistence = true;
        }

        if (outcome.kind === 'resolved') {
          const injectedBoundary = fs.durabilityBoundaries.find((boundary) =>
            boundary.trace.some((entry) => entry.outcome === 'injected-failure'),
          );
          expect(injectedBoundary).toBeDefined();
          expect(injectedBoundary?.durableState.files[CATALOG_FILE]).toEqual(
            expectedPost.tree.files[CATALOG_FILE],
          );
          recoveredCommittedFaults += 1;
          expectCatalogState(h, fs, expectedPost);
          expect(observed).toEqual([expectedPre.catalog, expectedPost.catalog]);
          absorbRecovery(
            await expectEveryCatalogCrashBoundary(
              testCase,
              fs.durabilityBoundaries,
              expectedPre,
              expectedPost,
            ),
          );
          await expectHardRestartState(fs, expectedPost);
          unsubscribe();
          continue;
        }

        const faultTrace = fs.trace
          .slice(Math.max(0, injectedIndex - 2), injectedIndex + 4)
          .map((entry) => ({
            ordinal: entry.ordinal,
            kind: entry.primitive.kind,
            path: entry.primitive.path,
            outcome: entry.outcome,
          }));
        expect(
          outcome.kind,
          `${testCase.name} resolved after injected ordinal ${String(failAt)}; trace=${JSON.stringify(faultTrace)}`,
        ).toBe('rejected');
        if (outcome.kind !== 'rejected') {
          unsubscribe();
          throw new Error(
            `${testCase.name} resolved after injected ${testCase.fault} ordinal ${String(failAt)}`,
          );
        }

        rejectedFaults += 1;
        expect(outcome.error).toBeInstanceOf(Error);
        expect(String(outcome.error)).toMatch(
          testCase.fault === 'permission-rejection' ? /permission/i : /persistence|quota/i,
        );
        expect(h.catalog.snapshot()).toBe(before);
        expect(observed).toEqual([before]);
        const faultBoundaries = fs.durabilityBoundaries;
        const finalFaultTree = fs.durableSnapshot();

        absorbRecovery(
          await expectEveryCatalogCrashBoundary(
            testCase,
            faultBoundaries,
            expectedPre,
            expectedPost,
          ),
        );

        await testCase.mutate(h);
        expectCatalogState(h, fs, expectedPost);
        expect(observed).toEqual([expectedPre.catalog, expectedPost.catalog]);
        await expectHardRestartState(fs, expectedPost);
        unsubscribe();

        const recoveredFs = createDurableOwnerFsFromTree(finalFaultTree);
        const recovered = await harness(recoveredFs);
        const recoveredState = classifyCatalogState(
          recovered,
          recoveredFs,
          expectedPre,
          expectedPost,
        );
        expect(recoveredState).not.toBe('neither');
        expect(recoveredFs.pendingPrimitiveCount).toBe(0);
        expect(recoveredFs.liveSnapshot()).toEqual(recoveredFs.durableSnapshot());

        if (recoveredState === 'pre') {
          recoveredPreStates += 1;
          recoveredPreTree ??= recoveredFs.durableSnapshot();
          await testCase.mutate(recovered);
        } else if (recoveredState === 'post') {
          recoveredPostStates += 1;
          recoveredPostTree ??= recoveredFs.durableSnapshot();
        }
        expectCatalogState(recovered, recoveredFs, expectedPost);
        await expectHardRestartState(recoveredFs, expectedPost);
      }

      expect(exhausted).toBe(true);
      expect(rejectedFaults).toBeGreaterThan(0);
      expect(recoveredCommittedFaults).toBeGreaterThan(0);
      expect(sawInteriorPartialPersistence).toBe(true);
      expect(recoveredPreStates).toBeGreaterThan(0);
      expect(recoveredPostStates).toBeGreaterThan(0);
      if (testCase.name.startsWith('saveScratch untrusted × ')) {
        if (recoveredPreTree === undefined || recoveredPostTree === undefined) {
          throw new Error('untrusted Save recovery did not expose both pointer outcomes');
        }
        await expectUntrustedSaveOfflineOpen(recoveredPreTree, 'scratch');
        await expectUntrustedSaveOfflineOpen(recoveredPostTree, 'project');
      }
    },
  );
});

interface CatalogMutationCase {
  readonly name: string;
  readonly fault: DurableOwnerFault;
  prepare(harness: CatalogHarness): Promise<void>;
  mutate(harness: CatalogHarness): Promise<PlaygroundCatalogSnapshot>;
}

interface ExactCatalogState {
  readonly catalog: PlaygroundCatalogSnapshot;
  readonly tree: ExactFsTree;
}

interface BoundedExistingTreeMutationCase {
  readonly name: string;
  prepare(harness: CatalogHarness): Promise<string>;
  mutate(harness: CatalogHarness): Promise<PlaygroundCatalogSnapshot>;
  readonly expectedCatalog: PlaygroundCatalogSnapshot;
  readonly expectedFiles: Readonly<Record<string, readonly number[]>> | null;
}

function boundedExistingTreeMutationCases(): readonly BoundedExistingTreeMutationCase[] {
  const replacement = 'replacement baseline\n';
  const replacementFiles = Object.freeze({
    '/package.json': Object.freeze([...encoder.encode('{"devDependencies":{"vite":"8.0.0"}}\n')]),
    '/replacement.txt': Object.freeze([...encoder.encode(replacement)]),
  });
  const projectRoot = '/.rifty/workbench/v1/projects/project-a/tree';
  const prepareProject = async (h: CatalogHarness): Promise<string> => {
    await h.catalog.createScratch({ definition: definition('scratch') });
    await h.catalog.saveScratch({
      id: 'project-a',
      name: 'Project A',
      definition: definition('project-a'),
    });
    return projectRoot;
  };
  const projectB = () =>
    definition('project-a', 'starter-b', {
      files: { '/replacement.txt': replacement },
    });

  return Object.freeze([
    Object.freeze({
      name: 'createScratch reseed',
      prepare: async (h: CatalogHarness) => {
        await h.catalog.createScratch({ definition: definition('scratch') });
        return '/.rifty/workbench/v1/projects/scratch/tree';
      },
      mutate: (h: CatalogHarness) =>
        h.catalog.createScratch({
          definition: definition('scratch', 'starter-b', {
            files: { '/replacement.txt': replacement },
          }),
        }),
      expectedCatalog: freezeExpected<PlaygroundCatalogSnapshot>({
        active: { kind: 'scratch' },
        scratch: { starterId: 'starter-b', dirty: false, editedAt: EDITED_AT },
        projects: [],
      }),
      expectedFiles: replacementFiles,
    }),
    Object.freeze({
      name: 'reset',
      prepare: prepareProject,
      mutate: (h: CatalogHarness) =>
        h.catalog.reset({
          target: { kind: 'project', id: 'project-a' },
          definition: projectB(),
        }),
      expectedCatalog: freezeExpected<PlaygroundCatalogSnapshot>({
        active: { kind: 'project', id: 'project-a' },
        scratch: null,
        projects: [
          {
            id: 'project-a',
            name: 'Project A',
            starterId: 'starter-b',
            editedAt: EDITED_AT,
          },
        ],
      }),
      expectedFiles: replacementFiles,
    }),
    Object.freeze({
      name: 'delete',
      prepare: prepareProject,
      mutate: (h: CatalogHarness) => h.catalog.delete('project-a'),
      expectedCatalog: EMPTY,
      expectedFiles: null,
    }),
  ]);
}

function catalogMutationCases(): readonly CatalogMutationCase[] {
  const operations = Object.freeze([
    {
      name: 'createScratch',
      prepare: async (_h: CatalogHarness) => {},
      mutate: (h: CatalogHarness) => h.catalog.createScratch({ definition: definition('scratch') }),
    },
    {
      name: 'saveScratch untrusted',
      prepare: async (h: CatalogHarness) => {
        await h.catalog.createScratch({ definition: definition('scratch') });
        const scratchRoot = '/.rifty/workbench/v1/projects/scratch/tree';
        const dependency = `${scratchRoot}/node_modules/pkg/index.js`;
        const privateMetadata = `${scratchRoot}/.rifty/session.json`;
        h.authority.mkdirSync(dependency.slice(0, dependency.lastIndexOf('/')), {
          recursive: true,
        });
        h.authority.writeFileSync(dependency, encoder.encode('ordinary dependency bytes'));
        h.authority.mkdirSync(privateMetadata.slice(0, privateMetadata.lastIndexOf('/')), {
          recursive: true,
        });
        h.authority.writeFileSync(privateMetadata, encoder.encode('private tree metadata'));
        h.installStampClaims.write(scratchRoot, encoder.encode('root-bound claim'), {
          mkdirTree: true,
        });
        const setupFlush = await h.authority.flush();
        expect(setupFlush?.total ?? 0).toBe(0);
      },
      mutate: async (h: CatalogHarness) => {
        const result = await h.catalog.saveScratch({
          id: 'project-a',
          name: 'Project A',
          definition: definition('project-a'),
        });
        const projectRoot = '/.rifty/workbench/v1/projects/project-a/tree';
        await expect(h.stamps.check({ root: projectRoot, slug: 'project-a' })).resolves.toEqual({
          status: 'absent',
        });
        if (h.fs instanceof DurableOwnerFs) {
          expect(
            h.fs.trace.filter((entry) => entry.primitive.path === installStampPath(projectRoot)),
          ).toEqual([]);
        }
        return result;
      },
    },
    {
      name: 'saveScratch trusted',
      prepare: async (h: CatalogHarness) => {
        await h.catalog.createScratch({ definition: definition('scratch') });
        const scratchRoot = '/.rifty/workbench/v1/projects/scratch/tree';
        const dependency = `${scratchRoot}/node_modules/pkg/index.js`;
        const nestedRoot = `${scratchRoot}/node_modules/pkg/examples/nested`;
        h.authority.mkdirSync(dependency.slice(0, dependency.lastIndexOf('/')), {
          recursive: true,
        });
        h.authority.writeFileSync(dependency, encoder.encode('ordinary dependency bytes'));
        h.authority.mkdirSync(`${nestedRoot}/node_modules/nested-dep`, { recursive: true });
        h.authority.writeFileSync(
          `${nestedRoot}/package.json`,
          encoder.encode('{"name":"nested","dependencies":{"nested-dep":"1.0.0"}}\n'),
        );
        h.authority.writeFileSync(
          `${nestedRoot}/node_modules/nested-dep/package.json`,
          encoder.encode('{"name":"nested-dep","version":"1.0.0"}\n'),
        );
        await mintTrusted(h, scratchRoot, 'scratch', 1);
        await mintTrusted(h, nestedRoot, 'nested', 1);
      },
      mutate: async (h: CatalogHarness) => {
        const result = await h.catalog.saveScratch({
          id: 'project-a',
          name: 'Project A',
          definition: definition('project-a'),
        });
        const projectRoot = '/.rifty/workbench/v1/projects/project-a/tree';
        await expect(
          h.stamps.check({ root: projectRoot, slug: 'project-a' }),
        ).resolves.toMatchObject({
          status: 'trusted',
          stamp: { root: projectRoot, slug: 'project-a', packages: 1 },
        });
        await expect(
          h.stamps.check({
            root: `${projectRoot}/node_modules/pkg/examples/nested`,
            slug: 'nested',
          }),
        ).resolves.toEqual({ status: 'absent' });
        return result;
      },
    },
    {
      name: 'activate',
      prepare: async (h: CatalogHarness) => {
        await h.catalog.createScratch({ definition: definition('scratch') });
        await h.catalog.saveScratch({
          id: 'project-a',
          name: 'Project A',
          definition: definition('project-a'),
        });
        await h.catalog.createScratch({ definition: definition('scratch') });
      },
      mutate: (h: CatalogHarness) => h.catalog.activate({ kind: 'project', id: 'project-a' }),
    },
    {
      name: 'rename',
      prepare: async (h: CatalogHarness) => {
        await h.catalog.createScratch({ definition: definition('scratch') });
        await h.catalog.saveScratch({
          id: 'project-a',
          name: 'Project A',
          definition: definition('project-a'),
        });
      },
      mutate: (h: CatalogHarness) => h.catalog.rename('project-a', 'Renamed'),
    },
    {
      name: 'reset',
      prepare: async (h: CatalogHarness) => {
        await h.catalog.createScratch({ definition: definition('scratch') });
        await h.catalog.saveScratch({
          id: 'project-a',
          name: 'Project A',
          definition: definition('project-a'),
        });
      },
      mutate: (h: CatalogHarness) =>
        h.catalog.reset({
          target: { kind: 'project', id: 'project-a' },
          definition: definition('project-a', 'starter-b', {
            files: { '/reset.txt': 'new baseline' },
          }),
        }),
    },
    {
      name: 'delete',
      prepare: async (h: CatalogHarness) => {
        await h.catalog.createScratch({ definition: definition('scratch') });
        await h.catalog.saveScratch({
          id: 'project-a',
          name: 'Project A',
          definition: definition('project-a'),
        });
      },
      mutate: (h: CatalogHarness) => h.catalog.delete('project-a'),
    },
  ] as const);

  return Object.freeze(
    operations.flatMap((operation) =>
      (['quota-report', 'permission-rejection'] as const).map((fault) =>
        Object.freeze({ ...operation, name: `${operation.name} × ${fault}`, fault }),
      ),
    ),
  );
}

function exactTreesEqual(left: ExactFsTree, right: ExactFsTree): boolean {
  if (left.directories.length !== right.directories.length) return false;
  if (left.directories.some((directory, index) => directory !== right.directories[index])) {
    return false;
  }
  const leftPaths = Object.keys(left.files);
  const rightPaths = Object.keys(right.files);
  if (leftPaths.length !== rightPaths.length) return false;
  for (let index = 0; index < leftPaths.length; index += 1) {
    const leftPath = leftPaths[index];
    const rightPath = rightPaths[index];
    if (leftPath === undefined || rightPath === undefined || leftPath !== rightPath) return false;
    const leftBytes = left.files[leftPath];
    const rightBytes = right.files[rightPath];
    if (leftBytes === undefined || rightBytes === undefined) return false;
    if (leftBytes.length !== rightBytes.length) return false;
    if (leftBytes.some((byte, byteIndex) => byte !== rightBytes[byteIndex])) return false;
  }
  return true;
}

function catalogSnapshotsEqual(
  left: PlaygroundCatalogSnapshot,
  right: PlaygroundCatalogSnapshot,
): boolean {
  const activeEqual =
    left.active === right.active ||
    (left.active !== null &&
      right.active !== null &&
      left.active.kind === right.active.kind &&
      (left.active.kind === 'scratch' ||
        (right.active.kind === 'project' && left.active.id === right.active.id)));
  const scratchEqual =
    left.scratch === right.scratch ||
    (left.scratch !== null &&
      right.scratch !== null &&
      left.scratch.starterId === right.scratch.starterId &&
      left.scratch.dirty === right.scratch.dirty &&
      left.scratch.editedAt === right.scratch.editedAt);
  return (
    activeEqual &&
    scratchEqual &&
    left.projects.length === right.projects.length &&
    left.projects.every((project, index) => {
      const candidate = right.projects[index];
      return (
        candidate !== undefined &&
        project.id === candidate.id &&
        project.name === candidate.name &&
        project.starterId === candidate.starterId &&
        project.editedAt === candidate.editedAt
      );
    })
  );
}

function classifyCatalogState(
  h: CatalogHarness,
  fs: DurableOwnerFs,
  expectedPre: ExactCatalogState,
  expectedPost: ExactCatalogState,
): 'pre' | 'post' | 'neither' {
  const snapshot = h.catalog.snapshot();
  const tree = fs.durableSnapshot();
  if (
    catalogSnapshotsEqual(snapshot, expectedPre.catalog) &&
    exactTreesEqual(tree, expectedPre.tree)
  ) {
    return 'pre';
  }
  if (
    catalogSnapshotsEqual(snapshot, expectedPost.catalog) &&
    exactTreesEqual(tree, expectedPost.tree)
  ) {
    return 'post';
  }
  return 'neither';
}

function expectCatalogState(
  h: CatalogHarness,
  fs: DurableOwnerFs,
  expected: ExactCatalogState,
): void {
  expect(h.catalog.snapshot()).toEqual(expected.catalog);
  expect(fs.liveSnapshot()).toEqual(expected.tree);
  expect(fs.durableSnapshot()).toEqual(expected.tree);
  expect(fs.pendingPrimitiveCount).toBe(0);
}

async function expectHardRestartState(
  fs: DurableOwnerFs,
  expected: ExactCatalogState,
): Promise<void> {
  const restartedFs = fs.restartFromDurableState();
  const restarted = await harness(restartedFs);
  expectCatalogState(restarted, restartedFs, expected);
}

interface CatalogRecoveryEvidence {
  readonly pre: number;
  readonly post: number;
  readonly preRecoveredTree?: ExactFsTree;
  readonly postRecoveredTree?: ExactFsTree;
}

async function expectEveryCatalogCrashBoundary(
  testCase: CatalogMutationCase,
  boundaries: readonly { readonly durableState: ExactFsTree }[],
  expectedPre: ExactCatalogState,
  expectedPost: ExactCatalogState,
): Promise<CatalogRecoveryEvidence> {
  expect(boundaries.length).toBeGreaterThan(0);
  let pre = 0;
  let post = 0;
  let preRecoveredTree: ExactFsTree | undefined;
  let postRecoveredTree: ExactFsTree | undefined;
  for (const boundary of boundaries) {
    const recoveredFs = createDurableOwnerFsFromTree(boundary.durableState);
    const recovered = await harness(recoveredFs);
    const state = classifyCatalogState(recovered, recoveredFs, expectedPre, expectedPost);
    expect(state).not.toBe('neither');
    expect(recoveredFs.pendingPrimitiveCount).toBe(0);
    expect(recoveredFs.liveSnapshot()).toEqual(recoveredFs.durableSnapshot());
    if (state === 'pre') {
      pre += 1;
      preRecoveredTree ??= recoveredFs.durableSnapshot();
      await testCase.mutate(recovered);
    } else if (state === 'post') {
      post += 1;
      postRecoveredTree ??= recoveredFs.durableSnapshot();
    }
    expectCatalogState(recovered, recoveredFs, expectedPost);
    await expectHardRestartState(recoveredFs, expectedPost);
  }
  return Object.freeze({
    pre,
    post,
    ...(preRecoveredTree === undefined ? {} : { preRecoveredTree }),
    ...(postRecoveredTree === undefined ? {} : { postRecoveredTree }),
  });
}
