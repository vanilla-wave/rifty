import type { FsSync } from '@riftydev/vfs';
import { MemoryFsSync, createMemoryFs } from '@riftydev/vfs/internal';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { ProjectDefinitionMismatchError } from '../workbench/errors.ts';
import { capturePlaygroundLegacyWorkspacePrefix } from '../workbench/internal/playground-boot-config.ts';
import { createPlaygroundProjectCatalog } from '../workbench/internal/playground-project-catalog.ts';
import { definePlaygroundProject } from '../workbench/internal/playground-project-definition.ts';
import {
  type WorkbenchOwnerBootConfig,
  inspectPageToWorkbenchOwnerMessage,
} from '../workbench/owner-protocol.ts';
import type {
  PlaygroundCatalogSnapshot,
  PlaygroundProjectCatalog,
  VitePlaygroundPlan,
} from '../workbench/playground.ts';
import type { ProjectDefinition } from '../workbench/public.ts';
import { createOwnerVfsAuthorityComposition } from './owner-vfs-authority.ts';
import {
  type PlaygroundProjectAuthority,
  createPlaygroundProjectAuthority,
} from './playground-project-authority.ts';
import {
  DurableOwnerFs,
  type DurableOwnerMutation,
  type DurablePersistBoundary,
  type ExactFsTree,
  createDurableOwnerFsFromTree,
  restoreExactFsTree,
  snapshotExactFsTree,
} from './test-fixtures/durable-owner-fs.ts';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const LEGACY_PREFIX = '/workspaces/legacy_workspace';
const LEGACY_INDEX = `${LEGACY_PREFIX}/.rifty-project-index.json`;
const WORKBENCH_PLAYGROUND_ROOT = '/.rifty/workbench/playground';
const WORKBENCH_CATALOG = `${WORKBENCH_PLAYGROUND_ROOT}/catalog.json`;
const LEGACY_MIGRATION_JOURNAL = `${WORKBENCH_PLAYGROUND_ROOT}/migration-journal.json`;
const WORKBENCH_PROJECTS_ROOT = '/.rifty/workbench/v1/projects';
const WORKBENCH_STAGES_ROOT = '/.rifty/workbench/v1/stages';
const MAX_CRASH_MUTATIONS = 128;
const MAX_PERSIST_MUTATIONS = 256;
const EDITED_AT = '2026-07-15T09:30:00.000Z';
const CAPTURED_URL_CONTEXT = Object.freeze({
  apiBaseUrl: 'https://playground.invalid/app/',
  clientUrl: 'https://playground.invalid/app/index.html',
});
let ownerSequence = 0;

interface LegacyProject {
  readonly id: string;
  readonly name: string;
  readonly starter: string;
  readonly editedAt: string;
}

interface LegacyScratch {
  readonly starter: string;
  readonly dirty: boolean;
  readonly editedAt: string;
}

interface LegacyIndex {
  readonly activeId: 'scratch' | string;
  readonly scratch: LegacyScratch | null;
  readonly projects: readonly LegacyProject[];
}

interface MigrationHarness {
  readonly fs: MemoryFsSync;
  readonly owner: PlaygroundProjectAuthority;
  readonly catalog: PlaygroundProjectCatalog;
}

type OpenedMigrationProject = Awaited<ReturnType<MigrationHarness['owner']['openProject']>>;

const DURABILITY_FAULTS = [
  {
    name: 'unhealed quota PersistFailureReport',
    kind: 'quota-report' as const,
    message: /unhealed|persistence|quota/i,
  },
  {
    name: 'rejected permission barrier',
    kind: 'permission-rejection' as const,
    message: /permission/i,
  },
] as const;

type LegacyDurabilityPhase =
  | 'copy-intent'
  | 'copy'
  | 'promote-intent'
  | 'promote'
  | 'mark-intent'
  | 'source-cleanup-intent'
  | 'source-cleanup'
  | 'adopted'
  | 'tombstone';

/** Durable v1 oracle: exact keys and next-action phases make restart ordering inspectable. */
type LegacyMigrationJournalPhase =
  | { readonly kind: 'pending' }
  | {
      readonly kind: 'copy' | 'promote' | 'mark' | 'source-cleanup';
      readonly stageId: string;
      readonly definitionIdentity: string;
      readonly baselineFingerprint: string;
    }
  | {
      readonly kind: 'adopted';
      readonly definitionIdentity: string;
      readonly baselineFingerprint: string;
    };

interface LegacyMigrationJournalRefV1 {
  readonly kind: 'scratch' | 'project';
  readonly id: string;
  readonly starterId: string;
  readonly sourceRoot: string;
  readonly phase: LegacyMigrationJournalPhase;
}

interface LegacyMigrationJournalV1 {
  readonly version: 1;
  readonly legacyWorkspacePrefix: string;
  readonly refs: readonly LegacyMigrationJournalRefV1[];
}

type LegacyRefId = 'scratch' | 'project-a' | 'project-b';

type StoredCatalogAdoption =
  | { readonly kind: 'pending-adoption'; readonly sourceRoot: string }
  | {
      readonly kind: 'adopted';
      readonly definitionIdentity: string;
      readonly baselineFingerprint: string;
    };

interface StoredCatalogScratchV1 {
  readonly starterId: string;
  readonly dirty: boolean;
  readonly editedAt: string;
  readonly adoption: StoredCatalogAdoption;
}

interface StoredCatalogProjectV1 {
  readonly id: 'project-a' | 'project-b';
  readonly name: string;
  readonly starterId: string;
  readonly editedAt: string;
  readonly adoption: StoredCatalogAdoption;
}

interface StoredPlaygroundCatalogV1 {
  readonly version: 1;
  readonly active: { readonly kind: 'scratch' } | { readonly kind: 'project'; readonly id: string };
  readonly scratch: StoredCatalogScratchV1;
  readonly projects: readonly StoredCatalogProjectV1[];
}

interface BaselineMismatchCase {
  readonly name: string;
  readonly overrides: Partial<VitePlaygroundPlan>;
}

interface JournalCorruptionCase {
  readonly name: string;
  readonly corrupt: (fs: FsSync, journal: LegacyMigrationJournalV1) => void;
}

interface LegacyIndexCorruptionCase {
  readonly name: string;
  readonly corrupt: (fs: FsSync) => void;
}

function withoutKey(value: object, key: string): Readonly<Record<string, unknown>> {
  const copy: Record<string, unknown> = { ...value };
  delete copy[key];
  return copy;
}

function write(fs: FsSync, path: string, bytes: string | Uint8Array): void {
  const separator = path.lastIndexOf('/');
  fs.mkdirSync(path.slice(0, separator) || '/', { recursive: true });
  fs.writeFileSync(path, typeof bytes === 'string' ? encoder.encode(bytes) : bytes);
}

function legacyRoot(id: 'scratch' | string): string {
  return id === 'scratch' ? `${LEGACY_PREFIX}/scratch` : `${LEGACY_PREFIX}/projects/${id}`;
}

function writeLegacyIndex(fs: FsSync, index: LegacyIndex | unknown): void {
  write(fs, LEGACY_INDEX, `${JSON.stringify(index, null, 2)}\n`);
}

function exactLegacyIndex(): LegacyIndex {
  return {
    activeId: 'project-a',
    scratch: { starter: 'starter-scratch', dirty: true, editedAt: '2026-07-01T01:00:00Z' },
    projects: [
      {
        id: 'project-a',
        name: 'Project A',
        starter: 'starter-a',
        editedAt: '2026-07-02T02:00:00Z',
      },
      {
        id: 'project-b',
        name: 'Project B',
        starter: 'starter-b',
        editedAt: '2026-07-03T03:00:00Z',
      },
    ],
  };
}

function seedLegacy(fs: FsSync): void {
  writeLegacyIndex(fs, exactLegacyIndex());
  write(fs, `${legacyRoot('scratch')}/scratch.txt`, 'scratch ordinary bytes');
  write(fs, `${legacyRoot('scratch')}/.git/index`, new Uint8Array([0, 255, 1, 128]));
  write(fs, `${legacyRoot('project-a')}/src/main.ts`, 'legacy project a');
  write(fs, `${legacyRoot('project-a')}/.git/objects/aa/bb`, new Uint8Array([222, 173, 0, 190]));
  write(fs, `${legacyRoot('project-a')}/node_modules/pkg/index.js`, 'derived top-level');
  write(fs, `${legacyRoot('project-a')}/node_modules/.rifty-install-stamp.json`, 'top-level claim');
  write(fs, `${legacyRoot('project-a')}/packages/app/node_modules/pkg/index.js`, 'derived nested');
  write(
    fs,
    `${legacyRoot('project-a')}/packages/app/node_modules/.rifty-install-stamp.json`,
    'nested claim',
  );
  write(fs, `${legacyRoot('project-a')}/.rifty/install/claim.json`, 'private authority');
  write(fs, `${legacyRoot('project-b')}/src/main.ts`, 'legacy project b');
  write(fs, `${legacyRoot('project-b')}/.git/HEAD`, 'ref: refs/heads/main\n');
}

function companionSnapshot(): PlaygroundCatalogSnapshot {
  return {
    active: { kind: 'project', id: 'project-a' },
    scratch: {
      starterId: 'starter-scratch',
      dirty: true,
      editedAt: '2026-07-01T01:00:00Z',
    },
    projects: [
      {
        id: 'project-a',
        name: 'Project A',
        starterId: 'starter-a',
        editedAt: '2026-07-02T02:00:00Z',
      },
      {
        id: 'project-b',
        name: 'Project B',
        starterId: 'starter-b',
        editedAt: '2026-07-03T03:00:00Z',
      },
    ],
  };
}

function plan(
  id: string,
  starterId: string,
  overrides: Partial<VitePlaygroundPlan> = {},
): VitePlaygroundPlan {
  return {
    kind: 'vite',
    templateId: 'vite-template-v1',
    files: {
      '/index.html': '<main>definition baseline, not migrated user tree</main>\n',
      '/package.json': '{"devDependencies":{"vite":"8.0.0"}}\n',
    },
    devDependencies: { vite: '8.0.0' },
    port: 5173,
    firstMaterialization: { kind: 'install' },
    ...overrides,
    id,
    starterId,
  };
}

function definition(
  id: string,
  starterId: string,
  overrides: Partial<VitePlaygroundPlan> = {},
): ProjectDefinition<unknown> {
  return definePlaygroundProject(plan(id, starterId, overrides), CAPTURED_URL_CONTEXT);
}

async function openAuthority(
  fs: MemoryFsSync,
  options: {
    readonly legacyWorkspacePrefix?: string;
    readonly persistence?: 'required' | 'ephemeral';
  } = {},
): Promise<MigrationHarness> {
  const composition = createOwnerVfsAuthorityComposition(fs, {
    ownerEpoch: `legacy-migration-${String(++ownerSequence)}`,
    initialRoots: ['/', '/.rifty'],
  });
  let stageSequence = 0;
  const owner = await createPlaygroundProjectAuthority({
    ...composition,
    persistence: options.persistence ?? 'required',
    ...(options.legacyWorkspacePrefix === undefined
      ? {}
      : { legacyWorkspacePrefix: options.legacyWorkspacePrefix }),
    now: () => EDITED_AT,
    createStageId: () => `migration-stage-${String(++stageSequence)}`,
    acquisition: Object.freeze({
      ensure: async () => Object.freeze({ kind: 'install' as const, snapshotFailures: [] }),
    }),
  });
  return { fs, owner, catalog: createPlaygroundProjectCatalog(owner) };
}

function snapshotTree(fs: FsSync, root: string): Readonly<Record<string, readonly number[]>> {
  const result: Record<string, readonly number[]> = {};
  const walk = (directory: string): void => {
    for (const entry of fs.readdirSync(directory)) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory) walk(path);
      else result[path.slice(root.length)] = [...fs.readFileBytesSync(path)];
    }
  };
  walk(root);
  return Object.fromEntries(
    Object.entries(result).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
  );
}

function pendingJournal(): LegacyMigrationJournalV1 {
  return {
    version: 1,
    legacyWorkspacePrefix: LEGACY_PREFIX,
    refs: [
      {
        kind: 'scratch',
        id: 'scratch',
        starterId: 'starter-scratch',
        sourceRoot: legacyRoot('scratch'),
        phase: { kind: 'pending' },
      },
      {
        kind: 'project',
        id: 'project-a',
        starterId: 'starter-a',
        sourceRoot: legacyRoot('project-a'),
        phase: { kind: 'pending' },
      },
      {
        kind: 'project',
        id: 'project-b',
        starterId: 'starter-b',
        sourceRoot: legacyRoot('project-b'),
        phase: { kind: 'pending' },
      },
    ],
  };
}

function writeMigrationJournal(fs: FsSync, value: unknown): void {
  write(fs, LEGACY_MIGRATION_JOURNAL, `${JSON.stringify(value, null, 2)}\n`);
}

function pendingStoredCatalog(): StoredPlaygroundCatalogV1 {
  return {
    version: 1,
    active: { kind: 'project', id: 'project-a' },
    scratch: {
      starterId: 'starter-scratch',
      dirty: true,
      editedAt: '2026-07-01T01:00:00Z',
      adoption: { kind: 'pending-adoption', sourceRoot: legacyRoot('scratch') },
    },
    projects: [
      {
        id: 'project-a',
        name: 'Project A',
        starterId: 'starter-a',
        editedAt: '2026-07-02T02:00:00Z',
        adoption: { kind: 'pending-adoption', sourceRoot: legacyRoot('project-a') },
      },
      {
        id: 'project-b',
        name: 'Project B',
        starterId: 'starter-b',
        editedAt: '2026-07-03T03:00:00Z',
        adoption: { kind: 'pending-adoption', sourceRoot: legacyRoot('project-b') },
      },
    ],
  };
}

function withStoredAdoption(
  catalog: StoredPlaygroundCatalogV1,
  id: LegacyRefId,
  adoption: StoredCatalogAdoption,
): StoredPlaygroundCatalogV1 {
  if (id === 'scratch') return { ...catalog, scratch: { ...catalog.scratch, adoption } };
  return {
    ...catalog,
    projects: catalog.projects.map((project) =>
      project.id === id ? { ...project, adoption } : project,
    ),
  };
}

function writeStoredCatalogValue(fs: FsSync, catalog: unknown): void {
  write(fs, WORKBENCH_CATALOG, `${JSON.stringify(catalog, null, 2)}\n`);
}

function writeStoredCatalog(fs: FsSync, catalog: StoredPlaygroundCatalogV1): void {
  writeStoredCatalogValue(fs, catalog);
}

function readStoredCatalog(fs: FsSync): StoredPlaygroundCatalogV1 {
  return JSON.parse(
    decoder.decode(fs.readFileBytesSync(WORKBENCH_CATALOG)),
  ) as StoredPlaygroundCatalogV1;
}

function rewriteStoredAdoption(
  fs: FsSync,
  id: LegacyRefId,
  rewrite: (adoption: Readonly<Record<string, unknown>>) => unknown,
): void {
  const catalog = readStoredCatalog(fs);
  if (id === 'scratch') {
    writeStoredCatalogValue(fs, {
      ...catalog,
      scratch: {
        ...catalog.scratch,
        adoption: rewrite({ ...catalog.scratch.adoption }),
      },
    });
    return;
  }
  writeStoredCatalogValue(fs, {
    ...catalog,
    projects: catalog.projects.map((project) =>
      project.id === id ? { ...project, adoption: rewrite({ ...project.adoption }) } : project,
    ),
  });
}

function catalogFromTree(tree: ExactFsTree): StoredPlaygroundCatalogV1 | null {
  const bytes = tree.files[WORKBENCH_CATALOG];
  return bytes === undefined
    ? null
    : (JSON.parse(decoder.decode(bytes)) as StoredPlaygroundCatalogV1);
}

function storedAdoption(
  catalog: StoredPlaygroundCatalogV1,
  id: LegacyRefId,
): StoredCatalogAdoption {
  if (id === 'scratch') return catalog.scratch.adoption;
  const project = catalog.projects.find((candidate) => candidate.id === id);
  if (project === undefined) throw new Error(`missing stored catalog ref: ${id}`);
  return project.adoption;
}

function allStoredRefsAdopted(catalog: StoredPlaygroundCatalogV1): boolean {
  return (
    catalog.scratch.adoption.kind === 'adopted' &&
    catalog.projects.every((project) => project.adoption.kind === 'adopted')
  );
}

function legacyIndexBytes(fs: FsSync): Uint8Array {
  return fs.readFileBytesSync(LEGACY_INDEX).slice();
}

function expectLegacyIndexBytes(
  fs: FsSync,
  expected: Uint8Array,
  state: 'present' | 'tombstoned',
): void {
  expect(fs.existsSync(LEGACY_INDEX)).toBe(state === 'present');
  if (state === 'present') expect(fs.readFileBytesSync(LEGACY_INDEX)).toEqual(expected);
}

function expectNoPendingPrimitives(fs: DurableOwnerFs): void {
  expect(
    fs.pendingPrimitiveCount,
    'operation resolved with unflushed durable-owner primitives',
  ).toBe(0);
}

async function proveCatalogBoundaryRestarts(
  boundaries: readonly DurablePersistBoundary[],
  legacyBefore: Readonly<Record<string, readonly number[]>>,
  indexBefore: Uint8Array,
): Promise<void> {
  expect(
    boundaries.length,
    'catalog fault sweep must record durability boundaries',
  ).toBeGreaterThan(0);
  for (const [index, boundary] of boundaries.entries()) {
    const fs = createDurableOwnerFsFromTree(boundary.durableState);
    const reopened = await openAuthority(fs, { legacyWorkspacePrefix: LEGACY_PREFIX });
    expect(reopened.catalog.snapshot(), `catalog boundary ${String(index)}`).toEqual(
      companionSnapshot(),
    );
    expectAllLegacySourcesExact(fs, legacyBefore);
    expectLegacyIndexBytes(fs, indexBefore, 'present');
    for (const id of ['scratch', 'project-a', 'project-b'] as const) {
      expect(fs.existsSync(workbenchProjectContainer(id))).toBe(false);
      expectNoUnpromotedStage(fs, id);
    }
    await reopened.owner.close();
    expectNoPendingPrimitives(fs);
  }
}

async function proveAdoptionBoundaryRestarts(
  boundaries: readonly DurablePersistBoundary[],
  id: 'project-a' | 'project-b',
  starterId: string,
  expectedCatalog: PlaygroundCatalogSnapshot,
  indexBefore: Uint8Array,
  includesTombstone: boolean,
  unrelatedSourcesBefore: Readonly<Record<string, Readonly<Record<string, readonly number[]>>>>,
): Promise<void> {
  expect(
    boundaries.length,
    'adoption fault sweep must record durability boundaries',
  ).toBeGreaterThan(0);
  for (const [index, boundary] of boundaries.entries()) {
    const fs = createDurableOwnerFsFromTree(boundary.durableState);
    const reopened = await openAuthority(fs, { legacyWorkspacePrefix: LEGACY_PREFIX });
    expect(reopened.catalog.snapshot(), `adoption boundary ${String(index)}`).toEqual(
      expectedCatalog,
    );
    const root = await adopt(reopened, id, starterId);
    expect(snapshotTree(fs, root)).toEqual(expectedAdoptedTree(id));
    expect(fs.existsSync(legacyRoot(id))).toBe(false);
    expectLegacyIndexBytes(fs, indexBefore, includesTombstone ? 'tombstoned' : 'present');
    expectLegacySourcesExact(fs, unrelatedSourcesBefore);
    expectNoUnpromotedStage(fs, id);
    await reopened.owner.close();
    expectNoPendingPrimitives(fs);
  }
}

function seedPromotedProjectFixture(fs: FsSync, id: 'project-a', definitionIdentity: string): void {
  const container = workbenchProjectContainer(id);
  for (const [path, bytes] of Object.entries(expectedAdoptedTree(id))) {
    write(fs, `${container}/tree${path}`, new Uint8Array(bytes));
  }
  write(
    fs,
    `${container}/definition.json`,
    `${JSON.stringify({ version: 1, projectKey: id, definitionIdentity })}\n`,
  );
}

const JOURNAL_PROOF = Object.freeze({
  stageId: 'migration-stage-fixture',
  definitionIdentity: 'definition:project-a:starter-a',
  baselineFingerprint: 'baseline:starter-a',
});

const JOURNAL_PHASES = ['pending', 'copy', 'promote', 'mark', 'source-cleanup', 'adopted'] as const;

type JournalPhaseKind = (typeof JOURNAL_PHASES)[number];

function stageContainer(id: 'project-a', stageId = JOURNAL_PROOF.stageId): string {
  return `${WORKBENCH_STAGES_ROOT}/${id}/${stageId}`;
}

function seedCompleteStageFixture(fs: FsSync): void {
  const treeRoot = `${stageContainer('project-a')}/tree`;
  for (const [path, bytes] of Object.entries(expectedAdoptedTree('project-a'))) {
    write(fs, `${treeRoot}${path}`, new Uint8Array(bytes));
  }
}

function journalPhase(kind: JournalPhaseKind): LegacyMigrationJournalPhase {
  if (kind === 'pending') return { kind };
  if (kind === 'adopted') {
    return {
      kind,
      definitionIdentity: JOURNAL_PROOF.definitionIdentity,
      baselineFingerprint: JOURNAL_PROOF.baselineFingerprint,
    };
  }
  return { kind, ...JOURNAL_PROOF };
}

function seedValidJournalPhase(fs: FsSync, phase: JournalPhaseKind): void {
  seedLegacy(fs);
  const adoption: StoredCatalogAdoption =
    phase === 'source-cleanup' || phase === 'adopted'
      ? {
          kind: 'adopted',
          definitionIdentity: JOURNAL_PROOF.definitionIdentity,
          baselineFingerprint: JOURNAL_PROOF.baselineFingerprint,
        }
      : { kind: 'pending-adoption', sourceRoot: legacyRoot('project-a') };
  writeStoredCatalog(fs, withStoredAdoption(pendingStoredCatalog(), 'project-a', adoption));
  const journal = pendingJournal();
  writeMigrationJournal(fs, {
    ...journal,
    refs: journal.refs.map((ref) =>
      ref.id === 'project-a' ? { ...ref, phase: journalPhase(phase) } : ref,
    ),
  });

  if (phase === 'copy') {
    fs.mkdirSync(`${stageContainer('project-a')}/tree`, { recursive: true });
  } else if (phase === 'promote') {
    seedCompleteStageFixture(fs);
  } else if (phase === 'mark' || phase === 'source-cleanup' || phase === 'adopted') {
    seedPromotedProjectFixture(fs, 'project-a', JOURNAL_PROOF.definitionIdentity);
  }
  if (phase === 'adopted') {
    fs.rmSync(legacyRoot('project-a'), { recursive: true, force: true });
  }
}

function rewriteJournalRef(
  fs: FsSync,
  id: LegacyRefId,
  rewrite: (ref: LegacyMigrationJournalRefV1) => unknown,
): void {
  const journal = readMigrationJournal(fs);
  writeMigrationJournal(fs, {
    ...journal,
    refs: journal.refs.map((ref) => (ref.id === id ? rewrite(ref) : ref)),
  });
}

function readMigrationJournal(fs: FsSync): LegacyMigrationJournalV1 {
  return JSON.parse(
    decoder.decode(fs.readFileBytesSync(LEGACY_MIGRATION_JOURNAL)),
  ) as LegacyMigrationJournalV1;
}

function journalFromTree(tree: ExactFsTree): LegacyMigrationJournalV1 | null {
  const bytes = tree.files[LEGACY_MIGRATION_JOURNAL];
  if (bytes === undefined) return null;
  return JSON.parse(decoder.decode(bytes)) as LegacyMigrationJournalV1;
}

function journalRef(
  journal: LegacyMigrationJournalV1,
  id: 'scratch' | 'project-a' | 'project-b',
): LegacyMigrationJournalRefV1 {
  const ref = journal.refs.find((candidate) => candidate.id === id);
  if (ref === undefined) throw new Error(`missing migration journal ref: ${id}`);
  return ref;
}

function journalRefFromTree(
  tree: ExactFsTree,
  id: 'scratch' | 'project-a' | 'project-b',
): LegacyMigrationJournalRefV1 | null {
  const journal = journalFromTree(tree);
  if (journal === null) return null;
  return journal.refs.find((candidate) => candidate.id === id) ?? null;
}

function expectedLegacySourceTree(
  legacyTree: Readonly<Record<string, readonly number[]>>,
  id: 'scratch' | 'project-a' | 'project-b',
): Readonly<Record<string, readonly number[]>> {
  const prefix = `/${id === 'scratch' ? 'scratch' : `projects/${id}`}`;
  return Object.fromEntries(
    Object.entries(legacyTree)
      .filter(([path]) => path.startsWith(`${prefix}/`))
      .map(([path, bytes]) => [path.slice(prefix.length), bytes]),
  );
}

function expectAllLegacySourcesExact(
  fs: FsSync,
  legacyTree: Readonly<Record<string, readonly number[]>>,
): void {
  for (const id of ['scratch', 'project-a', 'project-b'] as const) {
    expect(fs.existsSync(legacyRoot(id)), `legacy source must survive: ${id}`).toBe(true);
    expect(snapshotTree(fs, legacyRoot(id))).toEqual(expectedLegacySourceTree(legacyTree, id));
  }
  expect(fs.existsSync(LEGACY_INDEX)).toBe(true);
  expect([...fs.readFileBytesSync(LEGACY_INDEX)]).toEqual(legacyTree['/.rifty-project-index.json']);
}

function expectNoUnpromotedStage(fs: FsSync, id: 'scratch' | 'project-a' | 'project-b'): void {
  const root = `${WORKBENCH_STAGES_ROOT}/${id}`;
  if (!fs.existsSync(root)) return;
  expect(fs.readdirSync(root), `orphan migration stage for ${id}`).toEqual([]);
}

function snapshotExistingLegacySources(
  fs: FsSync,
  except: 'scratch' | 'project-a' | 'project-b',
): Readonly<Record<string, Readonly<Record<string, readonly number[]>>>> {
  return Object.fromEntries(
    (['scratch', 'project-a', 'project-b'] as const)
      .filter((id) => id !== except && fs.existsSync(legacyRoot(id)))
      .map((id) => [id, snapshotTree(fs, legacyRoot(id))]),
  );
}

function expectLegacySourcesExact(
  fs: FsSync,
  expected: Readonly<Record<string, Readonly<Record<string, readonly number[]>>>>,
): void {
  for (const [id, tree] of Object.entries(expected)) {
    const root = legacyRoot(id);
    expect(fs.existsSync(root), `unrelated legacy source must survive: ${id}`).toBe(true);
    expect(snapshotTree(fs, root)).toEqual(tree);
  }
}

function workbenchProjectRoot(id: 'scratch' | 'project-a' | 'project-b'): string {
  return `${WORKBENCH_PROJECTS_ROOT}/${id}/tree`;
}

function workbenchProjectContainer(id: 'scratch' | 'project-a' | 'project-b'): string {
  return `${WORKBENCH_PROJECTS_ROOT}/${id}`;
}

function expectedAdoptedTree(
  id: 'scratch' | 'project-a' | 'project-b',
): Readonly<Record<string, readonly number[]>> {
  if (id === 'scratch') {
    return {
      '/.git/index': [0, 255, 1, 128],
      '/scratch.txt': [...encoder.encode('scratch ordinary bytes')],
    };
  }
  if (id === 'project-a') {
    return {
      '/.git/objects/aa/bb': [222, 173, 0, 190],
      '/src/main.ts': [...encoder.encode('legacy project a')],
    };
  }
  return {
    '/.git/HEAD': [...encoder.encode('ref: refs/heads/main\n')],
    '/src/main.ts': [...encoder.encode('legacy project b')],
  };
}

function mutationTouches(mutation: DurableOwnerMutation, root: string): boolean {
  return (
    mutation.target === root ||
    mutation.target.startsWith(`${root}/`) ||
    mutation.source === root ||
    mutation.source?.startsWith(`${root}/`) === true
  );
}

function assertAdoptionDurabilityPhaseOrder(
  boundaries: readonly DurablePersistBoundary[],
  id: 'project-a' | 'project-b',
  includesTombstone: boolean,
  expectedLegacyIndex: Uint8Array,
): void {
  const phaseIndex = (phase: LegacyMigrationJournalPhase['kind']): number =>
    boundaries.findIndex(
      (boundary) => journalRefFromTree(boundary.durableState, id)?.phase.kind === phase,
    );
  const has = (boundary: DurablePersistBoundary, phase: LegacyDurabilityPhase): boolean => {
    if (phase === 'copy-intent')
      return journalRefFromTree(boundary.durableState, id)?.phase.kind === 'copy';
    if (phase === 'copy') {
      return boundary.primitives.some(
        (primitive) =>
          primitive.operation.kind !== 'rm' &&
          primitive.operation.kind !== 'rename' &&
          mutationTouches(primitive.operation, `${WORKBENCH_STAGES_ROOT}/${id}`),
      );
    }
    if (phase === 'promote-intent') {
      return journalRefFromTree(boundary.durableState, id)?.phase.kind === 'promote';
    }
    if (phase === 'promote') {
      const projectContainer = `${WORKBENCH_PROJECTS_ROOT}/${id}`;
      return boundary.primitives.some(
        (primitive) =>
          primitive.operation.kind === 'rename' && primitive.operation.target === projectContainer,
      );
    }
    if (phase === 'mark-intent') {
      return journalRefFromTree(boundary.durableState, id)?.phase.kind === 'mark';
    }
    if (phase === 'source-cleanup-intent') {
      return journalRefFromTree(boundary.durableState, id)?.phase.kind === 'source-cleanup';
    }
    if (phase === 'source-cleanup') {
      return boundary.primitives.some(
        (primitive) =>
          primitive.operation.kind === 'rm' && primitive.operation.target === legacyRoot(id),
      );
    }
    if (phase === 'adopted') {
      return journalRefFromTree(boundary.durableState, id)?.phase.kind === 'adopted';
    }
    return boundary.primitives.some(
      (primitive) =>
        primitive.operation.kind === 'rm' && primitive.operation.target === LEGACY_INDEX,
    );
  };
  const first = (phase: LegacyDurabilityPhase): number =>
    boundaries.findIndex((boundary) => has(boundary, phase));
  const last = (phase: LegacyDurabilityPhase): number =>
    boundaries.findLastIndex((boundary) => has(boundary, phase));

  const copyIntent = first('copy-intent');
  const firstCopy = first('copy');
  const lastCopy = last('copy');
  const promoteIntent = first('promote-intent');
  const promote = first('promote');
  const markIntent = first('mark-intent');
  const catalogAdopted = boundaries.findIndex((boundary) => {
    const catalog = catalogFromTree(boundary.durableState);
    return catalog !== null && storedAdoption(catalog, id).kind === 'adopted';
  });
  const sourceCleanupIntent = first('source-cleanup-intent');
  const sourceCleanup = first('source-cleanup');
  const adopted = first('adopted');

  expect(copyIntent, 'copy journal intent must be durable').toBeGreaterThanOrEqual(0);
  expect(firstCopy, 'copy must mutate the materializer stage').toBeGreaterThan(copyIntent);
  expect(promoteIntent, 'promote intent must follow a complete durable copy').toBeGreaterThan(
    lastCopy,
  );
  expect(promote, 'promotion must follow durable promote intent').toBeGreaterThan(promoteIntent);
  expect(markIntent, 'mark intent must follow durable promotion').toBeGreaterThan(promote);
  expect(catalogAdopted, 'catalog adoption mark must be durable').toBeGreaterThan(markIntent);
  expect(
    sourceCleanupIntent,
    'source-cleanup intent certifies the durable adopted catalog mark',
  ).toBeGreaterThan(catalogAdopted);
  expect(sourceCleanup, 'source removal must follow durable source-cleanup intent').toBeGreaterThan(
    sourceCleanupIntent,
  );
  expect(adopted, 'adopted journal completion must follow durable source removal').toBeGreaterThan(
    sourceCleanup,
  );

  const phases = ['copy', 'promote', 'mark', 'source-cleanup'] as const;
  const proofPhases = phases.map((phase) => {
    const index = phaseIndex(phase);
    expect(index, `${phase} journal phase must be observable`).toBeGreaterThanOrEqual(0);
    const ref = journalRefFromTree(boundaries[index]?.durableState as ExactFsTree, id);
    if (ref === null || ref.phase.kind === 'pending' || ref.phase.kind === 'adopted') {
      throw new Error(`missing ${phase} proof for ${id}`);
    }
    return ref.phase;
  });
  const firstProof = proofPhases[0];
  if (firstProof === undefined) throw new Error(`missing adoption proof for ${id}`);
  expect(firstProof.stageId.length).toBeGreaterThan(0);
  expect(firstProof.definitionIdentity.length).toBeGreaterThan(0);
  expect(firstProof.baselineFingerprint.length).toBeGreaterThan(0);
  for (const proof of proofPhases.slice(1)) {
    expect(proof.stageId).toBe(firstProof.stageId);
    expect(proof.definitionIdentity).toBe(firstProof.definitionIdentity);
    expect(proof.baselineFingerprint).toBe(firstProof.baselineFingerprint);
  }

  const adoptedRef = journalRefFromTree(boundaries[adopted]?.durableState as ExactFsTree, id);
  if (adoptedRef === null || adoptedRef.phase.kind !== 'adopted') {
    throw new Error(`missing adopted proof for ${id}`);
  }
  expect(adoptedRef.phase.definitionIdentity).toBe(firstProof.definitionIdentity);
  expect(adoptedRef.phase.baselineFingerprint).toBe(firstProof.baselineFingerprint);
  const durableCatalog = catalogFromTree(boundaries[catalogAdopted]?.durableState as ExactFsTree);
  if (durableCatalog === null) throw new Error(`missing durable catalog mark for ${id}`);
  const catalogProof = storedAdoption(durableCatalog, id);
  if (catalogProof.kind !== 'adopted') throw new Error(`missing catalog adoption proof for ${id}`);
  expect(catalogProof.definitionIdentity).toBe(firstProof.definitionIdentity);
  expect(catalogProof.baselineFingerprint).toBe(firstProof.baselineFingerprint);
  for (const [index, boundary] of boundaries.entries()) {
    const catalog = catalogFromTree(boundary.durableState);
    if (catalog === null) continue;
    const adoption = storedAdoption(catalog, id);
    if (index < catalogAdopted) {
      expect(adoption).toEqual({
        kind: 'pending-adoption',
        sourceRoot: legacyRoot(id),
      });
    } else {
      expect(adoption).toEqual({
        kind: 'adopted',
        definitionIdentity: firstProof.definitionIdentity,
        baselineFingerprint: firstProof.baselineFingerprint,
      });
    }
  }
  expect(
    snapshotTree(
      restoreExactFsTree(boundaries[promote]?.durableState as ExactFsTree),
      workbenchProjectRoot(id),
    ),
  ).toEqual(expectedAdoptedTree(id));
  expect(
    restoreExactFsTree(boundaries[markIntent]?.durableState as ExactFsTree).existsSync(
      legacyRoot(id),
    ),
  ).toBe(true);

  if (includesTombstone) {
    const tombstone = first('tombstone');
    expect(tombstone, 'legacy-index tombstone must follow all adopted refs').toBeGreaterThan(
      adopted,
    );
    const allRefsAdopted = boundaries.findLastIndex((boundary, index) => {
      if (index >= tombstone) return false;
      const catalog = catalogFromTree(boundary.durableState);
      return catalog !== null && allStoredRefsAdopted(catalog);
    });
    expect(
      allRefsAdopted,
      'every catalog ref must be durably adopted before tombstone',
    ).toBeGreaterThan(markIntent);
    expect(allRefsAdopted).toBeLessThan(tombstone);
    const allAdoptedCatalog = catalogFromTree(
      boundaries[allRefsAdopted]?.durableState as ExactFsTree,
    );
    if (allAdoptedCatalog === null) throw new Error('missing all-adopted catalog sentinel');
    for (const refId of ['scratch', 'project-a', 'project-b'] as const) {
      const proof = storedAdoption(allAdoptedCatalog, refId);
      if (proof.kind !== 'adopted') throw new Error(`catalog ref was not adopted: ${refId}`);
      expect(proof.definitionIdentity.length).toBeGreaterThan(0);
      expect(proof.baselineFingerprint.length).toBeGreaterThan(0);
    }
    for (const [index, boundary] of boundaries.entries()) {
      if (index >= tombstone) break;
      expect(boundary.durableState.files[LEGACY_INDEX]).toEqual(expectedLegacyIndex);
    }
    expect(boundaries[tombstone]?.durableState.files[LEGACY_INDEX]).toBeUndefined();
  } else {
    for (const boundary of boundaries) {
      expect(boundary.durableState.files[LEGACY_INDEX]).toEqual(expectedLegacyIndex);
    }
  }
}

async function adopt(
  h: MigrationHarness,
  id: 'scratch' | 'project-a' | 'project-b',
  starterId: string,
): Promise<string> {
  const target =
    id === 'scratch' ? ({ kind: 'scratch' } as const) : ({ kind: 'project', id } as const);
  if (h.catalog.snapshot().active?.kind !== target.kind || id !== activeId(h.catalog.snapshot())) {
    await h.catalog.activate(target);
  }
  const opened = await h.owner.openProject(definition(id, starterId));
  const root = opened.projectRoot;
  await opened.close();
  return root;
}

async function prepareLastLegacyRef(h: MigrationHarness): Promise<void> {
  const indexBefore = legacyIndexBytes(h.fs);
  await adopt(h, 'project-a', 'starter-a');
  await adopt(h, 'scratch', 'starter-scratch');
  await h.catalog.activate({ kind: 'project', id: 'project-b' });
  expect(fsProjectState(h.fs, 'project-a')).toBe('adopted');
  expect(fsProjectState(h.fs, 'scratch')).toBe('adopted');
  expect(fsProjectState(h.fs, 'project-b')).toBe('legacy');
  expectLegacyIndexBytes(h.fs, indexBefore, 'present');
}

function fsProjectState(
  fs: FsSync,
  id: 'scratch' | 'project-a' | 'project-b',
): 'legacy' | 'adopted' | 'missing-or-torn' {
  const hasLegacy = fs.existsSync(legacyRoot(id));
  const hasAdopted = fs.existsSync(workbenchProjectRoot(id));
  if (hasLegacy && !hasAdopted) return 'legacy';
  if (!hasLegacy && hasAdopted) return 'adopted';
  return 'missing-or-torn';
}

function activeId(snapshot: PlaygroundCatalogSnapshot): string | null {
  if (snapshot.active === null) return null;
  return snapshot.active.kind === 'scratch' ? 'scratch' : snapshot.active.id;
}

describe('legacy workspace boot selection', () => {
  it('captures the historical session entry once, applies the historical slug, and sends a typed owner field', () => {
    expectTypeOf<WorkbenchOwnerBootConfig['legacyWorkspacePrefix']>().toEqualTypeOf<
      string | undefined
    >();
    let selected = 'legacy /tab?';
    const reads: string[] = [];
    const legacyWorkspacePrefix = capturePlaygroundLegacyWorkspacePrefix({
      getItem(key: string) {
        reads.push(key);
        return selected;
      },
    });
    selected = 'changed-after-capture';

    expect(reads).toEqual(['rifty.workspaceId']);
    expect(legacyWorkspacePrefix).toBe('/workspaces/legacy__tab_');
    const inspected = inspectPageToWorkbenchOwnerMessage({
      type: 'workbench:initialize',
      config: {
        deployment: {
          workers: { kernel: '/kernel.js', node: '/node.js', devServer: '/dev-server.js' },
          wasm: { sqlite: '/sqlite.wasm', esbuild: '/esbuild.wasm' },
          previewProbeTimeoutMs: 1_000,
        },
        packageAcquisition: { registryUrl: 'https://registry.invalid/' },
        storage: { persistence: 'required' },
        legacyWorkspacePrefix,
      },
    });
    expect(inspected.type).toBe('workbench:initialize');
    if (inspected.type !== 'workbench:initialize') {
      throw new Error(`unexpected owner message: ${inspected.type}`);
    }
    expect(inspected.config.legacyWorkspacePrefix).toBe('/workspaces/legacy__tab_');
    expect(Object.isFrozen(inspected.config)).toBe(true);
  });

  it.each([
    ['missing entry', null, undefined],
    ['empty entry', '', undefined],
    ['already-safe entry', 'a.b-c_d', '/workspaces/a.b-c_d'],
    ['non-ASCII and separators', '/雪', '/workspaces/__'],
    ['astral code point maps both UTF-16 code units', 'x😀y', '/workspaces/x__y'],
  ])('maps %s without minting or writing session state', (_case, selected, expected) => {
    let reads = 0;
    const storage: Pick<Storage, 'getItem'> = {
      getItem(key) {
        expect(key).toBe('rifty.workspaceId');
        reads += 1;
        return selected;
      },
    };

    expect(capturePlaygroundLegacyWorkspacePrefix(storage)).toBe(expected);
    expect(reads).toBe(1);
  });

  it('does not authorize a legacy scan when session storage is inaccessible', () => {
    const storage: Pick<Storage, 'getItem'> = {
      getItem() {
        throw new DOMException('denied', 'SecurityError');
      },
    };

    expect(capturePlaygroundLegacyWorkspacePrefix(storage)).toBeUndefined();
  });
});

describe('durable legacy catalog migration', () => {
  it('publishes the exact legacy catalog as pending adoption before any definition arrives', async () => {
    const fs = new MemoryFsSync();
    seedLegacy(fs);
    const before = snapshotTree(fs, LEGACY_PREFIX);
    const indexBefore = legacyIndexBytes(fs);

    const h = await openAuthority(fs, { legacyWorkspacePrefix: LEGACY_PREFIX });

    expect(h.catalog.snapshot()).toEqual(companionSnapshot());
    expect(Object.isFrozen(h.catalog.snapshot())).toBe(true);
    expect(Object.isFrozen(h.catalog.snapshot().projects)).toBe(true);
    expect(snapshotTree(fs, LEGACY_PREFIX)).toEqual(before);
    expectLegacyIndexBytes(fs, indexBefore, 'present');
    expect(readStoredCatalog(fs)).toEqual(pendingStoredCatalog());
    expect(readMigrationJournal(fs)).toEqual(pendingJournal());
    await h.owner.close();
  });

  it('adopts lazily by companion id + Starter provenance, preserves ordinary/.git bytes, and drops derived/authority trees', async () => {
    const fs = new MemoryFsSync();
    seedLegacy(fs);
    const indexBefore = legacyIndexBytes(fs);
    const h = await openAuthority(fs, { legacyWorkspacePrefix: LEGACY_PREFIX });
    const legacyProject = snapshotTree(fs, legacyRoot('project-a'));

    await expect(h.owner.openProject(definition('project-a', 'wrong-starter'))).rejects.toThrow();
    expect(snapshotTree(fs, legacyRoot('project-a'))).toEqual(legacyProject);
    expect(h.catalog.snapshot()).toEqual(companionSnapshot());

    const projectRoot = await adopt(h, 'project-a', 'starter-a');
    expect(snapshotTree(fs, projectRoot)).toEqual({
      '/.git/objects/aa/bb': [222, 173, 0, 190],
      '/src/main.ts': [...encoder.encode('legacy project a')],
    });
    expect(fs.existsSync(legacyRoot('project-a'))).toBe(false);
    expect(h.catalog.snapshot()).toEqual(companionSnapshot());

    const reopened = await h.owner.openProject(definition('project-a', 'starter-a'));
    expect(reopened.projectRoot).toBe(projectRoot);
    expect(snapshotTree(fs, reopened.projectRoot)).toEqual(snapshotTree(fs, projectRoot));
    await reopened.close();
    expectNoUnpromotedStage(fs, 'project-a');

    const scratchRoot = await adopt(h, 'scratch', 'starter-scratch');
    expect(snapshotTree(fs, scratchRoot)).toEqual({
      '/.git/index': [0, 255, 1, 128],
      '/scratch.txt': [...encoder.encode('scratch ordinary bytes')],
    });
    expect(fs.existsSync(legacyRoot('scratch'))).toBe(false);
    expectLegacyIndexBytes(fs, indexBefore, 'present');
    expectNoUnpromotedStage(fs, 'scratch');

    const projectBRoot = await adopt(h, 'project-b', 'starter-b');
    expect(decoder.decode(fs.readFileBytesSync(`${projectBRoot}/src/main.ts`))).toBe(
      'legacy project b',
    );
    expect(fs.existsSync(legacyRoot('project-b'))).toBe(false);
    expectLegacyIndexBytes(fs, indexBefore, 'tombstoned');
    expectNoUnpromotedStage(fs, 'project-b');
    await h.owner.close();
  });

  it.each([
    {
      name: 'normalized seed bytes',
      overrides: { files: { '/index.html': '<main>same Starter, other baseline</main>\n' } },
    },
    { name: 'template identity', overrides: { templateId: 'vite-template-v2' } },
    { name: 'runtime port', overrides: { port: 5174 } },
    {
      name: 'first-materialization identity',
      overrides: {
        firstMaterialization: {
          kind: 'snapshot' as const,
          snapshot: {
            snapshotId: `sha256:${'a'.repeat(64)}`,
            assetUrl: '/snapshots/project-a.gz',
            templateId: 'vite-template-v1',
          },
        },
      },
    },
  ] satisfies readonly BaselineMismatchCase[])(
    'binds an adopted ref to its exact definition and baseline: $name',
    async ({ overrides }) => {
      const fs = new MemoryFsSync();
      seedLegacy(fs);
      const h = await openAuthority(fs, { legacyWorkspacePrefix: LEGACY_PREFIX });
      await adopt(h, 'project-a', 'starter-a');
      const beforeFs = snapshotExactFsTree(fs);
      const beforeCatalog = h.catalog.snapshot();

      await expect(
        h.owner.openProject(definition('project-a', 'starter-a', overrides)),
      ).rejects.toBeInstanceOf(ProjectDefinitionMismatchError);

      expect(snapshotExactFsTree(fs)).toEqual(beforeFs);
      expect(h.catalog.snapshot()).toBe(beforeCatalog);
      expectNoUnpromotedStage(fs, 'project-a');
      await h.owner.close();
    },
  );

  it('is selected-prefix-only, idempotent once a companion catalog exists, and never claims migration in ephemeral mode', async () => {
    const unselectedFs = new MemoryFsSync();
    seedLegacy(unselectedFs);
    const unselectedBefore = snapshotExactFsTree(unselectedFs);
    const unselected = await openAuthority(unselectedFs);
    expect(unselected.catalog.snapshot()).toEqual({ active: null, scratch: null, projects: [] });
    await unselected.owner.close();
    expect(snapshotExactFsTree(unselectedFs)).toEqual(unselectedBefore);

    const laterSelected = await openAuthority(unselectedFs, {
      legacyWorkspacePrefix: LEGACY_PREFIX,
    });
    expect(laterSelected.catalog.snapshot()).toEqual(companionSnapshot());
    expect(readStoredCatalog(unselectedFs)).toEqual(pendingStoredCatalog());
    await laterSelected.owner.close();

    const ephemeralFs = new MemoryFsSync();
    seedLegacy(ephemeralFs);
    const ephemeralBefore = snapshotExactFsTree(ephemeralFs);
    const ephemeral = await openAuthority(ephemeralFs, {
      legacyWorkspacePrefix: LEGACY_PREFIX,
      persistence: 'ephemeral',
    });
    expect(ephemeral.catalog.snapshot()).toEqual({ active: null, scratch: null, projects: [] });
    await ephemeral.owner.close();
    expect(snapshotExactFsTree(ephemeralFs)).toEqual(ephemeralBefore);

    const laterDurable = await openAuthority(ephemeralFs, {
      legacyWorkspacePrefix: LEGACY_PREFIX,
      persistence: 'required',
    });
    expect(laterDurable.catalog.snapshot()).toEqual(companionSnapshot());
    expect(readStoredCatalog(ephemeralFs)).toEqual(pendingStoredCatalog());
    await laterDurable.owner.close();

    const migratedFs = new MemoryFsSync();
    seedLegacy(migratedFs);
    const migrated = await openAuthority(migratedFs, { legacyWorkspacePrefix: LEGACY_PREFIX });
    expect(migrated.catalog.snapshot()).toEqual(companionSnapshot());
    await migrated.owner.close();
    writeLegacyIndex(migratedFs, '{ now corrupt and must not replace the companion catalog');
    const companionBefore = snapshotExactFsTree(migratedFs);

    const reopened = await openAuthority(migratedFs, { legacyWorkspacePrefix: LEGACY_PREFIX });
    expect(reopened.catalog.snapshot()).toEqual(companionSnapshot());
    await reopened.owner.close();
    expect(snapshotExactFsTree(migratedFs)).toEqual(companionBefore);
  });
});

describe('legacy validation is all-or-nothing', () => {
  it.each([
    {
      name: 'malformed JSON',
      corrupt: (fs: FsSync) => write(fs, LEGACY_INDEX, '{"activeId":'),
    },
    {
      name: 'non-UTF-8 bytes',
      corrupt: (fs: FsSync) => write(fs, LEGACY_INDEX, new Uint8Array([0xff, 0xfe, 0xfd])),
    },
    {
      name: 'null root',
      corrupt: (fs: FsSync) => writeLegacyIndex(fs, null),
    },
    {
      name: 'array root',
      corrupt: (fs: FsSync) => writeLegacyIndex(fs, []),
    },
    {
      name: 'string root',
      corrupt: (fs: FsSync) => writeLegacyIndex(fs, 'catalog'),
    },
    {
      name: 'unknown index key',
      corrupt: (fs: FsSync) =>
        writeLegacyIndex(fs, { ...exactLegacyIndex(), ownerRoot: '/scratch' }),
    },
    {
      name: 'missing activeId',
      corrupt: (fs: FsSync) => writeLegacyIndex(fs, withoutKey(exactLegacyIndex(), 'activeId')),
    },
    {
      name: 'non-string activeId',
      corrupt: (fs: FsSync) => writeLegacyIndex(fs, { ...exactLegacyIndex(), activeId: 1 }),
    },
    {
      name: 'missing scratch key',
      corrupt: (fs: FsSync) => writeLegacyIndex(fs, withoutKey(exactLegacyIndex(), 'scratch')),
    },
    {
      name: 'non-object scratch',
      corrupt: (fs: FsSync) => writeLegacyIndex(fs, { ...exactLegacyIndex(), scratch: [] }),
    },
    {
      name: 'unknown scratch key',
      corrupt: (fs: FsSync) => {
        const index = exactLegacyIndex();
        writeLegacyIndex(fs, { ...index, scratch: { ...index.scratch, root: '/scratch' } });
      },
    },
    ...(['starter', 'dirty', 'editedAt'] as const).map(
      (field): LegacyIndexCorruptionCase => ({
        name: `scratch missing ${field}`,
        corrupt: (fs) => {
          const index = exactLegacyIndex();
          if (index.scratch === null) throw new Error('missing scratch fixture');
          writeLegacyIndex(fs, {
            ...index,
            scratch: withoutKey(index.scratch, field),
          });
        },
      }),
    ),
    {
      name: 'scratch starter wrong type',
      corrupt: (fs: FsSync) => {
        const index = exactLegacyIndex();
        writeLegacyIndex(fs, { ...index, scratch: { ...index.scratch, starter: false } });
      },
    },
    {
      name: 'scratch dirty wrong type',
      corrupt: (fs: FsSync) => {
        const index = exactLegacyIndex();
        writeLegacyIndex(fs, { ...index, scratch: { ...index.scratch, dirty: 'yes' } });
      },
    },
    {
      name: 'scratch editedAt wrong type',
      corrupt: (fs: FsSync) => {
        const index = exactLegacyIndex();
        writeLegacyIndex(fs, { ...index, scratch: { ...index.scratch, editedAt: 1 } });
      },
    },
    ...(['starter', 'editedAt'] as const).map(
      (field): LegacyIndexCorruptionCase => ({
        name: `scratch ${field} is empty`,
        corrupt: (fs) => {
          const index = exactLegacyIndex();
          writeLegacyIndex(fs, { ...index, scratch: { ...index.scratch, [field]: '' } });
        },
      }),
    ),
    {
      name: 'active scratch with null metadata',
      corrupt: (fs: FsSync) =>
        writeLegacyIndex(fs, { ...exactLegacyIndex(), activeId: 'scratch', scratch: null }),
    },
    {
      name: 'projects wrong type',
      corrupt: (fs: FsSync) => writeLegacyIndex(fs, { ...exactLegacyIndex(), projects: {} }),
    },
    {
      name: 'missing projects key',
      corrupt: (fs: FsSync) => writeLegacyIndex(fs, withoutKey(exactLegacyIndex(), 'projects')),
    },
    {
      name: 'non-object project entry',
      corrupt: (fs: FsSync) => {
        const index = exactLegacyIndex();
        const first = index.projects[0];
        if (first === undefined) throw new Error('missing project fixture');
        writeLegacyIndex(fs, { ...index, projects: [first, null] });
      },
    },
    ...(['id', 'name', 'starter', 'editedAt'] as const).map(
      (field): LegacyIndexCorruptionCase => ({
        name: `project missing ${field}`,
        corrupt: (fs) => {
          const index = exactLegacyIndex();
          const first = index.projects[0];
          const second = index.projects[1];
          if (first === undefined || second === undefined)
            throw new Error('missing project fixture');
          writeLegacyIndex(fs, {
            ...index,
            projects: [first, withoutKey(second, field)],
          });
        },
      }),
    ),
    ...(
      [
        ['id', 1],
        ['name', false],
        ['starter', []],
        ['editedAt', null],
      ] as const
    ).map(
      ([field, invalid]): LegacyIndexCorruptionCase => ({
        name: `project ${field} wrong type`,
        corrupt: (fs) => {
          const index = exactLegacyIndex();
          const first = index.projects[0];
          const second = index.projects[1];
          if (first === undefined || second === undefined)
            throw new Error('missing project fixture');
          writeLegacyIndex(fs, {
            ...index,
            projects: [first, { ...second, [field]: invalid }],
          });
        },
      }),
    ),
    ...(['id', 'name', 'starter', 'editedAt'] as const).map(
      (field): LegacyIndexCorruptionCase => ({
        name: `project ${field} is empty`,
        corrupt: (fs) => {
          const index = exactLegacyIndex();
          const first = index.projects[0];
          const second = index.projects[1];
          if (first === undefined || second === undefined)
            throw new Error('missing project fixture');
          writeLegacyIndex(fs, {
            ...index,
            projects: [first, { ...second, [field]: '' }],
          });
        },
      }),
    ),
    {
      name: 'duplicate project id',
      corrupt: (fs: FsSync) => {
        const index = exactLegacyIndex();
        const first = index.projects[0];
        if (first === undefined) throw new Error('missing legacy project fixture');
        writeLegacyIndex(fs, { ...index, projects: [...index.projects, first] });
      },
    },
    {
      name: 'named project uses reserved scratch id',
      corrupt: (fs: FsSync) => {
        const index = exactLegacyIndex();
        const first = index.projects[0];
        const second = index.projects[1];
        if (first === undefined || second === undefined) throw new Error('missing project fixture');
        writeLegacyIndex(fs, { ...index, projects: [first, { ...second, id: 'scratch' }] });
      },
    },
    {
      name: 'active project absent from projects',
      corrupt: (fs: FsSync) => writeLegacyIndex(fs, { ...exactLegacyIndex(), activeId: 'missing' }),
    },
    {
      name: 'scratch metadata without tree',
      corrupt: (fs: FsSync) => fs.rmSync(legacyRoot('scratch'), { recursive: true, force: true }),
    },
    {
      name: 'scratch tree without metadata',
      corrupt: (fs: FsSync) => writeLegacyIndex(fs, { ...exactLegacyIndex(), scratch: null }),
    },
    {
      name: 'indexed project tree missing',
      corrupt: (fs: FsSync) => fs.rmSync(legacyRoot('project-b'), { recursive: true, force: true }),
    },
    {
      name: 'unknown project metadata key',
      corrupt: (fs: FsSync) => {
        const index = exactLegacyIndex();
        const first = index.projects[0];
        const second = index.projects[1];
        if (first === undefined || second === undefined) {
          throw new Error('missing legacy project fixture');
        }
        writeLegacyIndex(fs, {
          ...index,
          projects: [{ ...first, root: '/projects/project-a' }, second],
        });
      },
    },
  ] satisfies readonly LegacyIndexCorruptionCase[])(
    'rejects $name without exposing an empty replacement catalog',
    async ({ corrupt }) => {
      const fs = new MemoryFsSync();
      seedLegacy(fs);
      corrupt(fs);
      const before = snapshotExactFsTree(fs);

      await expect(openAuthority(fs, { legacyWorkspacePrefix: LEGACY_PREFIX })).rejects.toThrow();

      expect(snapshotExactFsTree(fs)).toEqual(before);
      expect(fs.existsSync(LEGACY_INDEX)).toBe(true);
      expect(fs.existsSync(WORKBENCH_CATALOG)).toBe(false);
      expect(fs.existsSync(LEGACY_MIGRATION_JOURNAL)).toBe(false);
      await expect(openAuthority(fs, { legacyWorkspacePrefix: LEGACY_PREFIX })).rejects.toThrow();
      expect(snapshotExactFsTree(fs)).toEqual(before);
    },
  );
});

describe('persisted legacy migration journal validation', () => {
  const fakeProof = Object.freeze({
    stageId: 'migration-stage-missing',
    definitionIdentity: 'definition:project-a:starter-a',
    baselineFingerprint: 'baseline:starter-a',
  });

  it.each(JOURNAL_PHASES)('accepts the exact valid $phase restart fixture', async (phase) => {
    const fs = new MemoryFsSync();
    seedValidJournalPhase(fs, phase);

    const opened = await openAuthority(fs, { legacyWorkspacePrefix: LEGACY_PREFIX });

    expect(opened.catalog.snapshot()).toEqual(companionSnapshot());
    await opened.owner.close();
  });

  const phaseSchemaCorruptions = JOURNAL_PHASES.flatMap((phase) => {
    const fields =
      phase === 'pending'
        ? ([] as const)
        : phase === 'adopted'
          ? (['definitionIdentity', 'baselineFingerprint'] as const)
          : (['stageId', 'definitionIdentity', 'baselineFingerprint'] as const);
    return [
      {
        name: `${phase}: missing kind`,
        phase,
        corrupt: (value: Readonly<Record<string, unknown>>) => withoutKey(value, 'kind'),
      },
      {
        name: `${phase}: non-string kind`,
        phase,
        corrupt: (value: Readonly<Record<string, unknown>>) => ({ ...value, kind: 1 }),
      },
      {
        name: `${phase}: unknown key`,
        phase,
        corrupt: (value: Readonly<Record<string, unknown>>) => ({
          ...value,
          operationId: 'forbidden',
        }),
      },
      ...fields.flatMap((field) => [
        {
          name: `${phase}: missing ${field}`,
          phase,
          corrupt: (value: Readonly<Record<string, unknown>>) => withoutKey(value, field),
        },
        {
          name: `${phase}: non-string ${field}`,
          phase,
          corrupt: (value: Readonly<Record<string, unknown>>) => ({ ...value, [field]: 1 }),
        },
        {
          name: `${phase}: empty ${field}`,
          phase,
          corrupt: (value: Readonly<Record<string, unknown>>) => ({ ...value, [field]: '' }),
        },
      ]),
    ];
  });

  it.each(phaseSchemaCorruptions)(
    'rejects exact phase-schema violation $name without effects, twice',
    async ({ phase, corrupt }) => {
      const fs = new MemoryFsSync();
      seedValidJournalPhase(fs, phase);
      rewriteJournalRef(fs, 'project-a', (ref) => ({
        ...ref,
        phase: corrupt({ ...ref.phase }),
      }));
      const before = snapshotExactFsTree(fs);

      await expect(openAuthority(fs, { legacyWorkspacePrefix: LEGACY_PREFIX })).rejects.toThrow();
      expect(snapshotExactFsTree(fs)).toEqual(before);
      await expect(openAuthority(fs, { legacyWorkspacePrefix: LEGACY_PREFIX })).rejects.toThrow();
      expect(snapshotExactFsTree(fs)).toEqual(before);
    },
  );

  const adoptionSchemaCorruptions = (
    [
      {
        phase: 'pending' as const,
        fields: ['sourceRoot'] as const,
      },
      {
        phase: 'adopted' as const,
        fields: ['definitionIdentity', 'baselineFingerprint'] as const,
      },
    ] as const
  ).flatMap(({ phase, fields }) => [
    {
      name: `${phase}: missing adoption kind`,
      phase,
      corrupt: (value: Readonly<Record<string, unknown>>) => withoutKey(value, 'kind'),
    },
    {
      name: `${phase}: non-string adoption kind`,
      phase,
      corrupt: (value: Readonly<Record<string, unknown>>) => ({ ...value, kind: 1 }),
    },
    {
      name: `${phase}: empty adoption kind`,
      phase,
      corrupt: (value: Readonly<Record<string, unknown>>) => ({ ...value, kind: '' }),
    },
    {
      name: `${phase}: unknown adoption key`,
      phase,
      corrupt: (value: Readonly<Record<string, unknown>>) => ({
        ...value,
        ownerRoot: '/forbidden',
      }),
    },
    ...fields.flatMap((field) => [
      {
        name: `${phase}: missing adoption ${field}`,
        phase,
        corrupt: (value: Readonly<Record<string, unknown>>) => withoutKey(value, field),
      },
      {
        name: `${phase}: non-string adoption ${field}`,
        phase,
        corrupt: (value: Readonly<Record<string, unknown>>) => ({ ...value, [field]: 1 }),
      },
      {
        name: `${phase}: empty adoption ${field}`,
        phase,
        corrupt: (value: Readonly<Record<string, unknown>>) => ({ ...value, [field]: '' }),
      },
    ]),
  ]);

  it.each(adoptionSchemaCorruptions)(
    'rejects exact catalog-adoption schema violation $name without effects, twice',
    async ({ phase, corrupt }) => {
      const fs = new MemoryFsSync();
      seedValidJournalPhase(fs, phase);
      rewriteStoredAdoption(fs, 'project-a', corrupt);
      const before = snapshotExactFsTree(fs);

      await expect(openAuthority(fs, { legacyWorkspacePrefix: LEGACY_PREFIX })).rejects.toThrow();
      expect(snapshotExactFsTree(fs)).toEqual(before);
      await expect(openAuthority(fs, { legacyWorkspacePrefix: LEGACY_PREFIX })).rejects.toThrow();
      expect(snapshotExactFsTree(fs)).toEqual(before);
    },
  );

  it.each([
    ...(['pending', 'copy', 'promote', 'mark'] as const).flatMap((phase) => [
      {
        name: `${phase} phase advances catalog provenance to adopted early`,
        phase,
        corrupt: (fs: FsSync) =>
          rewriteStoredAdoption(fs, 'project-a', () => ({
            kind: 'adopted',
            definitionIdentity: JOURNAL_PROOF.definitionIdentity,
            baselineFingerprint: JOURNAL_PROOF.baselineFingerprint,
          })),
      },
      {
        name: `${phase} phase pending catalog sourceRoot disagrees with its journal ref`,
        phase,
        corrupt: (fs: FsSync) =>
          rewriteStoredAdoption(fs, 'project-a', (adoption) => ({
            ...adoption,
            sourceRoot: legacyRoot('project-b'),
          })),
      },
    ]),
    ...(['source-cleanup', 'adopted'] as const).flatMap((phase) =>
      (['definitionIdentity', 'baselineFingerprint'] as const).map((field) => ({
        name: `${phase} phase catalog ${field} disagrees with its journal proof`,
        phase,
        corrupt: (fs: FsSync) =>
          rewriteStoredAdoption(fs, 'project-a', (adoption) => ({
            ...adoption,
            [field]: `${JOURNAL_PROOF[field]}-mismatch`,
          })),
      })),
    ),
    {
      name: 'copy phase missing its exact empty stage',
      phase: 'copy' as const,
      corrupt: (fs: FsSync) =>
        fs.rmSync(stageContainer('project-a'), { recursive: true, force: true }),
    },
    {
      name: 'promote phase has an incomplete stage',
      phase: 'promote' as const,
      corrupt: (fs: FsSync) =>
        fs.rmSync(`${stageContainer('project-a')}/tree/src/main.ts`, { force: true }),
    },
    {
      name: 'promote phase has a target instead of its stage',
      phase: 'promote' as const,
      corrupt: (fs: FsSync) => {
        fs.rmSync(stageContainer('project-a'), { recursive: true, force: true });
        seedPromotedProjectFixture(fs, 'project-a', JOURNAL_PROOF.definitionIdentity);
      },
    },
    {
      name: 'source-cleanup phase still has pending catalog provenance',
      phase: 'source-cleanup' as const,
      corrupt: (fs: FsSync) => writeStoredCatalog(fs, pendingStoredCatalog()),
    },
    {
      name: 'source-cleanup phase is missing its promoted target',
      phase: 'source-cleanup' as const,
      corrupt: (fs: FsSync) =>
        fs.rmSync(workbenchProjectContainer('project-a'), { recursive: true, force: true }),
    },
    {
      name: 'adopted phase is missing its target with the source already absent',
      phase: 'adopted' as const,
      corrupt: (fs: FsSync) =>
        fs.rmSync(workbenchProjectContainer('project-a'), { recursive: true, force: true }),
    },
    {
      name: 'adopted phase regresses to pending catalog provenance',
      phase: 'adopted' as const,
      corrupt: (fs: FsSync) => writeStoredCatalog(fs, pendingStoredCatalog()),
    },
    {
      name: 'adopted phase retains a legacy source',
      phase: 'adopted' as const,
      corrupt: (fs: FsSync) => write(fs, `${legacyRoot('project-a')}/src/main.ts`, 'stale source'),
    },
  ])('rejects cross-state $name without effects, twice', async ({ phase, corrupt }) => {
    const fs = new MemoryFsSync();
    seedValidJournalPhase(fs, phase);
    corrupt(fs);
    const before = snapshotExactFsTree(fs);

    await expect(openAuthority(fs, { legacyWorkspacePrefix: LEGACY_PREFIX })).rejects.toThrow();
    expect(snapshotExactFsTree(fs)).toEqual(before);
    await expect(openAuthority(fs, { legacyWorkspacePrefix: LEGACY_PREFIX })).rejects.toThrow();
    expect(snapshotExactFsTree(fs)).toEqual(before);
  });

  it.each([
    {
      name: 'malformed JSON',
      corrupt: (fs: FsSync) => write(fs, LEGACY_MIGRATION_JOURNAL, '{"version":1'),
    },
    {
      name: 'non-UTF-8 bytes',
      corrupt: (fs: FsSync) =>
        write(fs, LEGACY_MIGRATION_JOURNAL, new Uint8Array([0xff, 0xfe, 0xfd])),
    },
    {
      name: 'unknown top-level key',
      corrupt: (fs: FsSync, journal: LegacyMigrationJournalV1) =>
        writeMigrationJournal(fs, { ...journal, ownerRoot: '/forbidden' }),
    },
    {
      name: 'unknown version',
      corrupt: (fs: FsSync, journal: LegacyMigrationJournalV1) =>
        writeMigrationJournal(fs, { ...journal, version: 2 }),
    },
    {
      name: 'wrong selected prefix',
      corrupt: (fs: FsSync, journal: LegacyMigrationJournalV1) =>
        writeMigrationJournal(fs, { ...journal, legacyWorkspacePrefix: '/workspaces/other' }),
    },
    {
      name: 'null journal root',
      corrupt: (fs: FsSync) => writeMigrationJournal(fs, null),
    },
    {
      name: 'array journal root',
      corrupt: (fs: FsSync) => writeMigrationJournal(fs, []),
    },
    ...(['version', 'legacyWorkspacePrefix', 'refs'] as const).map(
      (field): JournalCorruptionCase => ({
        name: `missing top-level ${field}`,
        corrupt: (fs, journal) => writeMigrationJournal(fs, withoutKey(journal, field)),
      }),
    ),
    {
      name: 'non-number version',
      corrupt: (fs: FsSync, journal: LegacyMigrationJournalV1) =>
        writeMigrationJournal(fs, { ...journal, version: '1' }),
    },
    {
      name: 'non-string selected prefix',
      corrupt: (fs: FsSync, journal: LegacyMigrationJournalV1) =>
        writeMigrationJournal(fs, { ...journal, legacyWorkspacePrefix: 1 }),
    },
    {
      name: 'non-array refs',
      corrupt: (fs: FsSync, journal: LegacyMigrationJournalV1) =>
        writeMigrationJournal(fs, { ...journal, refs: {} }),
    },
    {
      name: 'non-object ref',
      corrupt: (fs: FsSync, journal: LegacyMigrationJournalV1) =>
        writeMigrationJournal(fs, { ...journal, refs: [null, ...journal.refs.slice(1)] }),
    },
    ...(['kind', 'id', 'starterId', 'sourceRoot', 'phase'] as const).flatMap(
      (field): readonly JournalCorruptionCase[] => [
        {
          name: `ref missing ${field}`,
          corrupt: (fs, journal) => {
            const ref = journalRef(journal, 'project-a');
            writeMigrationJournal(fs, {
              ...journal,
              refs: journal.refs.map((candidate) =>
                candidate.id === 'project-a' ? withoutKey(ref, field) : candidate,
              ),
            });
          },
        },
        {
          name: `ref ${field} wrong type`,
          corrupt: (fs, journal) => {
            const ref = journalRef(journal, 'project-a');
            writeMigrationJournal(fs, {
              ...journal,
              refs: journal.refs.map((candidate) =>
                candidate.id === 'project-a' ? { ...ref, [field]: 1 } : candidate,
              ),
            });
          },
        },
      ],
    ),
    {
      name: 'duplicate ref',
      corrupt: (fs: FsSync, journal: LegacyMigrationJournalV1) =>
        writeMigrationJournal(fs, {
          ...journal,
          refs: [...journal.refs, journalRef(journal, 'project-a')],
        }),
    },
    {
      name: 'missing ref',
      corrupt: (fs: FsSync, journal: LegacyMigrationJournalV1) =>
        writeMigrationJournal(fs, {
          ...journal,
          refs: journal.refs.filter((candidate) => candidate.id !== 'project-a'),
        }),
    },
    {
      name: 'ref kind disagrees with catalog identity',
      corrupt: (fs: FsSync, journal: LegacyMigrationJournalV1) => {
        const ref = journalRef(journal, 'project-a');
        writeMigrationJournal(fs, {
          ...journal,
          refs: journal.refs.map((candidate) =>
            candidate.id === 'project-a' ? { ...ref, kind: 'scratch' } : candidate,
          ),
        });
      },
    },
    {
      name: 'unknown ref key',
      corrupt: (fs: FsSync, journal: LegacyMigrationJournalV1) => {
        const ref = journalRef(journal, 'project-a');
        writeMigrationJournal(fs, {
          ...journal,
          refs: journal.refs.map((candidate) =>
            candidate.id === 'project-a' ? { ...ref, projectRoot: '/forbidden' } : candidate,
          ),
        });
      },
    },
    {
      name: 'catalog-absent ref',
      corrupt: (fs: FsSync, journal: LegacyMigrationJournalV1) => {
        const ref = journalRef(journal, 'project-a');
        writeMigrationJournal(fs, {
          ...journal,
          refs: journal.refs.map((candidate) =>
            candidate.id === 'project-a' ? { ...ref, id: 'project-x' } : candidate,
          ),
        });
      },
    },
    {
      name: 'Starter provenance mismatch',
      corrupt: (fs: FsSync, journal: LegacyMigrationJournalV1) => {
        const ref = journalRef(journal, 'project-a');
        writeMigrationJournal(fs, {
          ...journal,
          refs: journal.refs.map((candidate) =>
            candidate.id === 'project-a' ? { ...ref, starterId: 'starter-b' } : candidate,
          ),
        });
      },
    },
    {
      name: 'source identity mismatch',
      corrupt: (fs: FsSync, journal: LegacyMigrationJournalV1) => {
        const ref = journalRef(journal, 'project-a');
        writeMigrationJournal(fs, {
          ...journal,
          refs: journal.refs.map((candidate) =>
            candidate.id === 'project-a'
              ? { ...ref, sourceRoot: legacyRoot('project-b') }
              : candidate,
          ),
        });
      },
    },
    {
      name: 'unknown phase',
      corrupt: (fs: FsSync, journal: LegacyMigrationJournalV1) => {
        const ref = journalRef(journal, 'project-a');
        writeMigrationJournal(fs, {
          ...journal,
          refs: journal.refs.map((candidate) =>
            candidate.id === 'project-a' ? { ...ref, phase: { kind: 'unknown' } } : candidate,
          ),
        });
      },
    },
    {
      name: 'extra phase key',
      corrupt: (fs: FsSync, journal: LegacyMigrationJournalV1) => {
        const ref = journalRef(journal, 'project-a');
        writeMigrationJournal(fs, {
          ...journal,
          refs: journal.refs.map((candidate) =>
            candidate.id === 'project-a'
              ? { ...ref, phase: { kind: 'pending', operationId: 'forbidden' } }
              : candidate,
          ),
        });
      },
    },
    {
      name: 'copy references a missing stage',
      corrupt: (fs: FsSync, journal: LegacyMigrationJournalV1) => {
        const ref = journalRef(journal, 'project-a');
        writeMigrationJournal(fs, {
          ...journal,
          refs: journal.refs.map((candidate) =>
            candidate.id === 'project-a'
              ? { ...ref, phase: { kind: 'copy', ...fakeProof } }
              : candidate,
          ),
        });
      },
    },
    {
      name: 'mark references a missing promoted target',
      corrupt: (fs: FsSync, journal: LegacyMigrationJournalV1) => {
        const ref = journalRef(journal, 'project-a');
        writeMigrationJournal(fs, {
          ...journal,
          refs: journal.refs.map((candidate) =>
            candidate.id === 'project-a'
              ? { ...ref, phase: { kind: 'mark', ...fakeProof } }
              : candidate,
          ),
        });
      },
    },
    {
      name: 'mark definition identity disagrees with promoted metadata',
      corrupt: (fs: FsSync, journal: LegacyMigrationJournalV1) => {
        seedPromotedProjectFixture(fs, 'project-a', 'definition:promoted-target');
        const ref = journalRef(journal, 'project-a');
        writeMigrationJournal(fs, {
          ...journal,
          refs: journal.refs.map((candidate) =>
            candidate.id === 'project-a'
              ? {
                  ...ref,
                  phase: {
                    kind: 'mark',
                    ...fakeProof,
                    definitionIdentity: 'definition:journal-claim',
                  },
                }
              : candidate,
          ),
        });
      },
    },
    {
      name: 'mark carries an empty baseline identity',
      corrupt: (fs: FsSync, journal: LegacyMigrationJournalV1) => {
        seedPromotedProjectFixture(fs, 'project-a', fakeProof.definitionIdentity);
        const ref = journalRef(journal, 'project-a');
        writeMigrationJournal(fs, {
          ...journal,
          refs: journal.refs.map((candidate) =>
            candidate.id === 'project-a'
              ? {
                  ...ref,
                  phase: { kind: 'mark', ...fakeProof, baselineFingerprint: '' },
                }
              : candidate,
          ),
        });
      },
    },
    {
      name: 'adopted proof references a missing promoted target',
      corrupt: (fs: FsSync, journal: LegacyMigrationJournalV1) => {
        fs.rmSync(legacyRoot('project-a'), { recursive: true, force: true });
        const ref = journalRef(journal, 'project-a');
        writeMigrationJournal(fs, {
          ...journal,
          refs: journal.refs.map((candidate) =>
            candidate.id === 'project-a'
              ? {
                  ...ref,
                  phase: {
                    kind: 'adopted',
                    definitionIdentity: fakeProof.definitionIdentity,
                    baselineFingerprint: fakeProof.baselineFingerprint,
                  },
                }
              : candidate,
          ),
        });
      },
    },
    {
      name: 'pending refs after an early legacy-index tombstone',
      corrupt: (fs: FsSync) => fs.rmSync(LEGACY_INDEX, { force: true }),
    },
    {
      name: 'pending ref with missing source',
      corrupt: (fs: FsSync) => fs.rmSync(legacyRoot('project-a'), { recursive: true, force: true }),
    },
  ] satisfies readonly JournalCorruptionCase[])(
    'rejects $name without poisoning catalog state, twice',
    async ({ corrupt }) => {
      const fs = new MemoryFsSync();
      seedValidJournalPhase(fs, 'pending');
      const validJournal = readMigrationJournal(fs);
      corrupt(fs, validJournal);
      const corruptState = snapshotExactFsTree(fs);

      await expect(openAuthority(fs, { legacyWorkspacePrefix: LEGACY_PREFIX })).rejects.toThrow(
        /legacy|migration|journal|state|source|stage|project/i,
      );
      expect(snapshotExactFsTree(fs)).toEqual(corruptState);
      await expect(openAuthority(fs, { legacyWorkspacePrefix: LEGACY_PREFIX })).rejects.toThrow(
        /legacy|migration|journal|state|source|stage|project/i,
      );
      expect(snapshotExactFsTree(fs)).toEqual(corruptState);
    },
  );
});

describe('durable owner persistence fixture', () => {
  it('replays exact OPFS primitives after an injected ordinal and exposes a partial promoted target on hard restart', async () => {
    const fs = new DurableOwnerFs();
    write(fs, '/stage/tree/a.txt', 'a');
    write(fs, '/stage/tree/b.txt', 'b');
    write(fs, '/stage/tree/c.txt', 'c');
    fs.mkdirSync('/projects', { recursive: true });
    fs.sealDurableState();

    fs.utimes('/stage/tree/a.txt', 1, 2);
    expectNoPendingPrimitives(fs);
    fs.armPersistFailure(4, 'quota-report');
    fs.renameSync('/stage', '/projects/project-a');
    const report = await fs.flush();
    fs.disarmPersistFailure();

    expect(report.total).toBe(1);
    expect(report.failures).toEqual([
      {
        path: '/projects/project-a/tree/b.txt',
        op: 'rename',
        message: 'quota exceeded at injected durable-owner primitive',
      },
    ]);
    expect(fs.trace.map(({ ordinal, outcome }) => ({ ordinal, outcome }))).toEqual([
      { ordinal: 1, outcome: 'success' },
      { ordinal: 2, outcome: 'success' },
      { ordinal: 3, outcome: 'success' },
      { ordinal: 4, outcome: 'injected-failure' },
      { ordinal: 5, outcome: 'success' },
      { ordinal: 6, outcome: 'success' },
    ]);
    expectNoPendingPrimitives(fs);
    expect(snapshotTree(fs, '/projects/project-a')).toEqual({
      '/tree/a.txt': [...encoder.encode('a')],
      '/tree/b.txt': [...encoder.encode('b')],
      '/tree/c.txt': [...encoder.encode('c')],
    });

    const durable = fs.restartFromDurableState();
    expect(durable.liveSnapshot()).toEqual({
      directories: ['/projects', '/projects/project-a', '/projects/project-a/tree'],
      files: {
        '/projects/project-a/tree/a.txt': encoder.encode('a'),
        '/projects/project-a/tree/c.txt': encoder.encode('c'),
      },
    });
    expect(durable.existsSync('/stage')).toBe(false);
    expectNoPendingPrimitives(durable);
    for (const boundary of fs.durabilityBoundaries) {
      const boundaryRestart = createDurableOwnerFsFromTree(boundary.durableState);
      expect(boundaryRestart.liveSnapshot()).toEqual(boundary.durableState);
      expect(boundaryRestart.durableSnapshot()).toEqual(boundary.durableState);
      expectNoPendingPrimitives(boundaryRestart);
    }
  });

  it('decomposes recursive cp into ordered directory/write primitives', async () => {
    const fs = new DurableOwnerFs();
    write(fs, '/source/nested/a.txt', 'a');
    write(fs, '/source/b.txt', 'b');
    fs.sealDurableState();

    fs.cpSync('/source', '/missing/target', { recursive: true });
    await fs.flush();

    expect(
      fs.durabilityBoundaries[0]?.primitives.map((primitive) => ({
        kind: primitive.kind,
        path: primitive.path,
        operation: primitive.operation.kind,
      })),
    ).toEqual([
      { kind: 'mkdir', path: '/missing/target', operation: 'cp' },
      { kind: 'write', path: '/missing/target/b.txt', operation: 'cp' },
      { kind: 'mkdir', path: '/missing/target/nested', operation: 'cp' },
      { kind: 'write', path: '/missing/target/nested/a.txt', operation: 'cp' },
    ]);
    expect(fs.durableSnapshot()).toEqual(fs.liveSnapshot());
    expectNoPendingPrimitives(fs);
  });
});

describe('legacy torn-state recovery', () => {
  it('retries every catalog-publication boundary without losing or emptying a valid legacy catalog', async () => {
    let failures = 0;
    let exhaustedMutations = false;
    for (let failAt = 1; failAt <= MAX_CRASH_MUTATIONS; failAt += 1) {
      const memory = createMemoryFs();
      const fs = new CrashableMemoryFsSync(memory.backend);
      seedLegacy(fs);
      const legacyBefore = snapshotTree(fs, LEGACY_PREFIX);
      const indexBefore = legacyIndexBytes(fs);
      fs.arm(failAt);
      const outcome = await openAuthority(fs, { legacyWorkspacePrefix: LEGACY_PREFIX }).then(
        (opened: MigrationHarness) => ({ kind: 'success' as const, opened }),
        () => ({ kind: 'failed' as const }),
      );
      fs.disarm();
      if (outcome.kind === 'success') {
        expect(fs.mutationCount).toBeLessThan(failAt);
        expect(outcome.opened.catalog.snapshot()).toEqual(companionSnapshot());
        expectAllLegacySourcesExact(fs, legacyBefore);
        expectLegacyIndexBytes(fs, indexBefore, 'present');
        expect(readStoredCatalog(fs)).toEqual(pendingStoredCatalog());
        expect(readMigrationJournal(fs)).toEqual(pendingJournal());
        await outcome.opened.owner.close();
        const settled = snapshotExactFsTree(fs);
        const restarted = await openAuthority(fs);
        expect(restarted.catalog.snapshot()).toEqual(companionSnapshot());
        await restarted.owner.close();
        expect(snapshotExactFsTree(fs)).toEqual(settled);
        exhaustedMutations = true;
        break;
      }
      failures += 1;

      const recovered = await openAuthority(fs, { legacyWorkspacePrefix: LEGACY_PREFIX });
      expect(recovered.catalog.snapshot()).toEqual(companionSnapshot());
      expect(readMigrationJournal(fs)).toEqual(pendingJournal());
      expectAllLegacySourcesExact(fs, legacyBefore);
      expectLegacyIndexBytes(fs, indexBefore, 'present');
      for (const id of ['scratch', 'project-a', 'project-b'] as const) {
        expect(fs.existsSync(workbenchProjectContainer(id))).toBe(false);
        expectNoUnpromotedStage(fs, id);
      }
      await recovered.owner.close();
    }
    expect(exhaustedMutations).toBe(true);
    expect(failures).toBeGreaterThan(1);
  });

  it('retries copy/promote/mark/source-cleanup without duplicate adoption or premature source loss', async () => {
    let failures = 0;
    let exhaustedMutations = false;
    for (let failAt = 1; failAt <= MAX_CRASH_MUTATIONS; failAt += 1) {
      const memory = createMemoryFs();
      const fs = new CrashableMemoryFsSync(memory.backend);
      seedLegacy(fs);
      const legacyBefore = snapshotTree(fs, LEGACY_PREFIX);
      const indexBefore = legacyIndexBytes(fs);
      const initial = await openAuthority(fs, { legacyWorkspacePrefix: LEGACY_PREFIX });
      fs.arm(failAt);
      const outcome = await initial.owner.openProject(definition('project-a', 'starter-a')).then(
        (opened: OpenedMigrationProject) => ({ kind: 'success' as const, opened }),
        () => ({ kind: 'failed' as const }),
      );
      fs.disarm();
      if (outcome.kind === 'success') {
        expect(fs.mutationCount).toBeLessThan(failAt);
        await outcome.opened.close();
        expect(snapshotTree(fs, workbenchProjectRoot('project-a'))).toEqual(
          expectedAdoptedTree('project-a'),
        );
        expect(fs.existsSync(legacyRoot('project-a'))).toBe(false);
        expect(snapshotTree(fs, legacyRoot('scratch'))).toEqual(
          expectedLegacySourceTree(legacyBefore, 'scratch'),
        );
        expect(snapshotTree(fs, legacyRoot('project-b'))).toEqual(
          expectedLegacySourceTree(legacyBefore, 'project-b'),
        );
        expectLegacyIndexBytes(fs, indexBefore, 'present');
        expectNoUnpromotedStage(fs, 'project-a');
        await initial.owner.close();
        const settled = snapshotExactFsTree(fs);
        const restarted = await openAuthority(fs);
        expect(restarted.catalog.snapshot()).toEqual(companionSnapshot());
        const reopened = await restarted.owner.openProject(definition('project-a', 'starter-a'));
        expect(snapshotTree(fs, reopened.projectRoot)).toEqual(expectedAdoptedTree('project-a'));
        await reopened.close();
        await restarted.owner.close();
        expect(snapshotExactFsTree(fs)).toEqual(settled);
        exhaustedMutations = true;
        break;
      }
      failures += 1;

      const recovered = await openAuthority(fs, { legacyWorkspacePrefix: LEGACY_PREFIX });
      expect(recovered.catalog.snapshot()).toEqual(companionSnapshot());
      const opened = await recovered.owner.openProject(definition('project-a', 'starter-a'));
      expect(snapshotTree(fs, opened.projectRoot)).toEqual({
        '/.git/objects/aa/bb': [222, 173, 0, 190],
        '/src/main.ts': [...encoder.encode('legacy project a')],
      });
      await opened.close();
      expect(fs.existsSync(legacyRoot('project-a'))).toBe(false);
      expect(fs.existsSync(legacyRoot('scratch'))).toBe(true);
      expect(snapshotTree(fs, legacyRoot('scratch'))).toEqual(
        expectedLegacySourceTree(legacyBefore, 'scratch'),
      );
      expect(fs.existsSync(legacyRoot('project-b'))).toBe(true);
      expect(snapshotTree(fs, legacyRoot('project-b'))).toEqual(
        expectedLegacySourceTree(legacyBefore, 'project-b'),
      );
      expectLegacyIndexBytes(fs, indexBefore, 'present');
      expectNoUnpromotedStage(fs, 'project-a');
      await recovered.owner.close();
    }
    expect(exhaustedMutations).toBe(true);
    expect(failures).toBeGreaterThan(1);
  });

  it.each(DURABILITY_FAULTS)(
    'does not publish a pending catalog across $name and restart retries the journal',
    async ({ kind, message }) => {
      let injectedFailures = 0;
      let exhaustedBoundaries = false;
      for (let failAt = 1; failAt <= MAX_PERSIST_MUTATIONS; failAt += 1) {
        const fs = new DurableOwnerFs();
        seedLegacy(fs);
        const legacyBefore = snapshotTree(fs, LEGACY_PREFIX);
        const indexBefore = legacyIndexBytes(fs);
        fs.sealDurableState();
        fs.armPersistFailure(failAt, kind);

        const outcome = await openAuthority(fs, { legacyWorkspacePrefix: LEGACY_PREFIX }).then(
          (opened: MigrationHarness) => ({ kind: 'success' as const, opened }),
          (error: unknown) => ({ kind: 'failed' as const, error }),
        );
        fs.disarmPersistFailure();

        if (outcome.kind === 'success') {
          const injectedButHealed = fs.didInjectFailure;
          if (injectedButHealed) injectedFailures += 1;
          else expect(fs.persistPrimitiveCount).toBeLessThan(failAt);
          expectNoPendingPrimitives(fs);
          expect(outcome.opened.catalog.snapshot()).toEqual(companionSnapshot());
          await outcome.opened.owner.close();
          expectNoPendingPrimitives(fs);
          await proveCatalogBoundaryRestarts(fs.durabilityBoundaries, legacyBefore, indexBefore);
          const restartedFs = fs.restartFromDurableState();
          expectAllLegacySourcesExact(restartedFs, legacyBefore);
          expectLegacyIndexBytes(restartedFs, indexBefore, 'present');
          for (const id of ['scratch', 'project-a', 'project-b'] as const) {
            expect(restartedFs.existsSync(workbenchProjectContainer(id))).toBe(false);
            expectNoUnpromotedStage(restartedFs, id);
          }
          const reopened = await openAuthority(restartedFs);
          expect(reopened.catalog.snapshot()).toEqual(companionSnapshot());
          expect(readMigrationJournal(restartedFs)).toEqual(pendingJournal());
          await reopened.owner.close();
          expectNoPendingPrimitives(restartedFs);
          if (injectedButHealed) continue;
          exhaustedBoundaries = true;
          break;
        }

        injectedFailures += 1;
        expect(fs.didInjectFailure).toBe(true);
        expect(String(outcome.error)).toMatch(message);
        expect(snapshotTree(fs, LEGACY_PREFIX)).toEqual(legacyBefore);
        await proveCatalogBoundaryRestarts(fs.durabilityBoundaries, legacyBefore, indexBefore);

        const restartedFs = fs.restartFromDurableState();
        expectAllLegacySourcesExact(restartedFs, legacyBefore);
        expectLegacyIndexBytes(restartedFs, indexBefore, 'present');
        for (const id of ['scratch', 'project-a', 'project-b'] as const) {
          expect(restartedFs.existsSync(workbenchProjectContainer(id))).toBe(false);
          expectNoUnpromotedStage(restartedFs, id);
        }
        const recovered = await openAuthority(restartedFs, {
          legacyWorkspacePrefix: LEGACY_PREFIX,
        });
        expect(recovered.catalog.snapshot()).toEqual(companionSnapshot());
        expectAllLegacySourcesExact(restartedFs, legacyBefore);
        await recovered.owner.close();
        expectNoPendingPrimitives(restartedFs);
        const provedDurable = restartedFs.restartFromDurableState();
        const reopened = await openAuthority(provedDurable);
        expect(reopened.catalog.snapshot()).toEqual(companionSnapshot());
        expect(readMigrationJournal(provedDurable)).toEqual(pendingJournal());
        expectAllLegacySourcesExact(provedDurable, legacyBefore);
        expectLegacyIndexBytes(provedDurable, indexBefore, 'present');
        await reopened.owner.close();
        expectNoPendingPrimitives(provedDurable);
      }

      expect(exhaustedBoundaries).toBe(true);
      expect(injectedFailures).toBeGreaterThan(0);
    },
  );

  describe.each(DURABILITY_FAULTS)('$name during lazy adoption', ({ kind, message }) => {
    it.each([
      {
        name: 'first ref covers journal/copy/promote/mark/source-cleanup',
        id: 'project-a' as const,
        starterId: 'starter-a',
        prepareLastRef: false,
        includesTombstone: false,
      },
      {
        name: 'last ref additionally covers the legacy-index tombstone',
        id: 'project-b' as const,
        starterId: 'starter-b',
        prepareLastRef: true,
        includesTombstone: true,
      },
    ])('$name', async ({ id, starterId, prepareLastRef, includesTombstone }) => {
      let injectedFailures = 0;
      let successfulBoundaries: readonly DurablePersistBoundary[] = [];
      let successfulIndexBytes: Uint8Array | null = null;
      let exhaustedBoundaries = false;

      for (let failAt = 1; failAt <= MAX_PERSIST_MUTATIONS; failAt += 1) {
        const fs = new DurableOwnerFs();
        seedLegacy(fs);
        fs.sealDurableState();
        const h = await openAuthority(fs, { legacyWorkspacePrefix: LEGACY_PREFIX });
        if (prepareLastRef) await prepareLastLegacyRef(h);
        const indexBefore = legacyIndexBytes(fs);
        const sourceBefore = snapshotTree(fs, legacyRoot(id));
        const unrelatedSourcesBefore = snapshotExistingLegacySources(fs, id);
        const publicBefore = h.catalog.snapshot();
        const observed: PlaygroundCatalogSnapshot[] = [];
        const unsubscribe = h.catalog.subscribe((snapshot: PlaygroundCatalogSnapshot) =>
          observed.push(snapshot),
        );
        fs.armPersistFailure(failAt, kind);

        const outcome = await h.owner.openProject(definition(id, starterId)).then(
          async (opened: OpenedMigrationProject) => {
            await opened.close();
            return { kind: 'success' as const };
          },
          (error: unknown) => ({ kind: 'failed' as const, error }),
        );
        fs.disarmPersistFailure();
        unsubscribe();

        if (outcome.kind === 'success') {
          const injectedButHealed = fs.didInjectFailure;
          if (injectedButHealed) injectedFailures += 1;
          else expect(fs.persistPrimitiveCount).toBeLessThan(failAt);
          expectNoPendingPrimitives(fs);
          expect(snapshotTree(fs, workbenchProjectRoot(id))).toEqual(expectedAdoptedTree(id));
          expect(fs.existsSync(legacyRoot(id))).toBe(false);
          expectLegacyIndexBytes(fs, indexBefore, includesTombstone ? 'tombstoned' : 'present');
          expectNoUnpromotedStage(fs, id);
          const completedBoundaries = fs.durabilityBoundaries;
          if (!injectedButHealed) {
            successfulBoundaries = completedBoundaries;
            successfulIndexBytes = indexBefore.slice();
          }
          await h.owner.close();
          expectNoPendingPrimitives(fs);
          await proveAdoptionBoundaryRestarts(
            completedBoundaries,
            id,
            starterId,
            publicBefore,
            indexBefore,
            includesTombstone,
            unrelatedSourcesBefore,
          );

          const restartedFs = fs.restartFromDurableState();
          const reopened = await openAuthority(restartedFs);
          expect(reopened.catalog.snapshot()).toEqual(publicBefore);
          const reopenedProject = await reopened.owner.openProject(definition(id, starterId));
          expect(reopenedProject.projectRoot).toBe(workbenchProjectRoot(id));
          expect(snapshotTree(restartedFs, reopenedProject.projectRoot)).toEqual(
            expectedAdoptedTree(id),
          );
          await reopenedProject.close();
          expect(restartedFs.existsSync(legacyRoot(id))).toBe(false);
          expectLegacyIndexBytes(
            restartedFs,
            indexBefore,
            includesTombstone ? 'tombstoned' : 'present',
          );
          expectLegacySourcesExact(restartedFs, unrelatedSourcesBefore);
          expectNoUnpromotedStage(restartedFs, id);
          await reopened.owner.close();
          expectNoPendingPrimitives(restartedFs);
          if (injectedButHealed) continue;
          exhaustedBoundaries = true;
          break;
        }

        injectedFailures += 1;
        expect(fs.didInjectFailure).toBe(true);
        expect(String(outcome.error)).toMatch(message);
        expect(observed.length).toBeGreaterThan(0);
        for (const snapshot of observed) expect(snapshot).toEqual(publicBefore);
        await proveAdoptionBoundaryRestarts(
          fs.durabilityBoundaries,
          id,
          starterId,
          publicBefore,
          indexBefore,
          includesTombstone,
          unrelatedSourcesBefore,
        );

        const restartedFs = fs.restartFromDurableState();
        if (restartedFs.existsSync(legacyRoot(id))) {
          expect(snapshotTree(restartedFs, legacyRoot(id))).toEqual(sourceBefore);
        } else {
          expect(snapshotTree(restartedFs, workbenchProjectRoot(id))).toEqual(
            expectedAdoptedTree(id),
          );
          const durableRef = journalRefFromTree(snapshotExactFsTree(restartedFs), id);
          expect(
            durableRef?.phase.kind === 'source-cleanup' || durableRef?.phase.kind === 'adopted',
            'source may disappear only after the adopted catalog mark is durable',
          ).toBe(true);
          const catalogProof = storedAdoption(readStoredCatalog(restartedFs), id);
          expect(catalogProof.kind, 'source removal requires a durable catalog mark').toBe(
            'adopted',
          );
        }
        if (restartedFs.existsSync(LEGACY_INDEX)) {
          expectLegacyIndexBytes(restartedFs, indexBefore, 'present');
        } else {
          expect(includesTombstone).toBe(true);
          expect(allStoredRefsAdopted(readStoredCatalog(restartedFs))).toBe(true);
        }

        const recovered = await openAuthority(restartedFs, {
          legacyWorkspacePrefix: LEGACY_PREFIX,
        });
        expect(recovered.catalog.snapshot()).toEqual(publicBefore);
        const recoveredRoot = await adopt(recovered, id, starterId);
        expect(recoveredRoot).toBe(workbenchProjectRoot(id));
        expect(snapshotTree(restartedFs, recoveredRoot)).toEqual(expectedAdoptedTree(id));
        expect(restartedFs.existsSync(legacyRoot(id))).toBe(false);
        expectLegacyIndexBytes(
          restartedFs,
          indexBefore,
          includesTombstone ? 'tombstoned' : 'present',
        );
        expectLegacySourcesExact(restartedFs, unrelatedSourcesBefore);
        expectNoUnpromotedStage(restartedFs, id);
        await recovered.owner.close();
        expectNoPendingPrimitives(restartedFs);
        const provedDurable = restartedFs.restartFromDurableState();
        const reopened = await openAuthority(provedDurable);
        const reopenedRoot = await adopt(reopened, id, starterId);
        expect(snapshotTree(provedDurable, reopenedRoot)).toEqual(expectedAdoptedTree(id));
        expectLegacySourcesExact(provedDurable, unrelatedSourcesBefore);
        expectLegacyIndexBytes(
          provedDurable,
          indexBefore,
          includesTombstone ? 'tombstoned' : 'present',
        );
        expectNoUnpromotedStage(provedDurable, id);
        await reopened.owner.close();
        expectNoPendingPrimitives(provedDurable);
      }

      expect(exhaustedBoundaries).toBe(true);
      expect(injectedFailures).toBeGreaterThanOrEqual(3);
      if (successfulIndexBytes === null) throw new Error('missing successful index sentinel');
      assertAdoptionDurabilityPhaseOrder(
        successfulBoundaries,
        id,
        includesTombstone,
        successfulIndexBytes,
      );
    });
  });
});

class CrashableMemoryFsSync extends MemoryFsSync {
  #failAt = Number.POSITIVE_INFINITY;
  #armed = false;
  mutationCount = 0;

  arm(failAt: number): void {
    this.#failAt = failAt;
    this.#armed = true;
    this.mutationCount = 0;
  }

  disarm(): void {
    this.#armed = false;
  }

  #beforeMutation(operation: string): void {
    if (!this.#armed) return;
    this.mutationCount += 1;
    if (this.mutationCount === this.#failAt) {
      throw new Error(`injected legacy migration crash before ${operation}`);
    }
  }

  override writeFileSync(path: string, data: Uint8Array): void {
    this.#beforeMutation(`write ${path}`);
    super.writeFileSync(path, data);
  }

  override mkdirSync(path: string, options: { recursive?: boolean }): void {
    this.#beforeMutation(`mkdir ${path}`);
    super.mkdirSync(path, options);
  }

  override rmSync(path: string, options: { recursive?: boolean; force?: boolean }): void {
    this.#beforeMutation(`rm ${path}`);
    super.rmSync(path, options);
  }

  override utimes(path: string, atimeMs: number, mtimeMs: number): void {
    this.#beforeMutation(`utimes ${path}`);
    super.utimes(path, atimeMs, mtimeMs);
  }

  override copyFileSync(source: string, target: string): void {
    this.#beforeMutation(`copy ${source} -> ${target}`);
    super.copyFileSync(source, target);
  }

  override cpSync(source: string, target: string, options: { recursive?: boolean } = {}): void {
    this.#beforeMutation(`cp ${source} -> ${target}`);
    super.cpSync(source, target, options);
  }

  override renameSync(source: string, target: string): void {
    this.#beforeMutation(`rename ${source} -> ${target}`);
    super.renameSync(source, target);
  }
}
