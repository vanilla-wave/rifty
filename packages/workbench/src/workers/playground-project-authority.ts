import { dirname } from '@riftydev/vfs';
import type { InstallStampClaimIo } from '../glue/install-stamp-authority.ts';
import { ProjectBusyError, ProjectDefinitionMismatchError } from '../workbench/errors.ts';
import {
  type CapturedPlaygroundUrlContext,
  type InspectedPlaygroundProjectDefinition,
  inspectPlaygroundProjectDefinition,
  playgroundProjectDefinitionScope,
} from '../workbench/internal/playground-project-definition.ts';
import {
  ownProjectTerminalSnapshot,
  projectTerminalStateFromOwner,
  projectTerminalStateToOwner,
} from '../workbench/internal/playground-terminal-state.ts';
import type {
  PlaygroundCatalogSnapshot,
  PlaygroundProjectCatalog,
  PlaygroundProjectRef,
} from '../workbench/playground.ts';
import { createProjectAcquisitionWaiterScope } from '../workbench/project-acquisition-waiters.ts';
import { projectStorageSegment } from '../workbench/project-definition.ts';
import type {
  ProjectAcquisitionOptions,
  ProjectAcquisitionPlan,
  ProjectAcquisitionPort,
} from '../workbench/project-materialization.ts';
import type { ProjectTerminalSnapshot } from '../workbench/project-terminal-state.ts';
import type { ProjectDefinition } from '../workbench/public.ts';
import { type OwnerVfsAuthority, ownerVfsScopeHasFailure } from './owner-vfs-authority.ts';

const WORKBENCH_ROOT = '/.rifty/workbench/v1';
const PROJECTS_ROOT = `${WORKBENCH_ROOT}/projects`;
const STAGES_ROOT = `${WORKBENCH_ROOT}/stages`;
const PLAYGROUND_ROOT = '/.rifty/workbench/playground';
const CATALOG_FILE = `${PLAYGROUND_ROOT}/catalog.json`;
const MIGRATION_JOURNAL_FILE = `${PLAYGROUND_ROOT}/migration-journal.json`;
const TRANSACTION_FILE = `${PLAYGROUND_ROOT}/transaction.json`;
const CATALOG_TRANSACTIONS_ROOT = `${PLAYGROUND_ROOT}/catalog-transactions`;
const MIGRATION_INTENTS_ROOT = `${PLAYGROUND_ROOT}/migration-intents`;
const MANAGED_PARENT_PATHS = Object.freeze([
  CATALOG_TRANSACTIONS_ROOT,
  STAGES_ROOT,
  PROJECTS_ROOT,
  WORKBENCH_ROOT,
  PLAYGROUND_ROOT,
  '/.rifty/workbench',
  '/.rifty',
]);
const PROMOTION_MARKER = 'migration-promotion.json';
const LEGACY_INDEX_NAME = '.rifty-project-index.json';
const INSTALL_CLAIM_NAME = '.rifty-install-stamp.json';
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

type CatalogAdoption =
  | { readonly kind: 'pending-adoption'; readonly sourceRoot: string }
  | {
      readonly kind: 'adopted';
      readonly definitionIdentity: string;
      readonly baselineFingerprint: string;
    };

interface StoredScratch {
  readonly starterId: string;
  readonly dirty: boolean;
  readonly editedAt: string;
  readonly adoption: CatalogAdoption;
}

interface StoredProject {
  readonly id: string;
  readonly name: string;
  readonly starterId: string;
  readonly editedAt: string;
  readonly adoption: CatalogAdoption;
}

interface StoredCatalog {
  readonly version: 1;
  readonly active: PlaygroundProjectRef | null;
  readonly scratch: StoredScratch | null;
  readonly projects: readonly StoredProject[];
}

type MigrationPhase =
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

interface MigrationRef {
  readonly kind: 'scratch' | 'project';
  readonly id: string;
  readonly starterId: string;
  readonly sourceRoot: string;
  readonly phase: MigrationPhase;
}

interface MigrationJournal {
  readonly version: 1;
  readonly legacyWorkspacePrefix: string;
  readonly refs: readonly MigrationRef[];
}

interface TreeImageFile {
  readonly path: string;
  readonly bytes: readonly number[];
}

interface TreeImage {
  readonly directories: readonly string[];
  readonly files: readonly TreeImageFile[];
}

interface TransactionRoot {
  readonly path: string;
  readonly before: TreeImage | null;
  readonly after: TreeImage | null;
}

interface InlineCatalogMutationTransaction {
  readonly version: 1;
  readonly kind: 'catalog-mutation';
  readonly phase: 'apply' | 'commit';
  readonly beforeCatalog: StoredCatalog | null;
  readonly afterCatalog: StoredCatalog;
  readonly roots: readonly TransactionRoot[];
}

type StagedCatalogMutation =
  | {
      readonly role: 'create' | 'replace' | 'remove';
      readonly id: string;
    }
  | {
      readonly role: 'convert-scratch';
      readonly id: string;
      readonly definitionIdentity: string;
    };

interface StagedCatalogMutationTransaction {
  readonly version: 2;
  readonly kind: 'catalog-mutation';
  readonly txId: string;
  readonly phase: 'prepared' | 'catalog-committed';
  readonly beforeCatalog: StoredCatalog | null;
  readonly afterCatalog: StoredCatalog;
  readonly mutations: readonly StagedCatalogMutation[];
}

type CatalogMutationTransaction =
  | InlineCatalogMutationTransaction
  | StagedCatalogMutationTransaction;

interface LegacyPublicationTransaction {
  readonly version: 1;
  readonly kind: 'legacy-publication';
  readonly catalog: StoredCatalog;
  readonly journal: MigrationJournal;
}

type DurableTransaction = CatalogMutationTransaction | LegacyPublicationTransaction;

type CatalogMutationPlan =
  | {
      readonly role: 'create' | 'replace';
      readonly id: string;
      readonly after: TreeImage;
    }
  | {
      readonly role: 'remove';
      readonly id: string;
    }
  | {
      readonly role: 'convert-scratch';
      readonly id: string;
      readonly definitionIdentity: string;
    };

interface LegacyIndexScratch {
  readonly starter: string;
  readonly dirty: boolean;
  readonly editedAt: string;
}

interface LegacyIndexProject {
  readonly id: string;
  readonly name: string;
  readonly starter: string;
  readonly editedAt: string;
}

interface LegacyIndex {
  readonly activeId: string;
  readonly scratch: LegacyIndexScratch | null;
  readonly projects: readonly LegacyIndexProject[];
}

export type PlaygroundProjectMutationKind =
  | 'guest'
  | 'scm'
  | 'archive'
  | 'file'
  | 'package-manifest'
  | 'package-lock'
  | 'seed'
  | 'dependency'
  | 'reserved-authority';

export interface OpenedPlaygroundProject {
  readonly projectKey: string;
  readonly projectRoot: string;
  readonly acquisition: ProjectAcquisitionPlan;
  readonly initialTerminalState?: ProjectTerminalSnapshot;
  close(): Promise<void>;
}

export interface PlaygroundProjectAuthorityOptions {
  readonly authority: OwnerVfsAuthority;
  readonly installStampClaims: InstallStampClaimIo;
  readonly persistence: 'required' | 'preferred' | 'ephemeral';
  readonly legacyWorkspacePrefix?: string;
  readonly now: () => string;
  readonly createStageId: () => string;
  readonly acquisition: ProjectAcquisitionPort<ProjectAcquisitionPlan>;
}

export interface PlaygroundProjectAuthority {
  catalogSnapshot(): PlaygroundCatalogSnapshot;
  subscribeCatalog(listener: (snapshot: PlaygroundCatalogSnapshot) => void): () => void;
  createScratch(
    input: Parameters<PlaygroundProjectCatalog['createScratch']>[0],
  ): Promise<PlaygroundCatalogSnapshot>;
  saveScratch(
    input: Parameters<PlaygroundProjectCatalog['saveScratch']>[0],
  ): Promise<PlaygroundCatalogSnapshot>;
  activate(target: PlaygroundProjectRef): Promise<PlaygroundCatalogSnapshot>;
  rename(id: string, name: string): Promise<PlaygroundCatalogSnapshot>;
  reset(
    input: Parameters<PlaygroundProjectCatalog['reset']>[0],
  ): Promise<PlaygroundCatalogSnapshot>;
  delete(id: string): Promise<PlaygroundCatalogSnapshot>;
  deleteProject(id: string): Promise<void>;
  openProject(
    definition: ProjectDefinition<unknown>,
    initialTerminalState?: ProjectTerminalSnapshot,
    options?: ProjectAcquisitionOptions,
  ): Promise<OpenedPlaygroundProject>;
  recordMutation(input: {
    readonly kind: PlaygroundProjectMutationKind;
    readonly project: OpenedPlaygroundProject;
    readonly treeRevision: number;
  }): Promise<void>;
  treeRevision(): number;
  /** Owner-local shutdown fence; leaves catalog state untouched. */
  cancelActiveAcquisition(reason?: unknown): void;
  close(): Promise<void>;
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function pathDepth(path: string): number {
  return path === '' ? 0 : path.split('/').length;
}

function ownKeys(value: object): readonly string[] {
  return Object.keys(value).sort(compareCodeUnits);
}

function exactObject(
  value: unknown,
  expected: readonly string[],
  label: string,
): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const record = value as Readonly<Record<string, unknown>>;
  const actual = ownKeys(record);
  const wanted = [...expected].sort(compareCodeUnits);
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new TypeError(`${label} has invalid keys`);
  }
  return record;
}

function nonEmpty(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) {
    throw new TypeError(`${label} must be a non-empty NUL-free string`);
  }
  return value;
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${label} must be boolean`);
  return value;
}

function jsonBytes(value: unknown): Uint8Array {
  return encoder.encode(`${JSON.stringify(value, null, 2)}\n`);
}

function parseJsonBytes(bytes: Uint8Array, label: string): unknown {
  try {
    return JSON.parse(decoder.decode(bytes));
  } catch (error) {
    throw new TypeError(
      `${label} is unreadable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function readJson(authority: OwnerVfsAuthority, path: string, label: string): unknown {
  return parseJsonBytes(authority.readFileBytesSync(path), label);
}

function ensureParent(authority: OwnerVfsAuthority, path: string): void {
  authority.mkdirSync(dirname(path), { recursive: true });
}

function writeJson(authority: OwnerVfsAuthority, path: string, value: unknown): void {
  ensureParent(authority, path);
  authority.writeFileSync(path, jsonBytes(value));
}

function isDirectory(authority: OwnerVfsAuthority, path: string): boolean {
  return authority.statSyncOrNull(path)?.isDirectory === true;
}

function isFile(authority: OwnerVfsAuthority, path: string): boolean {
  return authority.statSyncOrNull(path)?.isFile === true;
}

function projectContainer(id: string): string {
  return `${PROJECTS_ROOT}/${projectStorageSegment(id)}`;
}

function stageContainer(id: string, stageId: string): string {
  return `${STAGES_ROOT}/${projectStorageSegment(id)}/${stageId}`;
}

function catalogTransactionRoot(txId: string): string {
  return `${CATALOG_TRANSACTIONS_ROOT}/${validateStageId(txId)}`;
}

function catalogMutationStage(
  transaction: StagedCatalogMutationTransaction,
  index: number,
  kind: 'before' | 'after',
): string {
  const mutation = transaction.mutations[index];
  if (mutation === undefined) throw new TypeError(`Catalog mutation ${String(index)} is absent`);
  return `${catalogTransactionRoot(transaction.txId)}/${String(index)}-${projectStorageSegment(mutation.id)}/${kind}`;
}

function catalogTransactionPreparedMarker(transaction: StagedCatalogMutationTransaction): string {
  return `${catalogTransactionRoot(transaction.txId)}/prepared.json`;
}

function migrationCopyIntent(id: string): string {
  return `${MIGRATION_INTENTS_ROOT}/${projectStorageSegment(id)}.copy`;
}

function migrationPromoteIntent(id: string): string {
  return `${MIGRATION_INTENTS_ROOT}/${projectStorageSegment(id)}.promote`;
}

function migrationCatalogMarkIntent(id: string): string {
  return `${MIGRATION_INTENTS_ROOT}/${projectStorageSegment(id)}.catalog-mark`;
}

function validateStageId(value: string): string {
  if (typeof value !== 'string' || value.length === 0 || !/^[A-Za-z0-9-]+$/.test(value)) {
    throw new TypeError('Playground migration stage id must be an alphanumeric token');
  }
  return value;
}

function metadataImage(id: string, identity: string, tree: TreeImage): TreeImage {
  const key = projectStorageSegment(id);
  const metadata = {
    version: 1,
    projectKey: key,
    definitionIdentity: nonEmpty(identity, 'definition identity'),
  } as const;
  const files = tree.files.filter((file) => file.path !== 'definition.json');
  return Object.freeze({
    directories: Object.freeze(
      [...new Set(['', 'tree', ...tree.directories])].sort(
        (left, right) => pathDepth(left) - pathDepth(right) || compareCodeUnits(left, right),
      ),
    ),
    files: Object.freeze([
      Object.freeze({ path: 'definition.json', bytes: Object.freeze([...jsonBytes(metadata)]) }),
      ...files,
    ]),
  });
}

function definitionTree(id: string, definition: InspectedPlaygroundProjectDefinition): TreeImage {
  const directories = new Set<string>(['', 'tree']);
  const files: TreeImageFile[] = [];
  for (const path of Object.keys(definition.files).sort(compareCodeUnits)) {
    const bytes = definition.files[path];
    if (bytes === undefined) continue;
    const relative = `tree${path}`;
    let parent = dirname(relative);
    while (parent !== '.' && parent !== '') {
      directories.add(parent);
      parent = dirname(parent);
    }
    files.push(Object.freeze({ path: relative, bytes: Object.freeze([...bytes]) }));
  }
  return metadataImage(
    id,
    definition.identity,
    Object.freeze({ directories: Object.freeze([...directories]), files: Object.freeze(files) }),
  );
}

function captureTree(
  authority: OwnerVfsAuthority,
  root: string,
  include: (relativePath: string, kind: 'file' | 'directory') => boolean = () => true,
): TreeImage | null {
  const rootStat = authority.statSyncOrNull(root);
  if (rootStat === null) return null;
  if (!rootStat.isDirectory) throw new TypeError(`Managed tree is not a directory: ${root}`);
  const directories = new Set<string>(['']);
  const files: TreeImageFile[] = [];
  const walk = (directory: string, relativeDirectory: string): void => {
    const children = [...authority.readdirSync(directory)].sort((left, right) =>
      compareCodeUnits(left.name, right.name),
    );
    for (const child of children) {
      const path = `${directory}/${child.name}`;
      const relative = relativeDirectory === '' ? child.name : `${relativeDirectory}/${child.name}`;
      if (child.isDirectory) {
        if (!include(relative, 'directory')) continue;
        directories.add(relative);
        walk(path, relative);
      } else if (include(relative, 'file')) {
        files.push(
          Object.freeze({
            path: relative,
            bytes: Object.freeze([...authority.readFileBytesSync(path)]),
          }),
        );
      }
    }
  };
  walk(root, '');
  return Object.freeze({
    directories: Object.freeze(
      [...directories].sort(
        (left, right) => pathDepth(left) - pathDepth(right) || compareCodeUnits(left, right),
      ),
    ),
    files: Object.freeze(files.sort((left, right) => compareCodeUnits(left.path, right.path))),
  });
}

function claimRootForRelative(root: string, relative: string): string {
  const absolute = `${root}/${relative}`;
  return dirname(dirname(absolute));
}

function isInstallClaimRelative(relative: string): boolean {
  const segments = relative.split('/');
  return segments.at(-1) === INSTALL_CLAIM_NAME && segments.at(-2) === 'node_modules';
}

function removeClaims(
  authority: OwnerVfsAuthority,
  claims: InstallStampClaimIo,
  root: string,
): void {
  if (!isDirectory(authority, root)) return;
  const claimRoots: string[] = [];
  const walk = (directory: string): void => {
    for (const child of authority.readdirSync(directory)) {
      const path = `${directory}/${child.name}`;
      if (child.isDirectory) walk(path);
      else if (
        child.name === INSTALL_CLAIM_NAME &&
        directory.split('/').at(-1) === 'node_modules'
      ) {
        claimRoots.push(dirname(directory));
      }
    }
  };
  walk(root);
  claimRoots.sort((left, right) => pathDepth(right) - pathDepth(left));
  for (const claimRoot of claimRoots) claims.remove(claimRoot);
}

function removeManagedTree(
  authority: OwnerVfsAuthority,
  claims: InstallStampClaimIo,
  root: string,
): void {
  removeClaims(authority, claims, root);
  authority.rmSync(root, { recursive: true, force: true });
}

function applyTree(
  authority: OwnerVfsAuthority,
  claims: InstallStampClaimIo,
  root: string,
  image: TreeImage | null,
): void {
  removeManagedTree(authority, claims, root);
  if (image === null) return;
  authority.mkdirSync(root, { recursive: true });
  for (const relative of image.directories) {
    if (relative !== '') authority.mkdirSync(`${root}/${relative}`, { recursive: true });
  }
  for (const file of image.files) {
    const target = `${root}/${file.path}`;
    const bytes = new Uint8Array(file.bytes);
    if (isInstallClaimRelative(file.path)) {
      claims.write(claimRootForRelative(root, file.path), bytes, { mkdirTree: true });
    } else {
      authority.mkdirSync(dirname(target), { recursive: true });
      authority.writeFileSync(target, bytes);
    }
  }
}

function legacyTree(authority: OwnerVfsAuthority, sourceRoot: string): TreeImage {
  const source = captureTree(authority, sourceRoot, (relative, kind) => {
    const segments = relative.split('/');
    if (segments[0] === '.rifty') return false;
    if (segments.includes('node_modules')) return false;
    if (kind === 'file' && isInstallClaimRelative(relative)) return false;
    return true;
  });
  if (source === null) throw new TypeError(`Legacy migration source is missing: ${sourceRoot}`);
  const retainedDirectories = new Set<string>(['']);
  for (const file of source.files) {
    let parent = dirname(file.path);
    while (parent !== '.' && parent !== '') {
      retainedDirectories.add(parent);
      parent = dirname(parent);
    }
  }
  return Object.freeze({
    directories: Object.freeze(
      [
        ...new Set([
          '',
          'tree',
          ...[...retainedDirectories].map((path) => (path ? `tree/${path}` : 'tree')),
        ]),
      ].sort((left, right) => pathDepth(left) - pathDepth(right) || compareCodeUnits(left, right)),
    ),
    files: Object.freeze(
      source.files.map((file) =>
        Object.freeze({ path: `tree/${file.path}`, bytes: Object.freeze([...file.bytes]) }),
      ),
    ),
  });
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function imageMatches(
  authority: OwnerVfsAuthority,
  root: string,
  expected: TreeImage,
  allowSubset: boolean,
): boolean {
  const actual = captureTree(authority, root);
  if (actual === null) return false;
  const expectedDirs = new Set(expected.directories);
  const expectedFiles = new Map(
    expected.files.map((file) => [file.path, new Uint8Array(file.bytes)]),
  );
  if (actual.directories.some((path) => !expectedDirs.has(path))) return false;
  for (const file of actual.files) {
    const bytes = expectedFiles.get(file.path);
    if (bytes === undefined || !bytesEqual(new Uint8Array(file.bytes), bytes)) return false;
  }
  if (allowSubset) return true;
  return (
    actual.directories.length === expected.directories.length &&
    actual.files.length === expected.files.length
  );
}

function parseAdoption(value: unknown, label: string): CatalogAdoption {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const kind = (value as Readonly<Record<string, unknown>>).kind;
  if (kind === 'pending-adoption') {
    const record = exactObject(value, ['kind', 'sourceRoot'], label);
    return Object.freeze({
      kind,
      sourceRoot: nonEmpty(record.sourceRoot, `${label}.sourceRoot`),
    });
  }
  if (kind === 'adopted') {
    const record = exactObject(value, ['kind', 'definitionIdentity', 'baselineFingerprint'], label);
    return Object.freeze({
      kind,
      definitionIdentity: nonEmpty(record.definitionIdentity, `${label}.definitionIdentity`),
      baselineFingerprint: nonEmpty(record.baselineFingerprint, `${label}.baselineFingerprint`),
    });
  }
  throw new TypeError(`${label}.kind is invalid`);
}

function parseActive(value: unknown, label: string): PlaygroundProjectRef | null {
  if (value === null) return null;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be null or an object`);
  }
  const kind = (value as Readonly<Record<string, unknown>>).kind;
  if (kind === 'scratch') {
    exactObject(value, ['kind'], label);
    return Object.freeze({ kind });
  }
  if (kind === 'project') {
    const record = exactObject(value, ['kind', 'id'], label);
    return Object.freeze({ kind, id: nonEmpty(record.id, `${label}.id`) });
  }
  throw new TypeError(`${label}.kind is invalid`);
}

function parseStoredCatalog(value: unknown): StoredCatalog {
  const catalog = exactObject(value, ['version', 'active', 'scratch', 'projects'], 'catalog');
  if (catalog.version !== 1) throw new TypeError('catalog.version must be 1');
  const active = parseActive(catalog.active, 'catalog.active');
  let scratch: StoredScratch | null = null;
  if (catalog.scratch !== null) {
    const value = exactObject(
      catalog.scratch,
      ['starterId', 'dirty', 'editedAt', 'adoption'],
      'catalog.scratch',
    );
    scratch = Object.freeze({
      starterId: nonEmpty(value.starterId, 'catalog.scratch.starterId'),
      dirty: booleanValue(value.dirty, 'catalog.scratch.dirty'),
      editedAt: nonEmpty(value.editedAt, 'catalog.scratch.editedAt'),
      adoption: parseAdoption(value.adoption, 'catalog.scratch.adoption'),
    });
  }
  if (!Array.isArray(catalog.projects)) throw new TypeError('catalog.projects must be an array');
  const ids = new Set<string>();
  const projects = catalog.projects.map((entry, index): StoredProject => {
    const value = exactObject(
      entry,
      ['id', 'name', 'starterId', 'editedAt', 'adoption'],
      `catalog.projects[${String(index)}]`,
    );
    const id = nonEmpty(value.id, `catalog.projects[${String(index)}].id`);
    if (id === 'scratch' || ids.has(id))
      throw new TypeError(`catalog project id is invalid: ${id}`);
    ids.add(id);
    return Object.freeze({
      id,
      name: nonEmpty(value.name, `catalog.projects[${String(index)}].name`),
      starterId: nonEmpty(value.starterId, `catalog.projects[${String(index)}].starterId`),
      editedAt: nonEmpty(value.editedAt, `catalog.projects[${String(index)}].editedAt`),
      adoption: parseAdoption(value.adoption, `catalog.projects[${String(index)}].adoption`),
    });
  });
  if (active?.kind === 'scratch' && scratch === null) {
    throw new TypeError('catalog active Scratch is absent');
  }
  if (active?.kind === 'project' && !ids.has(active.id)) {
    throw new TypeError(`catalog active project is absent: ${active.id}`);
  }
  return Object.freeze({
    version: 1,
    active,
    scratch,
    projects: Object.freeze(projects),
  });
}

function publicSnapshot(catalog: StoredCatalog): PlaygroundCatalogSnapshot {
  return Object.freeze({
    active:
      catalog.active === null
        ? null
        : catalog.active.kind === 'scratch'
          ? Object.freeze({ kind: 'scratch' as const })
          : Object.freeze({ kind: 'project' as const, id: catalog.active.id }),
    scratch:
      catalog.scratch === null
        ? null
        : Object.freeze({
            starterId: catalog.scratch.starterId,
            dirty: catalog.scratch.dirty,
            editedAt: catalog.scratch.editedAt,
          }),
    projects: Object.freeze(
      catalog.projects.map((project) =>
        Object.freeze({
          id: project.id,
          name: project.name,
          starterId: project.starterId,
          editedAt: project.editedAt,
        }),
      ),
    ),
  });
}

function emptyCatalog(): StoredCatalog {
  return Object.freeze({ version: 1, active: null, scratch: null, projects: Object.freeze([]) });
}

function parseMigrationPhase(value: unknown, label: string): MigrationPhase {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const kind = (value as Readonly<Record<string, unknown>>).kind;
  if (kind === 'pending') {
    exactObject(value, ['kind'], label);
    return Object.freeze({ kind });
  }
  if (kind === 'adopted') {
    const record = exactObject(value, ['kind', 'definitionIdentity', 'baselineFingerprint'], label);
    return Object.freeze({
      kind,
      definitionIdentity: nonEmpty(record.definitionIdentity, `${label}.definitionIdentity`),
      baselineFingerprint: nonEmpty(record.baselineFingerprint, `${label}.baselineFingerprint`),
    });
  }
  if (kind === 'copy' || kind === 'promote' || kind === 'mark' || kind === 'source-cleanup') {
    const record = exactObject(
      value,
      ['kind', 'stageId', 'definitionIdentity', 'baselineFingerprint'],
      label,
    );
    return Object.freeze({
      kind,
      stageId: validateStageId(nonEmpty(record.stageId, `${label}.stageId`)),
      definitionIdentity: nonEmpty(record.definitionIdentity, `${label}.definitionIdentity`),
      baselineFingerprint: nonEmpty(record.baselineFingerprint, `${label}.baselineFingerprint`),
    });
  }
  throw new TypeError(`${label}.kind is invalid`);
}

function parseMigrationJournal(value: unknown): MigrationJournal {
  const journal = exactObject(
    value,
    ['version', 'legacyWorkspacePrefix', 'refs'],
    'legacy migration journal',
  );
  if (journal.version !== 1) throw new TypeError('legacy migration journal version is invalid');
  const legacyWorkspacePrefix = nonEmpty(
    journal.legacyWorkspacePrefix,
    'legacy migration journal prefix',
  );
  if (!Array.isArray(journal.refs)) throw new TypeError('legacy migration journal refs is invalid');
  const ids = new Set<string>();
  const refs = journal.refs.map((entry, index): MigrationRef => {
    const record = exactObject(
      entry,
      ['kind', 'id', 'starterId', 'sourceRoot', 'phase'],
      `legacy migration journal ref ${String(index)}`,
    );
    if (record.kind !== 'scratch' && record.kind !== 'project') {
      throw new TypeError(`legacy migration journal ref ${String(index)} kind is invalid`);
    }
    const id = nonEmpty(record.id, `legacy migration journal ref ${String(index)} id`);
    if (ids.has(id)) throw new TypeError(`legacy migration journal duplicate ref: ${id}`);
    ids.add(id);
    return Object.freeze({
      kind: record.kind,
      id,
      starterId: nonEmpty(
        record.starterId,
        `legacy migration journal ref ${String(index)} starterId`,
      ),
      sourceRoot: nonEmpty(
        record.sourceRoot,
        `legacy migration journal ref ${String(index)} sourceRoot`,
      ),
      phase: parseMigrationPhase(
        record.phase,
        `legacy migration journal ref ${String(index)} phase`,
      ),
    });
  });
  return Object.freeze({ version: 1, legacyWorkspacePrefix, refs: Object.freeze(refs) });
}

function parseLegacyIndex(
  value: unknown,
  authority: OwnerVfsAuthority,
  prefix: string,
): LegacyIndex {
  const index = exactObject(value, ['activeId', 'scratch', 'projects'], 'legacy project index');
  const activeId = nonEmpty(index.activeId, 'legacy project index activeId');
  let scratch: LegacyIndexScratch | null = null;
  if (index.scratch !== null) {
    const record = exactObject(
      index.scratch,
      ['starter', 'dirty', 'editedAt'],
      'legacy project index scratch',
    );
    scratch = Object.freeze({
      starter: nonEmpty(record.starter, 'legacy project index scratch starter'),
      dirty: booleanValue(record.dirty, 'legacy project index scratch dirty'),
      editedAt: nonEmpty(record.editedAt, 'legacy project index scratch editedAt'),
    });
  }
  if (!Array.isArray(index.projects))
    throw new TypeError('legacy project index projects is invalid');
  const ids = new Set<string>();
  const projects = index.projects.map((entry, position): LegacyIndexProject => {
    const record = exactObject(
      entry,
      ['id', 'name', 'starter', 'editedAt'],
      `legacy project index project ${String(position)}`,
    );
    const id = nonEmpty(record.id, `legacy project index project ${String(position)} id`);
    if (id === 'scratch' || ids.has(id)) throw new TypeError(`legacy project id is invalid: ${id}`);
    ids.add(id);
    return Object.freeze({
      id,
      name: nonEmpty(record.name, `legacy project index project ${String(position)} name`),
      starter: nonEmpty(record.starter, `legacy project index project ${String(position)} starter`),
      editedAt: nonEmpty(
        record.editedAt,
        `legacy project index project ${String(position)} editedAt`,
      ),
    });
  });
  const scratchRoot = `${prefix}/scratch`;
  if ((scratch !== null) !== isDirectory(authority, scratchRoot)) {
    throw new TypeError('legacy Scratch metadata/tree state disagrees');
  }
  for (const project of projects) {
    if (!isDirectory(authority, `${prefix}/projects/${project.id}`)) {
      throw new TypeError(`legacy project source is missing: ${project.id}`);
    }
  }
  if (activeId === 'scratch') {
    if (scratch === null) throw new TypeError('legacy active Scratch metadata is absent');
  } else if (!ids.has(activeId)) {
    throw new TypeError(`legacy active project is absent: ${activeId}`);
  }
  return Object.freeze({ activeId, scratch, projects: Object.freeze(projects) });
}

function legacyCatalog(index: LegacyIndex, prefix: string): StoredCatalog {
  return Object.freeze({
    version: 1,
    active:
      index.activeId === 'scratch'
        ? Object.freeze({ kind: 'scratch' as const })
        : Object.freeze({ kind: 'project' as const, id: index.activeId }),
    scratch:
      index.scratch === null
        ? null
        : Object.freeze({
            starterId: index.scratch.starter,
            dirty: index.scratch.dirty,
            editedAt: index.scratch.editedAt,
            adoption: Object.freeze({
              kind: 'pending-adoption' as const,
              sourceRoot: `${prefix}/scratch`,
            }),
          }),
    projects: Object.freeze(
      index.projects.map((project) =>
        Object.freeze({
          id: project.id,
          name: project.name,
          starterId: project.starter,
          editedAt: project.editedAt,
          adoption: Object.freeze({
            kind: 'pending-adoption' as const,
            sourceRoot: `${prefix}/projects/${project.id}`,
          }),
        }),
      ),
    ),
  });
}

function legacyJournal(index: LegacyIndex, prefix: string): MigrationJournal {
  const refs: MigrationRef[] = [];
  if (index.scratch !== null) {
    refs.push(
      Object.freeze({
        kind: 'scratch',
        id: 'scratch',
        starterId: index.scratch.starter,
        sourceRoot: `${prefix}/scratch`,
        phase: Object.freeze({ kind: 'pending' }),
      }),
    );
  }
  for (const project of index.projects) {
    refs.push(
      Object.freeze({
        kind: 'project',
        id: project.id,
        starterId: project.starter,
        sourceRoot: `${prefix}/projects/${project.id}`,
        phase: Object.freeze({ kind: 'pending' }),
      }),
    );
  }
  return Object.freeze({ version: 1, legacyWorkspacePrefix: prefix, refs: Object.freeze(refs) });
}

function parseImage(value: unknown, label: string): TreeImage | null {
  if (value === null) return null;
  const record = exactObject(value, ['directories', 'files'], label);
  if (!Array.isArray(record.directories) || !Array.isArray(record.files)) {
    throw new TypeError(`${label} is invalid`);
  }
  const directories = record.directories.map((path, index) =>
    nonEmpty(path === '' ? '__root__' : path, `${label}.directories[${String(index)}]`) ===
    '__root__'
      ? ''
      : (path as string),
  );
  const files = record.files.map((entry, index): TreeImageFile => {
    const file = exactObject(entry, ['path', 'bytes'], `${label}.files[${String(index)}]`);
    const path = nonEmpty(file.path, `${label}.files[${String(index)}].path`);
    if (
      !Array.isArray(file.bytes) ||
      file.bytes.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)
    ) {
      throw new TypeError(`${label}.files[${String(index)}].bytes is invalid`);
    }
    return Object.freeze({ path, bytes: Object.freeze(file.bytes as number[]) });
  });
  return Object.freeze({ directories: Object.freeze(directories), files: Object.freeze(files) });
}

function parseStagedCatalogMutation(value: unknown, index: number): StagedCatalogMutation {
  const label = `staged catalog mutation ${String(index)}`;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  const role = (value as Readonly<Record<string, unknown>>).role;
  if (role === 'create' || role === 'replace' || role === 'remove') {
    const record = exactObject(value, ['role', 'id'], label);
    return Object.freeze({ role, id: nonEmpty(record.id, `${label}.id`) });
  }
  if (role === 'convert-scratch') {
    const record = exactObject(value, ['role', 'id', 'definitionIdentity'], label);
    const id = nonEmpty(record.id, `${label}.id`);
    if (id === 'scratch') throw new TypeError(`${label}.id is reserved`);
    return Object.freeze({
      role,
      id,
      definitionIdentity: nonEmpty(record.definitionIdentity, `${label}.definitionIdentity`),
    });
  }
  throw new TypeError(`${label}.role is invalid`);
}

function parseTransaction(value: unknown): DurableTransaction {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Playground transaction is invalid');
  }
  const kind = (value as Readonly<Record<string, unknown>>).kind;
  if (kind === 'legacy-publication') {
    const record = exactObject(
      value,
      ['version', 'kind', 'catalog', 'journal'],
      'legacy publication transaction',
    );
    if (record.version !== 1) throw new TypeError('legacy publication transaction version');
    return Object.freeze({
      version: 1,
      kind,
      catalog: parseStoredCatalog(record.catalog),
      journal: parseMigrationJournal(record.journal),
    });
  }
  if (kind === 'catalog-mutation') {
    const version = (value as Readonly<Record<string, unknown>>).version;
    if (version === 2) {
      const record = exactObject(
        value,
        ['version', 'kind', 'txId', 'phase', 'beforeCatalog', 'afterCatalog', 'mutations'],
        'staged catalog mutation transaction',
      );
      if (record.phase !== 'prepared' && record.phase !== 'catalog-committed') {
        throw new TypeError('staged catalog mutation transaction phase is invalid');
      }
      if (!Array.isArray(record.mutations)) {
        throw new TypeError('staged catalog mutations is invalid');
      }
      const mutations = record.mutations.map(parseStagedCatalogMutation);
      const ownedIds = new Set<string>();
      for (const mutation of mutations) {
        if (ownedIds.has(mutation.id)) {
          throw new TypeError(`staged catalog mutation id is duplicated: ${mutation.id}`);
        }
        ownedIds.add(mutation.id);
      }
      return Object.freeze({
        version: 2,
        kind,
        txId: validateStageId(nonEmpty(record.txId, 'staged catalog transaction id')),
        phase: record.phase,
        beforeCatalog:
          record.beforeCatalog === null ? null : parseStoredCatalog(record.beforeCatalog),
        afterCatalog: parseStoredCatalog(record.afterCatalog),
        mutations: Object.freeze(mutations),
      });
    }
    const record = exactObject(
      value,
      ['version', 'kind', 'phase', 'beforeCatalog', 'afterCatalog', 'roots'],
      'catalog mutation transaction',
    );
    if (version !== 1 || (record.phase !== 'apply' && record.phase !== 'commit')) {
      throw new TypeError('catalog mutation transaction header is invalid');
    }
    if (!Array.isArray(record.roots)) throw new TypeError('catalog mutation roots is invalid');
    const roots = record.roots.map((entry, index): TransactionRoot => {
      const root = exactObject(
        entry,
        ['path', 'before', 'after'],
        `transaction root ${String(index)}`,
      );
      return Object.freeze({
        path: nonEmpty(root.path, `transaction root ${String(index)} path`),
        before: parseImage(root.before, `transaction root ${String(index)} before`),
        after: parseImage(root.after, `transaction root ${String(index)} after`),
      });
    });
    return Object.freeze({
      version: 1,
      kind,
      phase: record.phase,
      beforeCatalog:
        record.beforeCatalog === null ? null : parseStoredCatalog(record.beforeCatalog),
      afterCatalog: parseStoredCatalog(record.afterCatalog),
      roots: Object.freeze(roots),
    });
  }
  throw new TypeError('Playground transaction kind is invalid');
}

async function flushRequired(
  authority: OwnerVfsAuthority,
  trees: readonly string[],
  exact: readonly string[] = [],
): Promise<void> {
  const report = await authority.flush();
  if (report === undefined) return;
  const exactPaths = new Set(exact);
  const inScope = (path: string): boolean =>
    exactPaths.has(path) || trees.some((root) => path === root || path.startsWith(`${root}/`));
  if (ownerVfsScopeHasFailure(report, inScope)) {
    throw new Error('Playground project persistence is not durable');
  }
}

async function durableWriteJson(
  authority: OwnerVfsAuthority,
  path: string,
  value: unknown,
): Promise<void> {
  const parent = dirname(path);
  if (!isDirectory(authority, parent)) {
    authority.mkdirSync(parent, { recursive: true });
    await flushRequired(authority, [], [parent]);
  }
  authority.writeFileSync(path, jsonBytes(value));
  await flushRequired(authority, [path]);
}

async function durableRemove(authority: OwnerVfsAuthority, path: string): Promise<void> {
  if (authority.statSyncOrNull(path) === null) return;
  authority.rmSync(path, { recursive: true, force: true });
  await flushRequired(authority, [path]);
}

async function applyTreeDurably(
  authority: OwnerVfsAuthority,
  claims: InstallStampClaimIo,
  root: string,
  image: TreeImage | null,
): Promise<void> {
  if (authority.statSyncOrNull(root) !== null) {
    removeManagedTree(authority, claims, root);
  }
  if (image === null) {
    await flushRequired(authority, [root]);
    return;
  }
  const orderedImageDirectories = [...image.directories]
    .filter((relative) => relative !== '')
    .sort((left, right) => pathDepth(right) - pathDepth(left) || compareCodeUnits(left, right));
  for (const relative of orderedImageDirectories) {
    const directory = `${root}/${relative}`;
    if (!isDirectory(authority, directory)) {
      authority.mkdirSync(directory, { recursive: true });
    }
  }
  if (!isDirectory(authority, root)) authority.mkdirSync(root, { recursive: true });
  await flushRequired(authority, [root]);
  for (const file of image.files) {
    const target = `${root}/${file.path}`;
    const bytes = new Uint8Array(file.bytes);
    if (isInstallClaimRelative(file.path)) {
      claims.write(claimRootForRelative(root, file.path), bytes, { mkdirTree: true });
    } else {
      authority.writeFileSync(target, bytes);
    }
  }
  if (image.files.length > 0) await flushRequired(authority, [root]);
}

async function removeManagedTreeDurably(
  authority: OwnerVfsAuthority,
  claims: InstallStampClaimIo,
  root: string,
): Promise<void> {
  if (authority.statSyncOrNull(root) === null) return;
  removeManagedTree(authority, claims, root);
  await flushRequired(authority, [root]);
}

function tombstoneManagedTree(
  authority: OwnerVfsAuthority,
  claims: InstallStampClaimIo,
  root: string,
): void {
  if (authority.statSyncOrNull(root) === null) {
    authority.mkdirSync(root, { recursive: true });
  }
  removeManagedTree(authority, claims, root);
}

interface ManagedCopyPlanFile {
  readonly sourcePath: string;
  readonly relative: string;
  readonly claim: boolean;
}

interface ManagedCopyPlan {
  readonly sourceRoot: string;
  readonly targetRoot: string;
  readonly directories: readonly string[];
  readonly files: readonly ManagedCopyPlanFile[];
}

function planManagedTreeCopy(
  authority: OwnerVfsAuthority,
  sourceRoot: string,
  targetRoot: string,
  options: {
    readonly copyClaims: boolean;
    readonly include?: (relativePath: string, kind: 'file' | 'directory') => boolean;
  },
): ManagedCopyPlan {
  const source = authority.statSyncOrNull(sourceRoot);
  if (source === null || !source.isDirectory) {
    throw new TypeError(`Managed copy source is not a directory: ${sourceRoot}`);
  }
  if (authority.statSyncOrNull(targetRoot) !== null) {
    throw new TypeError(`Managed copy target already exists: ${targetRoot}`);
  }
  const include = options.include ?? (() => true);
  const directories: string[] = [];
  const files: ManagedCopyPlanFile[] = [];
  const walk = (sourceDirectory: string, relativeDirectory: string): void => {
    const children = [...authority.readdirSync(sourceDirectory)].sort((left, right) =>
      compareCodeUnits(left.name, right.name),
    );
    for (const child of children) {
      const sourcePath = `${sourceDirectory}/${child.name}`;
      const relative = relativeDirectory === '' ? child.name : `${relativeDirectory}/${child.name}`;
      if (child.isDirectory) {
        if (!include(relative, 'directory')) continue;
        directories.push(relative);
        walk(sourcePath, relative);
        continue;
      }
      if (!include(relative, 'file')) continue;
      if (isInstallClaimRelative(relative)) {
        if (!options.copyClaims) continue;
        files.push(Object.freeze({ sourcePath, relative, claim: true }));
      } else {
        files.push(Object.freeze({ sourcePath, relative, claim: false }));
      }
    }
  };
  walk(sourceRoot, '');
  return Object.freeze({
    sourceRoot,
    targetRoot,
    directories: Object.freeze(directories),
    files: Object.freeze(files),
  });
}

function applyManagedCopyDirectories(authority: OwnerVfsAuthority, plan: ManagedCopyPlan): void {
  for (const relative of [...plan.directories].sort(
    (left, right) => pathDepth(right) - pathDepth(left) || compareCodeUnits(left, right),
  )) {
    const target = `${plan.targetRoot}/${relative}`;
    if (!isDirectory(authority, target)) authority.mkdirSync(target, { recursive: true });
  }
  if (!isDirectory(authority, plan.targetRoot)) {
    authority.mkdirSync(plan.targetRoot, { recursive: true });
  }
}

function applyManagedCopyFiles(
  authority: OwnerVfsAuthority,
  claims: InstallStampClaimIo,
  plan: ManagedCopyPlan,
): void {
  for (const file of plan.files) {
    if (file.claim) {
      const sourceClaimRoot = claimRootForRelative(plan.sourceRoot, file.relative);
      const claim = claims.read(sourceClaimRoot);
      if (claim === null) {
        throw new TypeError(`Managed install claim disappeared: ${sourceClaimRoot}`);
      }
      claims.write(claimRootForRelative(plan.targetRoot, file.relative), claim, {
        mkdirTree: true,
      });
    } else {
      authority.copyFileSync(file.sourcePath, `${plan.targetRoot}/${file.relative}`);
    }
  }
}

function copyManagedTree(
  authority: OwnerVfsAuthority,
  claims: InstallStampClaimIo,
  sourceRoot: string,
  targetRoot: string,
  options: {
    readonly copyClaims: boolean;
    readonly include?: (relativePath: string, kind: 'file' | 'directory') => boolean;
  },
): void {
  const plan = planManagedTreeCopy(authority, sourceRoot, targetRoot, options);
  applyManagedCopyDirectories(authority, plan);
  applyManagedCopyFiles(authority, claims, plan);
}

async function copyManagedTreeDurably(
  authority: OwnerVfsAuthority,
  claims: InstallStampClaimIo,
  sourceRoot: string,
  targetRoot: string,
  options: {
    readonly copyClaims: boolean;
    readonly include?: (relativePath: string, kind: 'file' | 'directory') => boolean;
  },
): Promise<void> {
  const plan = planManagedTreeCopy(authority, sourceRoot, targetRoot, options);
  applyManagedCopyDirectories(authority, plan);
  await flushRequired(authority, [targetRoot]);
  applyManagedCopyFiles(authority, claims, plan);
  if (plan.files.length > 0) await flushRequired(authority, [targetRoot]);
}

function stagedMutationFromPlan(plan: CatalogMutationPlan): StagedCatalogMutation {
  return plan.role === 'convert-scratch'
    ? Object.freeze({
        role: plan.role,
        id: plan.id,
        definitionIdentity: plan.definitionIdentity,
      })
    : Object.freeze({ role: plan.role, id: plan.id });
}

function assertCatalogMutationPreconditions(
  authority: OwnerVfsAuthority,
  plans: readonly CatalogMutationPlan[],
): void {
  const ids = new Set<string>();
  for (const plan of plans) {
    if (ids.has(plan.id)) throw new TypeError(`Catalog mutation id is duplicated: ${plan.id}`);
    ids.add(plan.id);
    const target = authority.statSyncOrNull(projectContainer(plan.id));
    if (plan.role === 'create' || plan.role === 'convert-scratch') {
      if (target !== null)
        throw new TypeError(`Catalog mutation target already exists: ${plan.id}`);
    } else if (target === null || !target.isDirectory) {
      throw new TypeError(`Catalog mutation target is missing: ${plan.id}`);
    }
    if (plan.role === 'convert-scratch') {
      const scratch = authority.statSyncOrNull(projectContainer('scratch'));
      if (scratch === null || !scratch.isDirectory) {
        throw new TypeError('Scratch project tree is missing');
      }
    }
  }
}

async function prepareStagedCatalogMutation(
  authority: OwnerVfsAuthority,
  claims: InstallStampClaimIo,
  transaction: StagedCatalogMutationTransaction,
  plans: readonly CatalogMutationPlan[],
): Promise<void> {
  if (plans.length !== transaction.mutations.length) {
    throw new TypeError('Catalog transaction plan disagrees with its journal');
  }
  for (const [index, plan] of plans.entries()) {
    const recorded = transaction.mutations[index];
    if (
      recorded === undefined ||
      recorded.role !== plan.role ||
      recorded.id !== plan.id ||
      (recorded.role === 'convert-scratch' &&
        plan.role === 'convert-scratch' &&
        recorded.definitionIdentity !== plan.definitionIdentity)
    ) {
      throw new TypeError(`Catalog transaction mutation ${String(index)} disagrees with its plan`);
    }
    if (plan.role === 'replace' || plan.role === 'remove') {
      await copyManagedTreeDurably(
        authority,
        claims,
        projectContainer(plan.id),
        catalogMutationStage(transaction, index, 'before'),
        { copyClaims: true },
      );
    }
    if (plan.role === 'create' || plan.role === 'replace') {
      await applyTreeDurably(
        authority,
        claims,
        catalogMutationStage(transaction, index, 'after'),
        plan.after,
      );
    }
    if (plan.role === 'convert-scratch') {
      await copyManagedTreeDurably(
        authority,
        claims,
        projectContainer('scratch'),
        projectContainer(plan.id),
        {
          copyClaims: false,
          include: (relative, kind) => {
            if (relative === 'definition.json') return false;
            if (relative === 'tree/.rifty' || relative.startsWith('tree/.rifty/')) return false;
            if (kind === 'file' && isInstallClaimRelative(relative)) return false;
            return relative === 'tree' || relative.startsWith('tree/');
          },
        },
      );
      await durableWriteJson(authority, `${projectContainer(plan.id)}/definition.json`, {
        version: 1,
        projectKey: projectStorageSegment(plan.id),
        definitionIdentity: plan.definitionIdentity,
      });
    }
  }
  if (plans.length > 0) {
    await durableWriteJson(authority, catalogTransactionPreparedMarker(transaction), {
      version: 1,
      txId: transaction.txId,
    });
  }
}

async function applyStagedCatalogMutation(
  authority: OwnerVfsAuthority,
  claims: InstallStampClaimIo,
  transaction: StagedCatalogMutationTransaction,
): Promise<void> {
  for (const [index, mutation] of transaction.mutations.entries()) {
    if (mutation.role === 'convert-scratch') continue;
    const target = projectContainer(mutation.id);
    await removeManagedTreeDurably(authority, claims, target);
    if (mutation.role !== 'remove') {
      await copyManagedTreeDurably(
        authority,
        claims,
        catalogMutationStage(transaction, index, 'after'),
        target,
        { copyClaims: true },
      );
    }
  }
}

async function rollbackStagedCatalogMutation(
  authority: OwnerVfsAuthority,
  claims: InstallStampClaimIo,
  transaction: StagedCatalogMutationTransaction,
): Promise<void> {
  const prepared =
    transaction.mutations.length === 0 ||
    isFile(authority, catalogTransactionPreparedMarker(transaction));
  for (const [index, mutation] of transaction.mutations.entries()) {
    if (mutation.role === 'convert-scratch') {
      const target = projectContainer(mutation.id);
      if (authority.statSyncOrNull(target) !== null) {
        removeManagedTree(authority, claims, target);
      }
      continue;
    }
    if (!prepared) continue;
    const target = projectContainer(mutation.id);
    if (authority.statSyncOrNull(target) !== null) {
      removeManagedTree(authority, claims, target);
    }
    if (mutation.role === 'replace' || mutation.role === 'remove') {
      copyManagedTree(
        authority,
        claims,
        catalogMutationStage(transaction, index, 'before'),
        target,
        { copyClaims: true },
      );
    }
  }
  if (transaction.beforeCatalog === null) authority.rmSync(CATALOG_FILE, { force: true });
  else writeJson(authority, CATALOG_FILE, transaction.beforeCatalog);
  const stageRoot = catalogTransactionRoot(transaction.txId);
  if (authority.statSyncOrNull(stageRoot) !== null) {
    removeManagedTree(authority, claims, stageRoot);
  }
  authority.rmSync(TRANSACTION_FILE, { force: true });
  if (
    transaction.beforeCatalog === null &&
    authority.statSyncOrNull(MIGRATION_JOURNAL_FILE) === null &&
    isDirectory(authority, PLAYGROUND_ROOT)
  ) {
    removeManagedTree(authority, claims, PLAYGROUND_ROOT);
  }
  cleanupEmptyManagedParents(authority);
  await flushRequired(
    authority,
    [PLAYGROUND_ROOT, ...transaction.mutations.map((mutation) => projectContainer(mutation.id))],
    MANAGED_PARENT_PATHS,
  );
}

async function finishStagedCatalogMutation(
  authority: OwnerVfsAuthority,
  claims: InstallStampClaimIo,
  transaction: StagedCatalogMutationTransaction,
): Promise<void> {
  writeJson(authority, TRANSACTION_FILE, {
    ...transaction,
    phase: 'catalog-committed',
  });
  for (const mutation of transaction.mutations) {
    if (mutation.role === 'convert-scratch') {
      tombstoneManagedTree(authority, claims, projectContainer('scratch'));
    }
  }
  tombstoneManagedTree(authority, claims, catalogTransactionRoot(transaction.txId));
  cleanupEmptyManagedParents(authority, true);
  await flushRequired(
    authority,
    [PLAYGROUND_ROOT, projectContainer('scratch')],
    MANAGED_PARENT_PATHS,
  );
  await durableRemove(authority, TRANSACTION_FILE);
}

function cleanupEmptyManagedParents(
  authority: OwnerVfsAuthority,
  tombstoneAbsent = false,
): boolean {
  let removed = false;
  const tombstoneRoots = new Set([
    CATALOG_TRANSACTIONS_ROOT,
    STAGES_ROOT,
    PROJECTS_ROOT,
    WORKBENCH_ROOT,
  ]);
  for (const path of [
    CATALOG_TRANSACTIONS_ROOT,
    STAGES_ROOT,
    PROJECTS_ROOT,
    WORKBENCH_ROOT,
    PLAYGROUND_ROOT,
    '/.rifty/workbench',
    '/.rifty',
  ]) {
    if (tombstoneAbsent && tombstoneRoots.has(path) && authority.statSyncOrNull(path) === null) {
      authority.mkdirSync(path, { recursive: true });
      authority.rmSync(path, { recursive: true, force: true });
      removed = true;
      continue;
    }
    if (isDirectory(authority, path) && authority.readdirSync(path).length === 0) {
      authority.rmSync(path, { recursive: true, force: true });
      removed = true;
    }
  }
  return removed;
}

function catalogEntry(catalog: StoredCatalog, id: string): StoredScratch | StoredProject | null {
  if (id === 'scratch') return catalog.scratch;
  return catalog.projects.find((project) => project.id === id) ?? null;
}

function replaceCatalogAdoption(
  catalog: StoredCatalog,
  id: string,
  adoption: CatalogAdoption,
): StoredCatalog {
  if (id === 'scratch') {
    if (catalog.scratch === null) throw new TypeError('Catalog Scratch ref is missing');
    return Object.freeze({
      ...catalog,
      scratch: Object.freeze({ ...catalog.scratch, adoption }),
    });
  }
  let found = false;
  const projects = catalog.projects.map((project) => {
    if (project.id !== id) return project;
    found = true;
    return Object.freeze({ ...project, adoption });
  });
  if (!found) throw new TypeError(`Catalog project ref is missing: ${id}`);
  return Object.freeze({ ...catalog, projects: Object.freeze(projects) });
}

function replaceJournalPhase(
  journal: MigrationJournal,
  id: string,
  phase: MigrationPhase,
): MigrationJournal {
  let found = false;
  const refs = journal.refs.map((ref) => {
    if (ref.id !== id) return ref;
    found = true;
    return Object.freeze({ ...ref, phase });
  });
  if (!found) throw new TypeError(`Legacy migration ref is missing: ${id}`);
  return Object.freeze({ ...journal, refs: Object.freeze(refs) });
}

function definitionMetadata(authority: OwnerVfsAuthority, id: string): string {
  const key = projectStorageSegment(id);
  const path = `${projectContainer(id)}/definition.json`;
  const record = exactObject(
    readJson(authority, path, `Workbench project ${id} metadata`),
    ['version', 'projectKey', 'definitionIdentity'],
    `Workbench project ${id} metadata`,
  );
  if (
    record.version !== 1 ||
    record.projectKey !== key ||
    typeof record.definitionIdentity !== 'string' ||
    record.definitionIdentity.length === 0
  ) {
    throw new TypeError(`Workbench project ${id} metadata is invalid`);
  }
  return record.definitionIdentity;
}

function markerImage(
  id: string,
  phase: Exclude<MigrationPhase, { readonly kind: 'pending' }>,
): TreeImageFile {
  return Object.freeze({
    path: PROMOTION_MARKER,
    bytes: Object.freeze([
      ...jsonBytes({
        version: 1,
        id,
        definitionIdentity: phase.definitionIdentity,
        baselineFingerprint: phase.baselineFingerprint,
      }),
    ]),
  });
}

function promotedImage(
  id: string,
  phase: Exclude<MigrationPhase, { readonly kind: 'pending' }>,
  source: TreeImage,
  marker: boolean,
): TreeImage {
  const image = metadataImage(id, phase.definitionIdentity, source);
  return marker
    ? Object.freeze({
        directories: image.directories,
        files: Object.freeze([...image.files, markerImage(id, phase)]),
      })
    : image;
}

interface ValidatedMigrationState {
  readonly catalog: StoredCatalog;
  readonly journal: MigrationJournal;
}

function validateMigrationState(
  authority: OwnerVfsAuthority,
  catalog: StoredCatalog,
  journal: MigrationJournal,
  selectedPrefix: string | undefined,
): ValidatedMigrationState {
  if (selectedPrefix !== undefined && journal.legacyWorkspacePrefix !== selectedPrefix) {
    throw new TypeError('legacy migration journal selected prefix disagrees');
  }
  const expected: {
    readonly kind: 'scratch' | 'project';
    readonly id: string;
    readonly starterId: string;
  }[] = [];
  if (catalog.scratch !== null) {
    expected.push({ kind: 'scratch', id: 'scratch', starterId: catalog.scratch.starterId });
  }
  for (const project of catalog.projects) {
    expected.push({ kind: 'project', id: project.id, starterId: project.starterId });
  }
  if (journal.refs.length !== expected.length) {
    throw new TypeError('legacy migration journal refs disagree with catalog');
  }
  const needsLegacyIndex = journal.refs.some((ref) => ref.phase.kind !== 'adopted');
  const legacyIndex = `${journal.legacyWorkspacePrefix}/${LEGACY_INDEX_NAME}`;
  if (needsLegacyIndex && !isFile(authority, legacyIndex)) {
    throw new TypeError('legacy migration index was tombstoned before every ref was adopted');
  }

  for (const [index, ref] of journal.refs.entries()) {
    const expectedRef = expected[index];
    if (
      expectedRef === undefined ||
      ref.kind !== expectedRef.kind ||
      ref.id !== expectedRef.id ||
      ref.starterId !== expectedRef.starterId
    ) {
      throw new TypeError('legacy migration journal ref identity disagrees with catalog');
    }
    const expectedSource =
      ref.id === 'scratch'
        ? `${journal.legacyWorkspacePrefix}/scratch`
        : `${journal.legacyWorkspacePrefix}/projects/${ref.id}`;
    if (ref.sourceRoot !== expectedSource) {
      throw new TypeError('legacy migration journal source identity disagrees');
    }
    const entry = catalogEntry(catalog, ref.id);
    if (entry === null) throw new TypeError('legacy migration catalog ref is absent');
    const pendingPhase =
      ref.phase.kind === 'pending' || ref.phase.kind === 'copy' || ref.phase.kind === 'promote';
    if (pendingPhase) {
      if (
        entry.adoption.kind !== 'pending-adoption' ||
        entry.adoption.sourceRoot !== ref.sourceRoot
      ) {
        throw new TypeError('legacy migration pending catalog provenance disagrees');
      }
    } else if (ref.phase.kind === 'mark') {
      const pending =
        entry.adoption.kind === 'pending-adoption' && entry.adoption.sourceRoot === ref.sourceRoot;
      const marked =
        entry.adoption.kind === 'adopted' &&
        entry.adoption.definitionIdentity === ref.phase.definitionIdentity &&
        entry.adoption.baselineFingerprint === ref.phase.baselineFingerprint &&
        isFile(authority, migrationCatalogMarkIntent(ref.id));
      if (!pending && !marked) {
        throw new TypeError('legacy migration mark catalog provenance disagrees');
      }
    } else {
      if (
        entry.adoption.kind !== 'adopted' ||
        entry.adoption.definitionIdentity !== ref.phase.definitionIdentity ||
        entry.adoption.baselineFingerprint !== ref.phase.baselineFingerprint
      ) {
        throw new TypeError('legacy migration adopted catalog provenance disagrees');
      }
    }

    const sourcePresent = isDirectory(authority, ref.sourceRoot);
    const target = projectContainer(ref.id);
    const targetPresent = isDirectory(authority, target);
    const intentPresent = isFile(authority, migrationCopyIntent(ref.id));
    const promoteIntentPresent = isFile(authority, migrationPromoteIntent(ref.id));
    if (ref.phase.kind === 'pending') {
      if (!sourcePresent || targetPresent) {
        throw new TypeError('legacy migration pending source/target state is invalid');
      }
      continue;
    }
    if (ref.phase.kind === 'copy') {
      if (!sourcePresent || targetPresent) {
        throw new TypeError('legacy migration copy source/target state is invalid');
      }
      const stage = stageContainer(ref.id, ref.phase.stageId);
      if (!isDirectory(authority, stage) && !intentPresent && !promoteIntentPresent) {
        throw new TypeError('legacy migration copy stage is missing');
      }
      if (isDirectory(authority, stage) && !promoteIntentPresent) {
        const expectedStage = legacyTree(authority, ref.sourceRoot);
        if (!imageMatches(authority, stage, expectedStage, true)) {
          throw new TypeError('legacy migration copy stage contains invalid bytes');
        }
      }
      continue;
    }
    if (ref.phase.kind === 'promote') {
      if (!sourcePresent) throw new TypeError('legacy migration promote source is missing');
      const stage = stageContainer(ref.id, ref.phase.stageId);
      const stagePresent = isDirectory(authority, stage);
      const sourceImage = legacyTree(authority, ref.sourceRoot);
      if (isFile(authority, migrationPromoteIntent(ref.id))) continue;
      if (stagePresent && !imageMatches(authority, stage, sourceImage, false)) {
        throw new TypeError('legacy migration promote stage is incomplete');
      }
      if (!targetPresent && !stagePresent) {
        throw new TypeError('legacy migration promote stage and target are missing');
      }
      if (targetPresent) {
        const marker = isFile(authority, `${target}/${PROMOTION_MARKER}`);
        if (!marker && !stagePresent) {
          throw new TypeError('legacy migration promote target lacks its promotion proof');
        }
        const expectedTarget = promotedImage(ref.id, ref.phase, sourceImage, marker);
        if (!imageMatches(authority, target, expectedTarget, true)) {
          throw new TypeError('legacy migration promote target contains invalid bytes');
        }
      }
      continue;
    }
    if (!targetPresent || !isDirectory(authority, `${target}/tree`)) {
      throw new TypeError(`legacy migration ${ref.phase.kind} target is missing`);
    }
    const identity = definitionMetadata(authority, ref.id);
    if (identity !== ref.phase.definitionIdentity) {
      throw new TypeError(`legacy migration ${ref.phase.kind} target identity disagrees`);
    }
    if (ref.phase.kind === 'mark') {
      if (!sourcePresent) throw new TypeError('legacy migration mark source is missing');
    } else if (ref.phase.kind === 'adopted' && sourcePresent) {
      throw new TypeError('legacy migration adopted ref retained its source');
    }
  }
  return Object.freeze({ catalog, journal });
}

function allRefsAdopted(journal: MigrationJournal): boolean {
  return journal.refs.every((ref) => ref.phase.kind === 'adopted');
}

async function finishLegacyRef(
  authority: OwnerVfsAuthority,
  claims: InstallStampClaimIo,
  state: ValidatedMigrationState,
  id: string,
  phase: Exclude<MigrationPhase, { readonly kind: 'pending' }>,
): Promise<ValidatedMigrationState> {
  let catalog = state.catalog;
  let journal = state.journal;
  let currentPhase = phase;
  if (currentPhase.kind === 'mark') {
    authority.rmSync(`${projectContainer(id)}/${PROMOTION_MARKER}`, { force: true });
    authority.rmSync(migrationPromoteIntent(id), { force: true });
    await flushRequired(authority, [projectContainer(id), PLAYGROUND_ROOT]);
    writeJson(authority, migrationCatalogMarkIntent(id), {
      version: 1,
      id,
      definitionIdentity: currentPhase.definitionIdentity,
      baselineFingerprint: currentPhase.baselineFingerprint,
    });
    await flushRequired(authority, [migrationCatalogMarkIntent(id)]);
    const adoption = Object.freeze({
      kind: 'adopted' as const,
      definitionIdentity: currentPhase.definitionIdentity,
      baselineFingerprint: currentPhase.baselineFingerprint,
    });
    catalog = replaceCatalogAdoption(catalog, id, adoption);
    writeJson(authority, CATALOG_FILE, catalog);
    await flushRequired(authority, [CATALOG_FILE]);
    const cleanup = Object.freeze({ ...currentPhase, kind: 'source-cleanup' as const });
    journal = replaceJournalPhase(journal, id, cleanup);
    writeJson(authority, MIGRATION_JOURNAL_FILE, journal);
    await flushRequired(authority, [MIGRATION_JOURNAL_FILE]);
    authority.rmSync(migrationCatalogMarkIntent(id), { force: true });
    await flushRequired(authority, [migrationCatalogMarkIntent(id)]);
    currentPhase = cleanup;
  }
  if (currentPhase.kind === 'source-cleanup') {
    const ref = journal.refs.find((candidate) => candidate.id === id);
    if (ref === undefined) throw new TypeError(`Legacy migration ref disappeared: ${id}`);
    if (isDirectory(authority, ref.sourceRoot)) {
      const sourceBefore = captureTree(authority, ref.sourceRoot);
      if (sourceBefore === null) throw new TypeError(`Legacy source disappeared: ${id}`);
      try {
        removeManagedTree(authority, claims, ref.sourceRoot);
        await flushRequired(authority, [ref.sourceRoot]);
      } catch (error) {
        applyTree(authority, claims, ref.sourceRoot, sourceBefore);
        await flushRequired(authority, [ref.sourceRoot]);
        throw error;
      }
    }
    const adopted = Object.freeze({
      kind: 'adopted' as const,
      definitionIdentity: currentPhase.definitionIdentity,
      baselineFingerprint: currentPhase.baselineFingerprint,
    });
    journal = replaceJournalPhase(journal, id, adopted);
    writeJson(authority, MIGRATION_JOURNAL_FILE, journal);
    await flushRequired(authority, [MIGRATION_JOURNAL_FILE]);
  }
  if (allRefsAdopted(journal)) {
    const index = `${journal.legacyWorkspacePrefix}/${LEGACY_INDEX_NAME}`;
    if (authority.statSyncOrNull(index) !== null) {
      authority.rmSync(index, { force: true });
      await flushRequired(authority, [index]);
    }
  }
  return Object.freeze({ catalog, journal });
}

async function recoverMigrationState(
  authority: OwnerVfsAuthority,
  claims: InstallStampClaimIo,
  validated: ValidatedMigrationState,
): Promise<ValidatedMigrationState> {
  let state = validated;
  for (const initialRef of validated.journal.refs) {
    const current = state.journal.refs.find((ref) => ref.id === initialRef.id);
    if (current === undefined) throw new TypeError('Legacy migration ref disappeared');
    const phase = current.phase;
    if (phase.kind === 'pending' || phase.kind === 'adopted') {
      if (phase.kind === 'pending') {
        authority.rmSync(migrationCopyIntent(current.id), { force: true });
      }
      continue;
    }
    if (phase.kind === 'copy') {
      removeManagedTree(authority, claims, stageContainer(current.id, phase.stageId));
      await flushRequired(authority, [stageContainer(current.id, phase.stageId)]);
      const pending = Object.freeze({ kind: 'pending' as const });
      const journal = replaceJournalPhase(state.journal, current.id, pending);
      writeJson(authority, MIGRATION_JOURNAL_FILE, journal);
      await flushRequired(authority, [MIGRATION_JOURNAL_FILE]);
      authority.rmSync(migrationCopyIntent(current.id), { force: true });
      authority.rmSync(migrationPromoteIntent(current.id), { force: true });
      await flushRequired(authority, [MIGRATION_INTENTS_ROOT]);
      state = Object.freeze({ catalog: state.catalog, journal });
      continue;
    }
    if (phase.kind === 'promote') {
      const target = projectContainer(current.id);
      const marker = `${target}/${PROMOTION_MARKER}`;
      const sourceImage = legacyTree(authority, current.sourceRoot);
      const completePromoted =
        isFile(authority, marker) &&
        imageMatches(authority, target, promotedImage(current.id, phase, sourceImage, true), false);
      if (completePromoted) {
        removeManagedTree(authority, claims, stageContainer(current.id, phase.stageId));
        await flushRequired(authority, [stageContainer(current.id, phase.stageId)]);
        const mark = Object.freeze({ ...phase, kind: 'mark' as const });
        const journal = replaceJournalPhase(state.journal, current.id, mark);
        writeJson(authority, MIGRATION_JOURNAL_FILE, journal);
        await flushRequired(authority, [MIGRATION_JOURNAL_FILE]);
        state = await finishLegacyRef(
          authority,
          claims,
          Object.freeze({ catalog: state.catalog, journal }),
          current.id,
          mark,
        );
      } else {
        removeManagedTree(authority, claims, target);
        removeManagedTree(authority, claims, stageContainer(current.id, phase.stageId));
        await flushRequired(authority, [target, stageContainer(current.id, phase.stageId)]);
        const pending = Object.freeze({ kind: 'pending' as const });
        const journal = replaceJournalPhase(state.journal, current.id, pending);
        writeJson(authority, MIGRATION_JOURNAL_FILE, journal);
        await flushRequired(authority, [MIGRATION_JOURNAL_FILE]);
        authority.rmSync(migrationCopyIntent(current.id), { force: true });
        authority.rmSync(migrationPromoteIntent(current.id), { force: true });
        await flushRequired(authority, [MIGRATION_INTENTS_ROOT]);
        state = Object.freeze({ catalog: state.catalog, journal });
      }
      continue;
    }
    state = await finishLegacyRef(authority, claims, state, current.id, phase);
  }
  if (isDirectory(authority, MIGRATION_INTENTS_ROOT)) {
    authority.rmSync(MIGRATION_INTENTS_ROOT, { recursive: true, force: true });
    await flushRequired(authority, [MIGRATION_INTENTS_ROOT]);
  }
  if (allRefsAdopted(state.journal)) {
    const index = `${state.journal.legacyWorkspacePrefix}/${LEGACY_INDEX_NAME}`;
    if (authority.statSyncOrNull(index) !== null) {
      authority.rmSync(index, { force: true });
      await flushRequired(authority, [index]);
    }
  }
  return state;
}

async function completeLegacyPublication(
  authority: OwnerVfsAuthority,
  transaction: LegacyPublicationTransaction,
  writeIntent: boolean,
): Promise<void> {
  if (writeIntent) {
    writeJson(authority, TRANSACTION_FILE, transaction);
    await flushRequired(authority, [TRANSACTION_FILE]);
  }
  writeJson(authority, CATALOG_FILE, transaction.catalog);
  writeJson(authority, MIGRATION_JOURNAL_FILE, transaction.journal);
  await flushRequired(authority, [CATALOG_FILE, MIGRATION_JOURNAL_FILE]);
  authority.rmSync(TRANSACTION_FILE, { force: true });
  await flushRequired(authority, [TRANSACTION_FILE]);
}

function serializedCatalogMatches(authority: OwnerVfsAuthority, catalog: StoredCatalog): boolean {
  if (!isFile(authority, CATALOG_FILE)) return false;
  return bytesEqual(authority.readFileBytesSync(CATALOG_FILE), jsonBytes(catalog));
}

async function recoverInlineCatalogTransaction(
  authority: OwnerVfsAuthority,
  claims: InstallStampClaimIo,
  transaction: InlineCatalogMutationTransaction,
  force?: 'before' | 'after',
): Promise<void> {
  const useAfter =
    force === 'after' ||
    (force !== 'before' &&
      (transaction.phase === 'commit' ||
        serializedCatalogMatches(authority, transaction.afterCatalog)));
  for (const root of transaction.roots) {
    applyTree(authority, claims, root.path, useAfter ? root.after : root.before);
  }
  const catalog = useAfter ? transaction.afterCatalog : transaction.beforeCatalog;
  if (catalog === null) authority.rmSync(CATALOG_FILE, { force: true });
  else writeJson(authority, CATALOG_FILE, catalog);
  authority.rmSync(TRANSACTION_FILE, { force: true });
  if (
    catalog === null &&
    authority.statSyncOrNull(MIGRATION_JOURNAL_FILE) === null &&
    isDirectory(authority, PLAYGROUND_ROOT)
  ) {
    authority.rmSync(PLAYGROUND_ROOT, { recursive: true, force: true });
    cleanupEmptyManagedParents(authority);
  }
  await flushRequired(
    authority,
    [PLAYGROUND_ROOT, ...transaction.roots.map((root) => root.path)],
    MANAGED_PARENT_PATHS,
  );
}

async function recoverStagedCatalogTransaction(
  authority: OwnerVfsAuthority,
  claims: InstallStampClaimIo,
  transaction: StagedCatalogMutationTransaction,
  force?: 'before' | 'after',
): Promise<void> {
  const useAfter =
    force === 'after' ||
    (force !== 'before' &&
      (transaction.phase === 'catalog-committed' ||
        serializedCatalogMatches(authority, transaction.afterCatalog)));
  if (!useAfter) {
    await rollbackStagedCatalogMutation(authority, claims, transaction);
    return;
  }
  if (!serializedCatalogMatches(authority, transaction.afterCatalog)) {
    await durableWriteJson(authority, CATALOG_FILE, transaction.afterCatalog);
  }
  const committed = Object.freeze({ ...transaction, phase: 'catalog-committed' as const });
  await finishStagedCatalogMutation(authority, claims, committed);
}

async function cleanupOrphanCatalogTransactionStages(
  authority: OwnerVfsAuthority,
  claims: InstallStampClaimIo,
): Promise<void> {
  if (authority.statSyncOrNull(CATALOG_TRANSACTIONS_ROOT) === null) return;
  await removeManagedTreeDurably(authority, claims, CATALOG_TRANSACTIONS_ROOT);
  if (cleanupEmptyManagedParents(authority)) {
    await flushRequired(authority, [], MANAGED_PARENT_PATHS);
  }
}

async function recoverStartupTransaction(
  authority: OwnerVfsAuthority,
  claims: InstallStampClaimIo,
): Promise<void> {
  if (!isFile(authority, TRANSACTION_FILE)) {
    await cleanupOrphanCatalogTransactionStages(authority, claims);
    return;
  }
  let transaction: DurableTransaction;
  try {
    transaction = parseTransaction(readJson(authority, TRANSACTION_FILE, 'Playground transaction'));
  } catch {
    authority.rmSync(TRANSACTION_FILE, { force: true });
    if (!isFile(authority, CATALOG_FILE) && !isFile(authority, MIGRATION_JOURNAL_FILE)) {
      removeManagedTree(authority, claims, PLAYGROUND_ROOT);
      cleanupEmptyManagedParents(authority);
    }
    await flushRequired(authority, [PLAYGROUND_ROOT], MANAGED_PARENT_PATHS);
    await cleanupOrphanCatalogTransactionStages(authority, claims);
    return;
  }
  if (transaction.kind === 'legacy-publication') {
    await completeLegacyPublication(authority, transaction, false);
  } else if (transaction.version === 1) {
    await recoverInlineCatalogTransaction(authority, claims, transaction);
  } else {
    await recoverStagedCatalogTransaction(authority, claims, transaction);
  }
  if (!isFile(authority, TRANSACTION_FILE)) {
    await cleanupOrphanCatalogTransactionStages(authority, claims);
  }
}

function validateProjectRef(value: PlaygroundProjectRef): PlaygroundProjectRef {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Playground project ref must be an object');
  }
  if (value.kind === 'scratch' && Object.keys(value).length === 1) {
    return Object.freeze({ kind: 'scratch' });
  }
  if (value.kind === 'project' && Object.keys(value).length === 2) {
    return Object.freeze({ kind: 'project', id: nonEmpty(value.id, 'project ref id') });
  }
  throw new TypeError('Playground project ref is invalid');
}

function activeId(ref: PlaygroundProjectRef | null): string | null {
  if (ref === null) return null;
  return ref.kind === 'scratch' ? 'scratch' : ref.id;
}

function adoptedProof(definition: InspectedPlaygroundProjectDefinition): CatalogAdoption {
  return Object.freeze({
    kind: 'adopted',
    definitionIdentity: definition.identity,
    baselineFingerprint: definition.baselineFingerprint,
  });
}

function proofMatches(
  adoption: CatalogAdoption,
  definition: InspectedPlaygroundProjectDefinition,
): boolean {
  return (
    adoption.kind === 'adopted' &&
    adoption.definitionIdentity === definition.identity &&
    adoption.baselineFingerprint === definition.baselineFingerprint
  );
}

function baselineMatches(
  entry: StoredScratch | StoredProject,
  definition: InspectedPlaygroundProjectDefinition,
): boolean {
  return (
    entry.starterId === definition.starterId &&
    entry.adoption.kind === 'adopted' &&
    entry.adoption.baselineFingerprint === definition.baselineFingerprint
  );
}

function changedCatalog(
  catalog: StoredCatalog,
  changes: Partial<Omit<StoredCatalog, 'version'>>,
): StoredCatalog {
  return Object.freeze({ ...catalog, ...changes });
}

function projectDefinitionMismatch(id: string): ProjectDefinitionMismatchError {
  return new ProjectDefinitionMismatchError(id);
}

/** One owner FIFO owns catalog, materialization, adoption, and live-session admission. */
export async function createPlaygroundProjectAuthority(
  options: PlaygroundProjectAuthorityOptions,
): Promise<PlaygroundProjectAuthority> {
  const { authority, installStampClaims, acquisition } = options;
  await recoverStartupTransaction(authority, installStampClaims);
  if (
    !isFile(authority, TRANSACTION_FILE) &&
    !isFile(authority, CATALOG_FILE) &&
    !isFile(authority, MIGRATION_JOURNAL_FILE) &&
    cleanupEmptyManagedParents(authority)
  ) {
    await flushRequired(authority, [], MANAGED_PARENT_PATHS);
  }

  let stored: StoredCatalog;
  let persistedCatalog = false;
  let migration: MigrationJournal | null = null;
  if (isFile(authority, CATALOG_FILE)) {
    stored = parseStoredCatalog(readJson(authority, CATALOG_FILE, 'Playground catalog'));
    persistedCatalog = true;
    if (isFile(authority, MIGRATION_JOURNAL_FILE)) {
      const parsedJournal = parseMigrationJournal(
        readJson(authority, MIGRATION_JOURNAL_FILE, 'legacy migration journal'),
      );
      const validated = validateMigrationState(
        authority,
        stored,
        parsedJournal,
        options.legacyWorkspacePrefix,
      );
      const recovered = await recoverMigrationState(authority, installStampClaims, validated);
      stored = recovered.catalog;
      migration = recovered.journal;
    } else if (
      stored.scratch?.adoption.kind === 'pending-adoption' ||
      stored.projects.some((project) => project.adoption.kind === 'pending-adoption')
    ) {
      throw new TypeError('legacy migration catalog is missing its journal');
    }
  } else {
    if (isFile(authority, MIGRATION_JOURNAL_FILE)) {
      throw new TypeError('legacy migration journal exists without its catalog');
    }
    stored = emptyCatalog();
    const prefix = options.legacyWorkspacePrefix;
    const indexPath = prefix === undefined ? undefined : `${prefix}/${LEGACY_INDEX_NAME}`;
    if (
      options.persistence !== 'ephemeral' &&
      prefix !== undefined &&
      indexPath !== undefined &&
      isFile(authority, indexPath)
    ) {
      const index = parseLegacyIndex(
        readJson(authority, indexPath, 'legacy project index'),
        authority,
        prefix,
      );
      const catalog = legacyCatalog(index, prefix);
      const journal = legacyJournal(index, prefix);
      const transaction: LegacyPublicationTransaction = Object.freeze({
        version: 1,
        kind: 'legacy-publication',
        catalog,
        journal,
      });
      try {
        await completeLegacyPublication(authority, transaction, true);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!/permission|persistence|quota|unhealed/i.test(message)) throw error;
        await completeLegacyPublication(authority, transaction, true);
      }
      stored = catalog;
      migration = journal;
      persistedCatalog = true;
    }
  }

  let snapshot = publicSnapshot(stored);
  const listeners = new Set<(value: PlaygroundCatalogSnapshot) => void>();
  let companionScope: CapturedPlaygroundUrlContext | null = null;
  let operationTail = Promise.resolve();
  const acquisitionWaiters = createProjectAcquisitionWaiterScope();
  let closed = false;
  let closing = false;
  let closePromise: Promise<void> | null = null;
  let pendingCatalogCleanup: StagedCatalogMutationTransaction | null = null;
  let live: {
    readonly id: string;
    readonly opened: OpenedPlaygroundProject;
    closed: boolean;
  } | null = null;

  const publish = (): void => {
    for (const listener of [...listeners]) {
      try {
        listener(snapshot);
      } catch {
        // One consumer cannot make an already-durable owner mutation false.
      }
    }
  };

  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    if (closing || closed)
      return Promise.reject(new Error('Playground project authority is closed'));
    const result = operationTail.then(async () => {
      if (closing || closed) throw new Error('Playground project authority is closed');
      return operation();
    });
    operationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  const assertNoLiveProject = (): void => {
    if (live !== null) throw new ProjectBusyError('Playground project');
  };

  const inspectDefinition = (
    definition: ProjectDefinition<unknown>,
  ): InspectedPlaygroundProjectDefinition => {
    const candidateScope = playgroundProjectDefinitionScope(definition);
    const inspected = inspectPlaygroundProjectDefinition(
      definition,
      companionScope ?? candidateScope,
    );
    if (companionScope === null) companionScope = candidateScope;
    return inspected;
  };

  const runCatalogMutation = async (
    next: StoredCatalog,
    plans: readonly CatalogMutationPlan[],
  ): Promise<PlaygroundCatalogSnapshot> => {
    if (pendingCatalogCleanup !== null) {
      await recoverStagedCatalogTransaction(
        authority,
        installStampClaims,
        pendingCatalogCleanup,
        'after',
      );
      pendingCatalogCleanup = null;
    }
    const before = stored;
    assertCatalogMutationPreconditions(authority, plans);
    const transaction: StagedCatalogMutationTransaction = Object.freeze({
      version: 2,
      kind: 'catalog-mutation',
      txId: validateStageId(options.createStageId()),
      phase: 'prepared',
      beforeCatalog: persistedCatalog ? before : null,
      afterCatalog: next,
      mutations: Object.freeze(plans.map(stagedMutationFromPlan)),
    });
    let committed = false;
    try {
      await durableWriteJson(authority, TRANSACTION_FILE, transaction);
      await prepareStagedCatalogMutation(authority, installStampClaims, transaction, plans);
      await applyStagedCatalogMutation(authority, installStampClaims, transaction);
      await durableWriteJson(authority, CATALOG_FILE, next);
      committed = true;
      await durableWriteJson(
        authority,
        TRANSACTION_FILE,
        Object.freeze({ ...transaction, phase: 'catalog-committed' }),
      );
      await finishStagedCatalogMutation(authority, installStampClaims, transaction);
    } catch (error) {
      if (committed) {
        const committedTransaction = Object.freeze({
          ...transaction,
          phase: 'catalog-committed' as const,
        });
        try {
          await recoverStagedCatalogTransaction(
            authority,
            installStampClaims,
            committedTransaction,
            'after',
          );
        } catch {
          // Catalog durability is the commit point; the compact journal retains
          // enough proof for startup to finish post-commit garbage collection.
          pendingCatalogCleanup = committedTransaction;
        }
      } else {
        try {
          await recoverStagedCatalogTransaction(
            authority,
            installStampClaims,
            transaction,
            'before',
          );
        } catch (rollbackError) {
          throw new AggregateError(
            [error, rollbackError],
            error instanceof Error ? error.message : 'Playground catalog persistence failed',
          );
        }
        throw error;
      }
    }
    stored = next;
    persistedCatalog = true;
    snapshot = publicSnapshot(next);
    publish();
    return snapshot;
  };

  const now = (): string => nonEmpty(options.now(), 'Playground catalog timestamp');

  const adoptPending = async (
    ref: MigrationRef,
    definition: InspectedPlaygroundProjectDefinition,
  ): Promise<void> => {
    if (migration === null) throw new TypeError('Pending legacy adoption has no journal');
    if (ref.phase.kind !== 'pending') {
      throw new TypeError(`Legacy migration ref ${ref.id} is not ready for adoption`);
    }
    if (ref.starterId !== definition.starterId) throw projectDefinitionMismatch(ref.id);
    const stageId = validateStageId(options.createStageId());
    const proof = Object.freeze({
      stageId,
      definitionIdentity: definition.identity,
      baselineFingerprint: definition.baselineFingerprint,
    });
    let journal = replaceJournalPhase(
      migration,
      ref.id,
      Object.freeze({ kind: 'copy' as const, ...proof }),
    );
    writeJson(authority, migrationCopyIntent(ref.id), {
      version: 1,
      id: ref.id,
      stageId,
    });
    await flushRequired(authority, [migrationCopyIntent(ref.id)]);
    writeJson(authority, MIGRATION_JOURNAL_FILE, journal);
    await flushRequired(authority, [MIGRATION_JOURNAL_FILE]);

    const sourceImage = legacyTree(authority, ref.sourceRoot);
    const stage = stageContainer(ref.id, stageId);
    applyTree(authority, installStampClaims, stage, sourceImage);
    await flushRequired(authority, [stage]);

    writeJson(authority, migrationPromoteIntent(ref.id), {
      version: 1,
      id: ref.id,
      stageId,
      definitionIdentity: definition.identity,
      baselineFingerprint: definition.baselineFingerprint,
    });
    await flushRequired(authority, [migrationPromoteIntent(ref.id)]);

    const key = projectStorageSegment(ref.id);
    writeJson(authority, `${stage}/definition.json`, {
      version: 1,
      projectKey: key,
      definitionIdentity: definition.identity,
    });
    writeJson(authority, `${stage}/${PROMOTION_MARKER}`, {
      version: 1,
      id: ref.id,
      definitionIdentity: definition.identity,
      baselineFingerprint: definition.baselineFingerprint,
    });
    await flushRequired(authority, [stage]);

    journal = replaceJournalPhase(
      journal,
      ref.id,
      Object.freeze({ kind: 'promote' as const, ...proof }),
    );
    writeJson(authority, MIGRATION_JOURNAL_FILE, journal);
    authority.rmSync(migrationCopyIntent(ref.id), { force: true });
    await flushRequired(authority, [MIGRATION_JOURNAL_FILE, migrationCopyIntent(ref.id)]);

    authority.mkdirSync(PROJECTS_ROOT, { recursive: true });
    authority.renameSync(stage, projectContainer(ref.id));
    await flushRequired(authority, [stage, projectContainer(ref.id)], [PROJECTS_ROOT]);

    const mark = Object.freeze({ kind: 'mark' as const, ...proof });
    journal = replaceJournalPhase(journal, ref.id, mark);
    writeJson(authority, MIGRATION_JOURNAL_FILE, journal);
    await flushRequired(authority, [MIGRATION_JOURNAL_FILE]);

    const completed = await finishLegacyRef(
      authority,
      installStampClaims,
      Object.freeze({ catalog: stored, journal }),
      ref.id,
      mark,
    );
    stored = completed.catalog;
    migration = completed.journal;
    if (isDirectory(authority, MIGRATION_INTENTS_ROOT)) {
      authority.rmSync(MIGRATION_INTENTS_ROOT, { recursive: true, force: true });
      await flushRequired(authority, [MIGRATION_INTENTS_ROOT]);
    }
  };

  const deleteCatalogProject = (idValue: string): Promise<PlaygroundCatalogSnapshot> =>
    enqueue(async () => {
      assertNoLiveProject();
      const id = nonEmpty(idValue, 'Catalog project id');
      if (id === 'scratch') throw new TypeError('Catalog delete accepts named projects only');
      const index = stored.projects.findIndex((project) => project.id === id);
      if (index < 0) throw new TypeError(`Catalog project is absent: ${id}`);
      const projects = stored.projects.filter((project) => project.id !== id);
      let active = stored.active;
      if (stored.active?.kind === 'project' && stored.active.id === id) {
        active =
          stored.scratch !== null
            ? Object.freeze({ kind: 'scratch' as const })
            : projects[0] === undefined
              ? null
              : Object.freeze({ kind: 'project' as const, id: projects[0].id });
      }
      const next = changedCatalog(stored, {
        active,
        projects: Object.freeze(projects),
      });
      return runCatalogMutation(next, [{ role: 'remove', id }]);
    });

  const authorityApi: PlaygroundProjectAuthority = Object.freeze({
    catalogSnapshot: () => snapshot,

    subscribeCatalog(listener: (value: PlaygroundCatalogSnapshot) => void) {
      if (typeof listener !== 'function')
        throw new TypeError('Catalog listener must be a function');
      if (closed) throw new Error('Playground project authority is closed');
      listeners.add(listener);
      listener(snapshot);
      return () => listeners.delete(listener);
    },

    createScratch(input: Parameters<PlaygroundProjectCatalog['createScratch']>[0]) {
      return enqueue(async () => {
        assertNoLiveProject();
        const definition = inspectDefinition(input.definition);
        if (definition.id !== 'scratch') throw projectDefinitionMismatch('scratch');
        const existing = stored.scratch;
        if (
          input.preserveDirtySameStarter === true &&
          existing?.dirty === true &&
          baselineMatches(existing, definition)
        ) {
          return snapshot;
        }
        const editedAt = now();
        const next = changedCatalog(stored, {
          active: Object.freeze({ kind: 'scratch' }),
          scratch: Object.freeze({
            starterId: definition.starterId,
            dirty: false,
            editedAt,
            adoption: adoptedProof(definition),
          }),
        });
        return runCatalogMutation(next, [
          {
            role: existing === null ? 'create' : 'replace',
            id: 'scratch',
            after: definitionTree('scratch', definition),
          },
        ]);
      });
    },

    saveScratch(input: Parameters<PlaygroundProjectCatalog['saveScratch']>[0]) {
      return enqueue(async () => {
        assertNoLiveProject();
        const id = nonEmpty(input.id, 'Saved project id');
        if (id === 'scratch') throw new TypeError('scratch is a reserved project id');
        const name = nonEmpty(input.name, 'Saved project name');
        if (stored.projects.some((project) => project.id === id)) {
          throw new TypeError(`Catalog project already exists: ${id}`);
        }
        if (stored.scratch === null) throw new TypeError('Scratch is absent');
        const definition = inspectDefinition(input.definition);
        if (definition.id !== id) throw projectDefinitionMismatch(id);
        if (!baselineMatches(stored.scratch, definition)) throw projectDefinitionMismatch(id);
        const editedAt = now();
        const nextProject: StoredProject = Object.freeze({
          id,
          name,
          starterId: definition.starterId,
          editedAt,
          adoption: adoptedProof(definition),
        });
        const next = changedCatalog(stored, {
          active: Object.freeze({ kind: 'project', id }),
          scratch: null,
          projects: Object.freeze([...stored.projects, nextProject]),
        });
        return runCatalogMutation(next, [
          { role: 'convert-scratch', id, definitionIdentity: definition.identity },
        ]);
      });
    },

    activate(target: PlaygroundProjectRef) {
      return enqueue(async () => {
        assertNoLiveProject();
        const ref = validateProjectRef(target);
        if (ref.kind === 'scratch') {
          if (stored.scratch === null) throw new TypeError('Scratch is absent');
        } else if (!stored.projects.some((project) => project.id === ref.id)) {
          throw new TypeError(`Catalog project is absent: ${ref.id}`);
        }
        if (activeId(stored.active) === activeId(ref)) return snapshot;
        return runCatalogMutation(changedCatalog(stored, { active: ref }), []);
      });
    },

    rename(idValue: string, nameValue: string) {
      return enqueue(async () => {
        const id = nonEmpty(idValue, 'Catalog project id');
        const name = nonEmpty(nameValue, 'Catalog project name');
        const index = stored.projects.findIndex((project) => project.id === id);
        if (index < 0) throw new TypeError(`Catalog project is absent: ${id}`);
        if (stored.projects[index]?.name === name) return snapshot;
        const projects = stored.projects.map((project) =>
          project.id === id ? Object.freeze({ ...project, name }) : project,
        );
        return runCatalogMutation(
          changedCatalog(stored, { projects: Object.freeze(projects) }),
          [],
        );
      });
    },

    reset(input: Parameters<PlaygroundProjectCatalog['reset']>[0]) {
      return enqueue(async () => {
        assertNoLiveProject();
        const target = validateProjectRef(input.target);
        const id = target.kind === 'scratch' ? 'scratch' : target.id;
        const definition = inspectDefinition(input.definition);
        if (definition.id !== id) throw projectDefinitionMismatch(id);
        const editedAt = now();
        let next: StoredCatalog;
        if (id === 'scratch') {
          if (stored.scratch === null) throw new TypeError('Scratch is absent');
          next = changedCatalog(stored, {
            scratch: Object.freeze({
              starterId: definition.starterId,
              dirty: false,
              editedAt,
              adoption: adoptedProof(definition),
            }),
          });
        } else {
          const index = stored.projects.findIndex((project) => project.id === id);
          if (index < 0) throw new TypeError(`Catalog project is absent: ${id}`);
          const projects = stored.projects.map((project) =>
            project.id === id
              ? Object.freeze({
                  ...project,
                  starterId: definition.starterId,
                  editedAt,
                  adoption: adoptedProof(definition),
                })
              : project,
          );
          next = changedCatalog(stored, { projects: Object.freeze(projects) });
        }
        return runCatalogMutation(next, [
          { role: 'replace', id, after: definitionTree(id, definition) },
        ]);
      });
    },

    delete: deleteCatalogProject,

    async deleteProject(id: string) {
      await deleteCatalogProject(id);
    },

    openProject(
      definitionValue: ProjectDefinition<unknown>,
      initialTerminalStateValue?: ProjectTerminalSnapshot,
      options?: ProjectAcquisitionOptions,
    ) {
      const initialTerminalState =
        initialTerminalStateValue === undefined
          ? undefined
          : ownProjectTerminalSnapshot(initialTerminalStateValue);
      return enqueue(async () => {
        assertNoLiveProject();
        const definition = inspectDefinition(definitionValue);
        const selected = activeId(stored.active);
        if (selected === null || selected !== definition.id) {
          throw new TypeError('Project definition does not match the active catalog ref');
        }
        let entry = catalogEntry(stored, selected);
        if (entry === null) throw new TypeError('Active catalog ref is absent');
        if (entry.adoption.kind === 'pending-adoption') {
          if (entry.starterId !== definition.starterId) {
            throw projectDefinitionMismatch(definition.id);
          }
          if (migration === null) throw new TypeError('Pending adoption has no migration journal');
          const ref = migration.refs.find((candidate) => candidate.id === selected);
          if (ref === undefined) throw new TypeError('Pending adoption ref is absent');
          await adoptPending(ref, definition);
          entry = catalogEntry(stored, selected);
          if (entry === null) throw new TypeError('Adopted catalog ref disappeared');
        }
        if (!proofMatches(entry.adoption, definition)) {
          throw projectDefinitionMismatch(definition.id);
        }
        const container = projectContainer(selected);
        if (!isDirectory(authority, `${container}/tree`)) {
          throw new TypeError(`Workbench project tree is missing: ${selected}`);
        }
        if (definitionMetadata(authority, selected) !== definition.identity) {
          throw projectDefinitionMismatch(definition.id);
        }
        const projectKey = projectStorageSegment(selected);
        const root = `${container}/tree`;
        const request = { projectKey, projectRoot: root, definition };
        const acquisitionResult = await acquisitionWaiters.ensure(acquisition, request, options);
        const acknowledgedInitialTerminalState =
          initialTerminalState === undefined
            ? undefined
            : projectTerminalStateFromOwner(
                root,
                projectTerminalStateToOwner(root, initialTerminalState, (path) =>
                  isDirectory(authority, path),
                ),
              );
        let closePromise: Promise<void> | null = null;
        const opened = Object.freeze({
          projectKey,
          projectRoot: root,
          acquisition: acquisitionResult,
          ...(acknowledgedInitialTerminalState === undefined
            ? {}
            : { initialTerminalState: acknowledgedInitialTerminalState }),
          close(): Promise<void> {
            if (closePromise !== null) return closePromise;
            closePromise = Promise.resolve().then(() => {
              if (live?.opened === opened) {
                live.closed = true;
                live = null;
              }
            });
            return closePromise;
          },
        });
        live = { id: selected, opened, closed: false };
        return opened;
      });
    },

    recordMutation(input: Parameters<PlaygroundProjectAuthority['recordMutation']>[0]) {
      return enqueue(async () => {
        if (live === null || live.opened !== input.project || live.closed) {
          throw new TypeError('Mutation project is not the live Playground project');
        }
        if (
          !Number.isSafeInteger(input.treeRevision) ||
          input.treeRevision < 0 ||
          input.treeRevision > authority.treeRevision
        ) {
          throw new RangeError('Mutation tree revision is invalid');
        }
        const dirty =
          input.kind === 'guest' ||
          input.kind === 'scm' ||
          input.kind === 'archive' ||
          input.kind === 'file' ||
          input.kind === 'package-manifest' ||
          input.kind === 'package-lock';
        if (!dirty || live.id !== 'scratch' || stored.scratch === null || stored.scratch.dirty) {
          return;
        }
        const next = changedCatalog(stored, {
          scratch: Object.freeze({ ...stored.scratch, dirty: true, editedAt: now() }),
        });
        await runCatalogMutation(next, []);
      });
    },

    treeRevision: () => authority.treeRevision,

    cancelActiveAcquisition(reason = new Error('Playground project acquisition is closed')) {
      acquisitionWaiters.cancel(reason);
    },

    close() {
      if (closePromise !== null) return closePromise;
      closing = true;
      acquisitionWaiters.cancel(new Error('Playground project authority is closed'));
      closePromise = operationTail.then(() => {
        if (live !== null) throw new ProjectBusyError('Playground project');
        listeners.clear();
        closed = true;
      });
      return closePromise;
    },
  });

  return authorityApi;
}
