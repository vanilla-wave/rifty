import { type GitIdentity, makeGit, vfsToGitFs } from '@riftydev/git';
import { RegistryClient } from '@riftydev/npm-client';
import { setSyncMirror } from '@riftydev/vfs/internal';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { createInstallStamp } from '../glue/install-stamp.ts';
import { SyncMirrorVfs } from '../glue/sync-mirror-vfs.ts';
import type { BootstrapConfig } from '../templates/project-spec.ts';
import type { ProjectDocumentInvalidation } from '../workbench/errors.ts';
import { createPlaygroundScmAdapter } from '../workbench/internal/playground-scm.ts';
import type {
  PlaygroundArchive,
  PlaygroundScm,
  PlaygroundScmSnapshot,
} from '../workbench/playground.ts';
import {
  type ProjectContentTransport,
  createProjectContentTransport,
} from '../workbench/project-content-transport.ts';
import type { ProjectContentController } from '../workbench/project-content.ts';
import type {
  OwnerProjectVfsFrame,
  PageProjectVfsFrame,
} from '../workbench/project-vfs-protocol.ts';
import { type OwnerPackageConfig, createOwnerPackageState } from './owner-package-state.ts';
import {
  type OwnerVfsAuthority,
  type OwnerVfsAuthorityComposition,
  createOwnerVfsAuthorityComposition,
} from './owner-vfs-authority.ts';
import {
  createOwnerPlaygroundArchive,
  createPlaygroundSessionArchive,
} from './playground-archive-integration.ts';
import {
  type DurableOwnerFault,
  DurableOwnerFs,
  type ExactFsTree as ExactTree,
  createDurableOwnerFsFromTree,
} from './test-fixtures/durable-owner-fs.ts';
import { type WorkbenchProjectVfs, createWorkbenchProjectVfs } from './workbench-project-vfs.ts';

const PROJECT_ROOT = '/.rifty/workbench/v1/projects/project-a/tree';
const PACKAGE_JSON = '{"name":"project-a","version":"1.0.0","dependencies":{"kleur":"4.1.5"}}\n';
const ORIGINAL_SOURCE = 'export const value = "original";\n';
const IMPORTED_SOURCE = 'export const value = "imported";\n';
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
let ownerSequence = 0;
const COMMIT_IDENTITY: GitIdentity = Object.freeze({
  name: 'Playground Archive Contract',
  email: 'archive-contract@rifty.test',
  timestamp: 1_700_000_000,
  timezoneOffset: 0,
});

interface ArchiveFile {
  readonly path: string;
  readonly encoding: 'base64';
  readonly content: string;
}

interface ArchiveV1 {
  readonly version: 1;
  readonly root: '/';
  readonly files: readonly ArchiveFile[];
}

function write(fs: OwnerVfsAuthority, path: string, contents: string): void {
  const separator = path.lastIndexOf('/');
  fs.mkdirSync(path.slice(0, separator) || '/', { recursive: true });
  fs.writeFileSync(path, encoder.encode(contents));
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function file(path: string, contents: string): ArchiveFile {
  return { path, encoding: 'base64', content: bytesToBase64(encoder.encode(contents)) };
}

const IMPORT_ARCHIVE = JSON.stringify({
  version: 1,
  root: '/',
  files: [
    file('package.json', PACKAGE_JSON),
    file('src/main.ts', IMPORTED_SOURCE),
    file('src/imported.ts', 'export const imported = true;\n'),
  ],
} satisfies ArchiveV1);

const bootstrapConfig: BootstrapConfig = {
  runtime: 'node-cli',
  root: PROJECT_ROOT,
  entryPath: `${PROJECT_ROOT}/src/main.ts`,
  packageName: 'project-a',
  packageVersion: '1.0.0',
  installDeps: { kleur: '4.1.5' },
  packageJson: PACKAGE_JSON,
  seedFiles: {},
};

const packageConfig: OwnerPackageConfig = {
  cfg: bootstrapConfig,
  templateId: 'playground-archive-integration',
  slug: 'project-a',
  fromScratch: true,
};

function publicPaths(content: ProjectContentController): readonly string[] {
  return content.files.snapshot().entries.map((entry) => entry.path);
}

function expectedImportedProjectTree(original: ExactTree): ExactTree {
  const gitRoot = `${PROJECT_ROOT}/.git`;
  const directories = original.directories.filter(
    (path) => path === gitRoot || path.startsWith(`${gitRoot}/`),
  );
  directories.push(`${PROJECT_ROOT}/src`);
  const files: Record<string, Uint8Array> = Object.fromEntries(
    Object.entries(original.files)
      .filter(([path]) => path.startsWith(`${gitRoot}/`))
      .map(([path, bytes]) => [path, bytes.slice()]),
  );
  files[`${PROJECT_ROOT}/package.json`] = encoder.encode(PACKAGE_JSON);
  files[`${PROJECT_ROOT}/src/main.ts`] = encoder.encode(IMPORTED_SOURCE);
  files[`${PROJECT_ROOT}/src/imported.ts`] = encoder.encode('export const imported = true;\n');
  return Object.freeze({
    directories: Object.freeze([...new Set(directories)].sort()),
    files: Object.freeze(
      Object.fromEntries(
        Object.entries(files).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
      ),
    ),
  });
}

function bytesEqual(left: Uint8Array | null, right: Uint8Array | null): boolean {
  if (left === null || right === null) return left === right;
  return left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index]);
}

function exactTreeEqual(left: ExactTree, right: ExactTree): boolean {
  if (
    left.directories.length !== right.directories.length ||
    left.directories.some((path, index) => path !== right.directories[index])
  ) {
    return false;
  }
  const leftPaths = Object.keys(left.files);
  const rightPaths = Object.keys(right.files);
  return (
    leftPaths.length === rightPaths.length &&
    leftPaths.every(
      (path, index) =>
        path === rightPaths[index] &&
        bytesEqual(left.files[path] ?? null, right.files[path] ?? null),
    )
  );
}

function expectedImportedWholeTree(original: ExactTree): ExactTree {
  const importedProject = expectedImportedProjectTree(
    Object.freeze({
      directories: Object.freeze(
        original.directories.filter((path) => path.startsWith(`${PROJECT_ROOT}/`)),
      ),
      files: Object.freeze(
        Object.fromEntries(
          Object.entries(original.files).filter(([path]) => path.startsWith(`${PROJECT_ROOT}/`)),
        ),
      ),
    }),
  );
  const directories = original.directories.filter(
    (path) => path !== PROJECT_ROOT && !path.startsWith(`${PROJECT_ROOT}/`),
  );
  directories.push(PROJECT_ROOT, ...importedProject.directories);
  const files: Record<string, Uint8Array> = Object.fromEntries(
    Object.entries(original.files)
      .filter(([path]) => !path.startsWith(`${PROJECT_ROOT}/`))
      .map(([path, bytes]) => [path, bytes.slice()]),
  );
  for (const [path, bytes] of Object.entries(importedProject.files)) files[path] = bytes.slice();
  return Object.freeze({
    directories: Object.freeze([...new Set(directories)].sort()),
    files: Object.freeze(
      Object.fromEntries(
        Object.entries(files)
          .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
          .map(([path, bytes]) => [path, bytes.slice()]),
      ),
    ),
  });
}

function exactState(tree: ExactTree, before: ExactTree, after: ExactTree): 'pre' | 'post' | null {
  if (exactTreeEqual(tree, before)) return 'pre';
  if (exactTreeEqual(tree, after)) return 'post';
  return null;
}

function eventIndices(timeline: readonly string[], event: string): readonly number[] {
  return timeline.flatMap((candidate, index) => (candidate === event ? [index] : []));
}

function expectEventBefore(timeline: readonly string[], before: string, after: string): void {
  const beforeIndex = timeline.indexOf(before);
  const afterIndex = timeline.indexOf(after);
  expect(beforeIndex, `${before} missing from ${timeline.join(' -> ')}`).toBeGreaterThanOrEqual(0);
  expect(afterIndex, `${after} missing from ${timeline.join(' -> ')}`).toBeGreaterThan(beforeIndex);
}

function instrumentOwner(
  composition: OwnerVfsAuthorityComposition,
  timeline: string[],
): OwnerVfsAuthorityComposition {
  const recordReflection = (): void => {
    if (
      timeline.includes('claim:revoke') &&
      timeline.includes('documents:invalidate-all') &&
      !timeline.includes('files:reflect')
    ) {
      timeline.push('files:reflect');
    }
  };
  const readdir = composition.authority.readdirSync.bind(composition.authority);
  vi.spyOn(composition.authority, 'readdirSync').mockImplementation((path) => {
    const entries = readdir(path);
    if (path === PROJECT_ROOT) recordReflection();
    return entries;
  });
  const snapshot = composition.authority.snapshot.bind(composition.authority);
  vi.spyOn(composition.authority, 'snapshot').mockImplementation(() => {
    const value = snapshot();
    recordReflection();
    return value;
  });
  const flush = composition.authority.flush.bind(composition.authority);
  vi.spyOn(composition.authority, 'flush').mockImplementation(async () => {
    try {
      const report = await flush();
      timeline.push((report?.failures.length ?? 0) === 0 ? 'durability' : 'durability:failed');
      return report;
    } catch (error) {
      timeline.push('durability:failed');
      throw error;
    }
  });
  return Object.freeze({
    authority: composition.authority,
    appliedMutations: composition.appliedMutations,
    installStampClaims: Object.freeze({
      read: (root: string) => composition.installStampClaims.read(root),
      write: (root: string, data: Uint8Array, options: { readonly mkdirTree: boolean }) =>
        composition.installStampClaims.write(root, data, options),
      remove(root: string) {
        if (root === PROJECT_ROOT) {
          expect(
            decoder.decode(composition.authority.readFileBytesSync(`${PROJECT_ROOT}/src/main.ts`)),
          ).toBe(IMPORTED_SOURCE);
          expect(composition.authority.statSyncOrNull(`${PROJECT_ROOT}/src/old.ts`)).toBeNull();
          timeline.push('archive:promote');
        }
        composition.installStampClaims.remove(root);
        if (root === PROJECT_ROOT) timeline.push('claim:revoke');
      },
    }),
  });
}

interface ArchiveHarness {
  readonly fs: DurableOwnerFs;
  readonly owner: OwnerVfsAuthorityComposition;
  readonly projectVfs: WorkbenchProjectVfs;
  readonly transport: ProjectContentTransport;
  readonly content: ProjectContentController;
  readonly archive: PlaygroundArchive;
  readonly scm: PlaygroundScm;
  readonly timeline: string[];
  readonly publicSnapshots: readonly (readonly string[])[];
  readonly scmSnapshots: readonly PlaygroundScmSnapshot[];
  crash(): void;
  close(): Promise<void>;
}

async function harness(
  fs = new DurableOwnerFs(),
  options: { readonly seed?: boolean } = {},
): Promise<ArchiveHarness> {
  const timeline: string[] = [];
  const vfs = new SyncMirrorVfs();
  setSyncMirror(fs, { async: vfs });
  const baseComposition = createOwnerVfsAuthorityComposition(fs, {
    ownerEpoch: `playground-archive-owner-${String(++ownerSequence)}`,
    initialRoots: ['/', '/.rifty'],
  });
  const owner = instrumentOwner(baseComposition, timeline);
  const seed = options.seed ?? true;
  const git = makeGit({ fs: vfsToGitFs(vfs), dir: PROJECT_ROOT });
  if (seed && owner.authority.statSyncOrNull(PROJECT_ROOT) === null) {
    write(owner.authority, `${PROJECT_ROOT}/package.json`, PACKAGE_JSON);
    write(owner.authority, `${PROJECT_ROOT}/src/main.ts`, ORIGINAL_SOURCE);
    write(owner.authority, `${PROJECT_ROOT}/src/old.ts`, 'export const old = true;\n');
    write(owner.authority, `${PROJECT_ROOT}/node_modules/kleur/index.js`, 'module.exports = {};\n');
    const stamp = createInstallStamp(PROJECT_ROOT, PACKAGE_JSON, {
      slug: 'project-a',
      packages: 1,
    });
    if (stamp === null) throw new Error('Archive contract could not construct its package claim');
    owner.installStampClaims.write(
      PROJECT_ROOT,
      encoder.encode(`${JSON.stringify(stamp, null, 2)}\n`),
      { mkdirTree: true },
    );
    await owner.authority.flush();
    write(owner.authority, `${PROJECT_ROOT}/.gitignore`, 'node_modules/\n.rifty/\n');
    await git.init();
    for (const path of ['.gitignore', 'package.json', 'src/main.ts', 'src/old.ts']) {
      await git.add(path);
    }
    await git.commit({
      message: 'initial archive fixture',
      author: COMMIT_IDENTITY,
      committer: COMMIT_IDENTITY,
    });
    await owner.authority.flush();
  }

  const packageState = createOwnerPackageState({
    initial: packageConfig,
    vfs,
    fsSync: owner.authority,
    installStampClaims: owner.installStampClaims,
    flush: () => owner.authority.flush(),
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

  const frames: OwnerProjectVfsFrame[] = [];
  const buffered: OwnerProjectVfsFrame[] = [];
  const backgroundFailures: Error[] = [];
  let transport: ProjectContentTransport | null = null;
  const projectVfs = createWorkbenchProjectVfs({
    projectRoot: PROJECT_ROOT,
    authority: owner.authority,
    appliedMutations: owner.appliedMutations,
    packageMutations: packageState.mutations,
    durability: 'durable',
    emit(frame) {
      frames.push(frame);
      if (transport === null) buffered.push(frame);
      else transport.accept(frame);
    },
    fatal: (error) => backgroundFailures.push(error),
  });
  const ownerArchive = await createOwnerPlaygroundArchive({
    projectRoot: PROJECT_ROOT,
    owner,
    packages: packageState,
    projectVfs,
  });
  if (owner.authority.statSyncOrNull(`${PROJECT_ROOT}/.git`) === null) {
    throw new Error('Archive recovery did not restore the private Git repository');
  }
  let requestSequence = 0;
  const createdTransport = createProjectContentTransport({
    projectRoot: PROJECT_ROOT,
    send(frame: PageProjectVfsFrame) {
      const handled = projectVfs.handleFrame(frame);
      if (handled !== undefined) {
        void handled.catch((error: unknown) =>
          backgroundFailures.push(error instanceof Error ? error : new Error(String(error))),
        );
      }
      return true;
    },
    isAlive: () => true,
    generateRequestId: () => `archive-integration-${String(++requestSequence)}`,
    commitTimeoutMs: 1_000,
  });
  transport = createdTransport;
  for (const frame of buffered) createdTransport.accept(frame);
  buffered.length = 0;
  const content = await createdTransport.ready;
  const instrumentedContent: ProjectContentController = Object.freeze({
    files: content.files,
    documents: content.documents,
    invalidate: content.invalidate,
    invalidateAll(reason: ProjectDocumentInvalidation) {
      timeline.push('documents:invalidate-all');
      content.invalidateAll(reason);
    },
    preflightClose: content.preflightClose,
    close: content.close,
  });
  const sessionScm: PlaygroundScm = await createPlaygroundScmAdapter({
    projectRoot: PROJECT_ROOT,
    vfs,
    git,
    commitIdentity: COMMIT_IDENTITY,
  });
  const archive = createPlaygroundSessionArchive({
    owner: ownerArchive,
    content: instrumentedContent,
    scm: sessionScm,
  });
  const publicSnapshots: (readonly string[])[] = [];
  let filesReplayed = false;
  const unsubscribe = content.files.subscribe((snapshot) => {
    const paths = Object.freeze(snapshot.entries.map((entry) => entry.path));
    publicSnapshots.push(paths);
    if (filesReplayed) timeline.push('files:publish');
    filesReplayed = true;
  });
  const scmSnapshots: PlaygroundScmSnapshot[] = [];
  let scmReplayed = false;
  const unsubscribeScm = sessionScm.subscribe((snapshot: PlaygroundScmSnapshot) => {
    scmSnapshots.push(snapshot);
    if (scmReplayed) timeline.push('scm:publish');
    scmReplayed = true;
  });
  timeline.length = 0;

  return {
    fs,
    owner,
    projectVfs,
    transport: createdTransport,
    content,
    archive,
    scm: sessionScm,
    timeline,
    publicSnapshots,
    scmSnapshots,
    crash() {
      unsubscribe();
      unsubscribeScm();
    },
    async close() {
      unsubscribe();
      unsubscribeScm();
      await packageState.quiesce();
      await content.close();
      await projectVfs.close();
      expect(backgroundFailures).toEqual([]);
      expect(frames.length).toBeGreaterThan(0);
    },
  };
}

const IMPORTED_PUBLIC_PATHS = Object.freeze([
  '/src',
  '/src/imported.ts',
  '/src/main.ts',
  '/package.json',
]);

function expectNoPendingPrimitives(fs: DurableOwnerFs): void {
  expect(
    fs.pendingPrimitiveCount,
    'archive operation settled with unflushed durable-owner primitives',
  ).toBe(0);
}

async function importAndRecordResolution(h: ArchiveHarness): Promise<void> {
  await h.archive.import(IMPORT_ARCHIVE).then(() => {
    h.timeline.push('resolve');
  });
}

function expectSuccessfulImportState(
  h: ArchiveHarness,
  before: ExactTree,
  initialScmSnapshot: PlaygroundScmSnapshot | undefined,
): ExactTree {
  expectEventBefore(h.timeline, 'archive:promote', 'claim:revoke');
  expectEventBefore(h.timeline, 'documents:invalidate-all', 'resolve');
  const resolveIndex = h.timeline.indexOf('resolve');
  const filePublicationIndices = eventIndices(h.timeline, 'files:publish');
  const scmPublicationIndices = eventIndices(h.timeline, 'scm:publish');
  const publicPublicationIndices = [...filePublicationIndices, ...scmPublicationIndices];
  expect(filePublicationIndices).not.toEqual([]);
  expect(scmPublicationIndices).not.toEqual([]);
  const firstPublicationIndex = Math.min(...publicPublicationIndices);
  const durabilityBarrierIndex = Math.max(
    ...eventIndices(h.timeline, 'durability').filter((index) => index < firstPublicationIndex),
  );
  expect(durabilityBarrierIndex).toBeGreaterThan(h.timeline.indexOf('claim:revoke'));
  for (const publicationIndex of publicPublicationIndices) {
    expect(publicationIndex).toBeGreaterThan(durabilityBarrierIndex);
    expect(publicationIndex).toBeLessThan(resolveIndex);
  }
  expect(Math.min(...scmPublicationIndices)).toBeGreaterThan(Math.max(...filePublicationIndices));

  const expected = expectedImportedWholeTree(before);
  expect(publicPaths(h.content)).toEqual(IMPORTED_PUBLIC_PATHS);
  expect(decoder.decode(h.owner.authority.readFileBytesSync(`${PROJECT_ROOT}/src/main.ts`))).toBe(
    IMPORTED_SOURCE,
  );
  expect(h.owner.installStampClaims.read(PROJECT_ROOT)).toBeNull();
  expect(h.publicSnapshots.at(-1)).toContain('/src/imported.ts');
  expect(h.scmSnapshots.length).toBeGreaterThan(1);
  expect(h.scmSnapshots.at(-1)).not.toEqual(initialScmSnapshot);
  expect(h.scmSnapshots.at(-1)?.changes).toContainEqual({
    path: '/src/imported.ts',
    code: '??',
    area: 'working',
  });
  expect(h.fs.liveSnapshot()).toEqual(expected);
  expect(h.fs.durableSnapshot()).toEqual(expected);
  expectNoPendingPrimitives(h.fs);
  return expected;
}

function expectNoTentativePublications(
  h: ArchiveHarness,
  originalPaths: readonly string[],
  initialScmSnapshot: PlaygroundScmSnapshot | undefined,
): void {
  expect(h.timeline).toContain('durability:failed');
  expect(h.timeline).not.toContain('files:publish');
  expect(h.timeline).not.toContain('scm:publish');
  expect(h.timeline).not.toContain('resolve');
  expect(h.publicSnapshots).toEqual([originalPaths]);
  expect(h.scmSnapshots).toEqual([initialScmSnapshot]);
  expect(h.scm.snapshot()).toBe(initialScmSnapshot);
  expect(publicPaths(h.content)).toEqual(originalPaths);
  expectNoPendingPrimitives(h.fs);
}

function expectRecoveredPublicState(
  h: ArchiveHarness,
  state: 'pre' | 'post',
  originalPaths: readonly string[],
): void {
  expect(h.publicSnapshots).toHaveLength(1);
  expect(h.scmSnapshots).toHaveLength(1);
  if (state === 'pre') {
    expect(publicPaths(h.content)).toEqual(originalPaths);
    expect(h.scm.snapshot().changes).toEqual([]);
    expect(h.owner.installStampClaims.read(PROJECT_ROOT)).not.toBeNull();
    return;
  }
  expect(publicPaths(h.content)).toEqual(IMPORTED_PUBLIC_PATHS);
  expect(h.owner.installStampClaims.read(PROJECT_ROOT)).toBeNull();
  expect(h.scm.snapshot().changes).toContainEqual({
    path: '/src/imported.ts',
    code: '??',
    area: 'working',
  });
}

const DURABILITY_FAULTS = Object.freeze([
  {
    name: 'quota PersistFailureReport',
    kind: 'quota-report' as const,
    message: /quota|persistence|durability/i,
  },
  {
    name: 'permission rejection',
    kind: 'permission-rejection' as const,
    message: /permission/i,
  },
] satisfies readonly {
  readonly name: string;
  readonly kind: DurableOwnerFault;
  readonly message: RegExp;
}[]);

const SUCCESS_SENTINEL_ORDINAL = 100_000;

async function recoverRecordedDurabilityBoundary(input: {
  readonly crashTree: ExactTree;
  readonly before: ExactTree;
  readonly after: ExactTree;
  readonly originalPaths: readonly string[];
}): Promise<'pre' | 'post'> {
  const recovered = await harness(createDurableOwnerFsFromTree(input.crashTree), { seed: false });
  const liveState = exactState(recovered.fs.liveSnapshot(), input.before, input.after);
  const durableState = exactState(recovered.fs.durableSnapshot(), input.before, input.after);
  expect(liveState, 'archive startup recovery left a non-canonical whole-FS state').not.toBeNull();
  expect(durableState).toBe(liveState);
  expectNoPendingPrimitives(recovered.fs);
  if (liveState === null) throw new Error('Archive recovery classification failed');
  expectRecoveredPublicState(recovered, liveState, input.originalPaths);

  if (liveState === 'pre') {
    const initialScmSnapshot = recovered.scmSnapshots[0];
    await importAndRecordResolution(recovered);
    expectSuccessfulImportState(recovered, input.before, initialScmSnapshot);
  }

  // Capture the post-recovery/retry crash image before any graceful teardown.
  const provedFs = recovered.fs.restartFromDurableState();
  expect(provedFs.liveSnapshot()).toEqual(input.after);
  expect(provedFs.durableSnapshot()).toEqual(input.after);
  recovered.crash();

  const reopened = await harness(provedFs, { seed: false });
  expect(reopened.fs.liveSnapshot()).toEqual(input.after);
  expect(reopened.fs.durableSnapshot()).toEqual(input.after);
  expectNoPendingPrimitives(reopened.fs);
  expectRecoveredPublicState(reopened, 'post', input.originalPaths);
  await reopened.close();
  return liveState;
}

describe('Playground archive owner/session integration', () => {
  it('keeps the public handle semantic and resolves only after the ordered durable replacement', async () => {
    const h = await harness();
    expectTypeOf(h.archive).toEqualTypeOf<PlaygroundArchive>();
    expect(Object.keys(h.archive).sort()).toEqual(['export', 'import']);
    expect(h.archive).not.toHaveProperty('flush');
    expect(h.archive).not.toHaveProperty('owner');
    expect(h.archive).not.toHaveProperty('recover');
    const source = await h.content.documents.open('/src/main.ts');
    const old = await h.content.documents.open('/src/old.ts');
    expectNoPendingPrimitives(h.fs);
    h.fs.sealDurableState();
    const before = h.fs.liveSnapshot();
    const initialScmSnapshot = h.scmSnapshots[0];
    expect(initialScmSnapshot).toBe(h.scm.snapshot());
    expect(initialScmSnapshot?.changes).toEqual([]);

    await importAndRecordResolution(h);

    expectSuccessfulImportState(h, before, initialScmSnapshot);
    expect(source.snapshot()).toMatchObject({ staleReason: 'reset', closed: false });
    expect(old.snapshot()).toMatchObject({ staleReason: 'reset', closed: false });

    await source.close();
    await old.close();
    await h.close();
  });

  it.each(DURABILITY_FAULTS)(
    'sweeps every persisted archive primitive and crash boundary across $name',
    async ({ kind, message }) => {
      const seeded = await harness();
      expectNoPendingPrimitives(seeded.fs);
      seeded.fs.sealDurableState();
      const before = seeded.fs.durableSnapshot();
      const after = expectedImportedWholeTree(before);
      const originalPaths = publicPaths(seeded.content);
      const baseline = seeded.fs.restartFromDurableState();
      await seeded.close();

      const sentinel = await harness(baseline.restartFromDurableState(), { seed: false });
      const sentinelInitialScm = sentinel.scmSnapshots[0];
      expectNoPendingPrimitives(sentinel.fs);
      sentinel.fs.armPersistFailure(SUCCESS_SENTINEL_ORDINAL, kind);
      await importAndRecordResolution(sentinel);
      sentinel.fs.disarmPersistFailure();
      expect(sentinel.fs.didInjectFailure).toBe(false);
      const primitiveCount = sentinel.fs.persistPrimitiveCount;
      expect(primitiveCount).toBeGreaterThan(0);
      expect(primitiveCount).toBeLessThan(SUCCESS_SENTINEL_ORDINAL);
      expectSuccessfulImportState(sentinel, before, sentinelInitialScm);
      const sentinelRestart = sentinel.fs.restartFromDurableState();
      expect(sentinelRestart.liveSnapshot()).toEqual(after);
      expect(sentinelRestart.durableSnapshot()).toEqual(after);
      sentinel.crash();
      const sentinelReopened = await harness(sentinelRestart, { seed: false });
      expect(sentinelReopened.fs.liveSnapshot()).toEqual(after);
      expect(sentinelReopened.fs.durableSnapshot()).toEqual(after);
      expectNoPendingPrimitives(sentinelReopened.fs);
      expectRecoveredPublicState(sentinelReopened, 'post', originalPaths);
      await sentinelReopened.close();

      let injectedFailures = 0;
      let recoveredPreStates = 0;
      let recordedCrashBoundaries = 0;
      for (let failAt = 1; failAt <= primitiveCount; failAt += 1) {
        const first = await harness(baseline.restartFromDurableState(), { seed: false });
        expect(first.fs.liveSnapshot()).toEqual(before);
        expect(first.fs.durableSnapshot()).toEqual(before);
        expectNoPendingPrimitives(first.fs);
        const initialScmSnapshot = first.scmSnapshots[0];
        first.fs.armPersistFailure(failAt, kind);

        const outcome = await importAndRecordResolution(first).then(
          () => ({ kind: 'success' as const }),
          (error: unknown) => ({ kind: 'failed' as const, error }),
        );
        first.fs.disarmPersistFailure();

        expect(outcome.kind).toBe('failed');
        if (outcome.kind !== 'failed') throw new Error(`Archive ordinal ${String(failAt)} passed`);
        injectedFailures += 1;
        expect(first.fs.didInjectFailure).toBe(true);
        expect(String(outcome.error)).toMatch(message);
        expect(first.fs.trace).toContainEqual(
          expect.objectContaining({ ordinal: failAt, outcome: 'injected-failure' }),
        );
        expectNoTentativePublications(first, originalPaths, initialScmSnapshot);

        const crashTrees = first.fs.durabilityBoundaries.map(({ durableState }) => durableState);
        expect(crashTrees.length).toBeGreaterThan(0);
        recordedCrashBoundaries += crashTrees.length;
        const finalCrashTree = crashTrees.at(-1);
        if (finalCrashTree === undefined) throw new Error('Archive emitted no durability boundary');
        const finalHardRestart = first.fs.restartFromDurableState();
        expect(finalHardRestart.liveSnapshot()).toEqual(finalCrashTree);
        expect(finalHardRestart.durableSnapshot()).toEqual(finalCrashTree);
        first.crash();

        for (const crashTree of crashTrees) {
          const state = await recoverRecordedDurabilityBoundary({
            crashTree,
            before,
            after,
            originalPaths,
          });
          if (state === 'pre') recoveredPreStates += 1;
        }
      }

      expect(injectedFailures).toBe(primitiveCount);
      expect(recordedCrashBoundaries).toBeGreaterThanOrEqual(primitiveCount);
      expect(recoveredPreStates).toBeGreaterThan(0);
    },
  );
});
