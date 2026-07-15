import { MemoryFsSync } from '@riftydev/vfs/internal';
import { describe, expect, it, vi } from 'vitest';
import { SnapshotFs } from '../glue/snapshot-fs.ts';
import { createVfsCommitCoordinator } from '../glue/vfs-commit-coordinator.ts';
import { collectSnapshot } from '../glue/vfs-snapshot-port.ts';
import { createOwnerVfsAuthority } from '../workers/owner-vfs-authority.ts';
import {
  ClosedHandleError,
  DirtyProjectDocumentError,
  FileConflictError,
  ProjectDocumentSaveInProgressError,
  ProjectFileOperationError,
  StaleProjectDocumentError,
} from './errors.ts';
import { createProjectContentController } from './project-content.ts';
import type { ProjectDocumentReadEntry } from './project-documents.ts';

const ROOT = '/.rifty/workbench/projects/p-1';
const OWNER_EPOCH = 'owner-content-contract';
const encoder = new TextEncoder();

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  void promise.catch(() => {});
  return { promise, resolve, reject };
}

function publicStrings(value: unknown, seen = new Set<object>()): readonly string[] {
  if (typeof value === 'string' || typeof value === 'number') return [String(value)];
  if (typeof value !== 'object' || value === null || seen.has(value)) return [];
  seen.add(value);
  return Reflect.ownKeys(value).flatMap((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    const name = typeof key === 'string' ? [key] : [];
    return descriptor !== undefined && 'value' in descriptor
      ? [...name, ...publicStrings(descriptor.value, seen)]
      : name;
  });
}

function expectNoOwnerInternals(value: unknown): void {
  const evidence = publicStrings(value);
  expect(evidence.join('\n')).not.toContain(ROOT);
  expect(evidence).not.toContain(OWNER_EPOCH);
  for (const privateKey of ['ownerEpoch', 'treeRevision', 'operationId', 'ack']) {
    expect(evidence).not.toContain(privateKey);
  }
}

async function nextTurn(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function isPending<T>(promise: Promise<T>): Promise<boolean> {
  const marker = Symbol('pending');
  return (await Promise.race([promise, Promise.resolve(marker)])) === marker;
}

function harness() {
  const authority = createOwnerVfsAuthority(new MemoryFsSync(), {
    ownerEpoch: OWNER_EPOCH,
  });
  authority.mkdirSync(ROOT, { recursive: true });
  authority.mkdirSync(`${ROOT}/src`, { recursive: false });
  authority.writeFileSync(`${ROOT}/src/main.ts`, encoder.encode('old'));
  const initialVersion = authority.versionOf(`${ROOT}/src/main.ts`);
  if (initialVersion === null) throw new Error('test source version missing');

  const snapshots = new SnapshotFs(ROOT);
  snapshots.bindOwner(OWNER_EPOCH, ROOT);
  snapshots.update(collectSnapshot(authority, ROOT));
  const ownerClosed = deferred<unknown>();
  const durability = deferred<{
    readonly ownerEpoch: string;
    readonly treeRevision: number;
    readonly durability: 'durable';
  }>();
  const applyHostCommit = vi.fn(async (request) => authority.applyHostCommit(request));
  let durabilityImplementation = (_treeRevision: number) => durability.promise;
  const durabilityBarrier = vi.fn((treeRevision: number) => durabilityImplementation(treeRevision));
  const coordinator = createVfsCommitCoordinator({
    captureOwner: () => ({
      ownerEpoch: OWNER_EPOCH,
      isAlive: () => true,
      closed: ownerClosed.promise,
      applyHostCommit,
      durabilityBarrier,
    }),
    subscribeSnapshots: (listener) => snapshots.subscribeRevisions(listener),
    timeoutMs: 1_000,
  });
  const readVersionedFile = vi.fn(async (path: string): Promise<ProjectDocumentReadEntry> => {
    const entry = authority.snapshot().entries.find((candidate) => candidate.path === path);
    if (entry === undefined) throw new Error(`test file missing: ${path}`);
    if (entry.kind !== 'file') throw new Error(`test path is not a file: ${path}`);
    return {
      ...entry,
      ownerEpoch: authority.ownerEpoch,
      treeRevision: authority.treeRevision,
    };
  });
  const readVersionedDirectory = vi.fn(async (path: string) =>
    authority
      .snapshot()
      .entries.filter((entry) => {
        const separator = entry.path.lastIndexOf('/');
        const parent = separator === 0 ? '/' : entry.path.slice(0, separator);
        return parent === path;
      })
      .map((entry) => ({
        path: entry.path,
        kind: entry.kind,
        size: entry.size,
        version: entry.version,
      })),
  );
  const controller = createProjectContentController({
    projectRoot: ROOT,
    snapshots,
    committer: coordinator,
    readVersionedFile,
    readVersionedDirectory,
  });

  return {
    authority,
    snapshots,
    initialVersion,
    durability,
    durabilityBarrier,
    applyHostCommit,
    readVersionedFile,
    readVersionedDirectory,
    controller,
    setDurability(next: typeof durabilityImplementation) {
      durabilityImplementation = next;
    },
  };
}

function immediateHarness(ownerEpoch = OWNER_EPOCH) {
  const authority = createOwnerVfsAuthority(new MemoryFsSync(), { ownerEpoch });
  authority.mkdirSync(ROOT, { recursive: true });
  authority.mkdirSync(`${ROOT}/src`, { recursive: false });
  authority.writeFileSync(`${ROOT}/src/main.ts`, encoder.encode('old'));
  const initialRawVersion = authority.versionOf(`${ROOT}/src/main.ts`);
  if (initialRawVersion === null) throw new Error('test source version missing');

  const snapshots = new SnapshotFs(ROOT);
  snapshots.bindOwner(ownerEpoch, ROOT);
  snapshots.update(collectSnapshot(authority, ROOT));
  const ownerClosed = deferred<unknown>();
  const applyHostCommit = vi.fn(async (request) => {
    const ack = await authority.applyHostCommit(request);
    snapshots.update(collectSnapshot(authority, ROOT));
    return ack;
  });
  const coordinator = createVfsCommitCoordinator({
    captureOwner: () => ({
      ownerEpoch,
      isAlive: () => true,
      closed: ownerClosed.promise,
      applyHostCommit,
      durabilityBarrier: async (treeRevision) => ({
        ownerEpoch,
        treeRevision,
        durability: 'durable' as const,
      }),
    }),
    subscribeSnapshots: (listener) => snapshots.subscribeRevisions(listener),
    timeoutMs: 1_000,
  });
  const readVersionedFile = vi.fn(async (path: string): Promise<ProjectDocumentReadEntry> => {
    const entry = authority.snapshot().entries.find((candidate) => candidate.path === path);
    if (entry === undefined || entry.kind !== 'file') throw new Error(`test file missing: ${path}`);
    return {
      ...entry,
      ownerEpoch,
      treeRevision: authority.treeRevision,
    };
  });
  const readVersionedDirectory = vi.fn(async (path: string) =>
    authority
      .snapshot()
      .entries.filter((entry) => {
        const separator = entry.path.lastIndexOf('/');
        const parent = separator === 0 ? '/' : entry.path.slice(0, separator);
        return parent === path;
      })
      .map((entry) => ({
        path: entry.path,
        kind: entry.kind,
        size: entry.size,
        version: entry.version,
      })),
  );
  const controller = createProjectContentController({
    projectRoot: ROOT,
    snapshots,
    committer: coordinator,
    readVersionedFile,
    readVersionedDirectory,
  });
  return {
    ownerEpoch,
    authority,
    initialRawVersion,
    applyHostCommit,
    readVersionedFile,
    readVersionedDirectory,
    controller,
  };
}

function expectOpaqueVersion(token: string, rawVersion: string, ownerEpoch = OWNER_EPOCH): void {
  expect(token).not.toBe(rawVersion);
  expect(token).not.toContain(ownerEpoch);
  expect(token).not.toContain(ROOT);
  expect(token).not.toContain('/src/main.ts');
}

describe('ProjectSession public version boundary', () => {
  it('maps every Files and Documents version sibling through one session-local authority', async () => {
    const h = immediateHarness();

    const read = await h.controller.files.readFile('/src/main.ts');
    const listed = await h.controller.files.readdir('/src');
    const snapshotEntry = h.controller.files
      .snapshot()
      .entries.find((entry) => entry.path === '/src/main.ts');
    const document = await h.controller.documents.open('/src/main.ts');
    const listedEntry = listed.find((entry) => entry.path === '/src/main.ts');
    if (listedEntry === undefined || snapshotEntry === undefined) {
      throw new Error('public source entry missing');
    }
    expectOpaqueVersion(read.version, h.initialRawVersion);
    expect([listedEntry.version, snapshotEntry.version, document.snapshot().version]).toEqual([
      read.version,
      read.version,
      read.version,
    ]);

    document.replace('document-save');
    await document.save();
    const documentRawVersion = h.authority.versionOf(`${ROOT}/src/main.ts`);
    const documentVersion = document.snapshot().version;
    if (documentRawVersion === null || documentVersion === null) {
      throw new Error('document save version missing');
    }
    expectOpaqueVersion(documentVersion, documentRawVersion);
    expect(h.applyHostCommit.mock.calls.at(-1)?.[0]).toMatchObject({
      kind: 'write',
      expectedVersion: h.initialRawVersion,
    });

    const written = await h.controller.files.writeFile('/src/main.ts', encoder.encode('files'), {
      expectedVersion: documentVersion,
    });
    const writtenRawVersion = h.authority.versionOf(`${ROOT}/src/main.ts`);
    if (writtenRawVersion === null) throw new Error('written version missing');
    expectOpaqueVersion(written.version, writtenRawVersion);
    expect(h.applyHostCommit.mock.calls.at(-1)?.[0]).toMatchObject({
      kind: 'write',
      expectedVersion: documentRawVersion,
    });

    const conflict = await h.controller.files
      .writeFile('/src/main.ts', encoder.encode('stale'), {
        expectedVersion: documentVersion,
      })
      .catch((error: unknown) => error);
    expect(conflict).toBeInstanceOf(FileConflictError);
    expect(conflict).toMatchObject({
      path: '/src/main.ts',
      expectedVersion: documentVersion,
      actualVersion: written.version,
      actualEntry: { path: '/src/main.ts', version: written.version },
    });
    expectNoOwnerInternals(conflict);

    const directory = await h.controller.files.mkdir('/assets', { expectedVersion: null });
    const directoryRawVersion = h.authority.versionOf(`${ROOT}/assets`);
    if (directoryRawVersion === null) throw new Error('directory version missing');
    expectOpaqueVersion(directory.version, directoryRawVersion);

    const renamed = await h.controller.files.rename('/src/main.ts', '/src/renamed.ts', {
      expectedSourceVersion: written.version,
      expectedTargetVersion: null,
    });
    const renamedRawVersion = h.authority.versionOf(`${ROOT}/src/renamed.ts`);
    if (renamedRawVersion === null) throw new Error('renamed version missing');
    expectOpaqueVersion(renamed.version, renamedRawVersion);
    expect(h.applyHostCommit.mock.calls.at(-1)?.[0]).toMatchObject({
      kind: 'rename',
      expectedSourceVersion: writtenRawVersion,
      expectedTargetVersion: null,
    });

    await h.controller.files.remove('/src/renamed.ts', { expectedVersion: renamed.version });
    expect(h.applyHostCommit.mock.calls.at(-1)?.[0]).toMatchObject({
      kind: 'remove',
      expectedVersion: renamedRawVersion,
    });
  });

  it('rejects a foreign-session token before owner transport', async () => {
    const source = immediateHarness('foreign-source-owner');
    const target = immediateHarness('foreign-target-owner');
    const foreign = await source.controller.files.readFile('/src/main.ts');

    await expect(
      target.controller.files.writeFile('/src/main.ts', encoder.encode('foreign'), {
        expectedVersion: foreign.version,
      }),
    ).rejects.toBeInstanceOf(TypeError);
    expect(target.applyHostCommit).not.toHaveBeenCalled();
    await expect(target.readVersionedFile(`${ROOT}/src/main.ts`)).resolves.toMatchObject({
      content: encoder.encode('old'),
    });
  });
});

type ProjectFilesHandle = ReturnType<typeof immediateHarness>['controller']['files'];

function captureFailure(operation: () => unknown): unknown {
  try {
    operation();
    return null;
  } catch (error) {
    return error;
  }
}

function attemptEveryFileOperation(files: ProjectFilesHandle, version: string) {
  const attempts = [
    files.readFile('/src/main.ts'),
    files.readdir('/src'),
    files.writeFile('/src/main.ts', encoder.encode('late'), { expectedVersion: version }),
    files.mkdir('/late', { expectedVersion: null }),
    files.rename('/src/main.ts', '/src/renamed.ts', {
      expectedSourceVersion: version,
      expectedTargetVersion: null,
    }),
    files.remove('/src/main.ts', { expectedVersion: version }),
  ].map((attempt) =>
    attempt.then(
      () => null,
      (error: unknown) => error,
    ),
  );
  const snapshotFailure = captureFailure(() => files.snapshot());
  let subscribeFailure: unknown = null;
  let unsubscribe: (() => void) | undefined;
  try {
    unsubscribe = files.subscribe(() => {});
  } catch (error) {
    subscribeFailure = error;
  }
  unsubscribe?.();
  return { attempts, snapshotFailure, subscribeFailure };
}

async function expectEveryFileOperationClosed(
  attempts: ReturnType<typeof attemptEveryFileOperation>,
): Promise<void> {
  const failures = await Promise.all(attempts.attempts);
  for (const failure of failures) expect(failure).toBeInstanceOf(ClosedHandleError);
  expect(attempts.snapshotFailure).toBeInstanceOf(ClosedHandleError);
  expect(attempts.subscribeFailure).toBeInstanceOf(ClosedHandleError);
}

describe('ProjectSession content close admission', () => {
  it('fences every Files sibling in the same tick as a clean close', async () => {
    const h = immediateHarness();
    const version = (await h.controller.files.readFile('/src/main.ts')).version;
    const transportBefore = {
      files: h.readVersionedFile.mock.calls.length,
      directories: h.readVersionedDirectory.mock.calls.length,
      commits: h.applyHostCommit.mock.calls.length,
    };

    const closing = h.controller.close();
    const attempts = attemptEveryFileOperation(h.controller.files, version);

    await expectEveryFileOperationClosed(attempts);
    await expect(closing).resolves.toBeUndefined();
    expect(h.readVersionedFile).toHaveBeenCalledTimes(transportBefore.files);
    expect(h.readVersionedDirectory).toHaveBeenCalledTimes(transportBefore.directories);
    expect(h.applyHostCommit).toHaveBeenCalledTimes(transportBefore.commits);
  });

  it('fences every Files sibling while an admitted document open is still pending', async () => {
    const h = immediateHarness();
    const version = (await h.controller.files.readFile('/src/main.ts')).version;
    const pendingRead = deferred<ProjectDocumentReadEntry>();
    h.readVersionedFile.mockImplementationOnce(() => pendingRead.promise);
    const opening = h.controller.documents.open('/src/main.ts');
    const transportBefore = {
      files: h.readVersionedFile.mock.calls.length,
      directories: h.readVersionedDirectory.mock.calls.length,
      commits: h.applyHostCommit.mock.calls.length,
    };

    const closing = h.controller.close();
    const attempts = attemptEveryFileOperation(h.controller.files, version);
    const entry = h.authority
      .snapshot()
      .entries.find((candidate) => candidate.path === `${ROOT}/src/main.ts`);
    if (entry === undefined || entry.kind !== 'file') throw new Error('pending file missing');
    pendingRead.resolve({
      ...entry,
      ownerEpoch: h.ownerEpoch,
      treeRevision: h.authority.treeRevision,
    });

    await expectEveryFileOperationClosed(attempts);
    await expect(opening).rejects.toBeInstanceOf(ClosedHandleError);
    await expect(closing).resolves.toBeUndefined();
    expect(h.readVersionedFile).toHaveBeenCalledTimes(transportBefore.files);
    expect(h.readVersionedDirectory).toHaveBeenCalledTimes(transportBefore.directories);
    expect(h.applyHostCommit).toHaveBeenCalledTimes(transportBefore.commits);
  });

  it('keeps accepted close stable and aggregates every synchronous cleanup failure', async () => {
    const detachFailure = new Error('snapshot detach failed');
    const committerFailure = new Error('committer close failed');
    const committer = {
      commit: vi.fn(async () => {
        throw new Error('commit is not expected');
      }),
      close: vi.fn(() => {
        throw committerFailure;
      }),
    };
    const controller = createProjectContentController({
      projectRoot: ROOT,
      snapshots: {
        entries: () => [],
        subscribe: () => () => {
          throw detachFailure;
        },
      },
      committer,
      readVersionedFile: async () => {
        throw new Error('read is not expected');
      },
      readVersionedDirectory: async () => [],
    });

    const first = controller.close();
    const second = controller.close();
    const failure = await first.catch((error: unknown) => error);

    expect(second).toBe(first);
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([detachFailure, committerFailure]);
    expect(committer.close).toHaveBeenCalledTimes(1);
  });

  it('does not fence Files or Documents when save-in-progress preflight rejects', async () => {
    const h = harness();
    const document = await h.controller.documents.open('/src/main.ts');
    document.replace('saving');
    const saving = document.save();
    const readsBefore = h.readVersionedFile.mock.calls.length;

    await expect(h.controller.close()).rejects.toBeInstanceOf(ProjectDocumentSaveInProgressError);
    await expect(h.controller.files.readFile('/src/main.ts')).resolves.toMatchObject({
      path: '/src/main.ts',
    });
    expect(h.readVersionedFile).toHaveBeenCalledTimes(readsBefore + 1);
    expect(() => document.replace('still-editable')).not.toThrow();

    h.snapshots.update(collectSnapshot(h.authority, ROOT));
    await nextTurn();
    h.durability.resolve({
      ownerEpoch: OWNER_EPOCH,
      treeRevision: h.authority.treeRevision,
      durability: 'durable',
    });
    await expect(saving).resolves.toBeUndefined();
  });
});

type MutationKind = 'rename' | 'remove';

function mutate(
  h: ReturnType<typeof harness>,
  kind: MutationKind,
  expectedVersion: string,
): Promise<{ readonly path: string; readonly version: string } | undefined> {
  if (kind === 'rename') {
    return h.controller.files.rename('/src/main.ts', '/src/renamed.ts', {
      expectedSourceVersion: expectedVersion,
      expectedTargetVersion: null,
    });
  }
  return h.controller.files.remove('/src/main.ts', { expectedVersion }).then(() => undefined);
}

describe.each(['rename', 'remove'] as const)(
  'ProjectSession %s ↔ document save owner ordering',
  (kind) => {
    it('invalidates from owner-applied state before reflection or durability', async () => {
      const h = harness();
      const document = await h.controller.documents.open('/src/main.ts');
      const initialPublicVersion = document.snapshot().version;
      if (initialPublicVersion === null) throw new Error('initial public version missing');
      document.replace('local');

      const mutating = mutate(h, kind, initialPublicVersion);
      const saving = document.save();
      await nextTurn();

      h.controller.invalidate(
        kind === 'rename'
          ? {
              kind,
              sourcePath: '/src/main.ts',
              targetPath: '/src/renamed.ts',
            }
          : { kind, path: '/src/main.ts', recursive: false },
        { ownerEpoch: OWNER_EPOCH, treeRevision: h.authority.treeRevision },
      );

      expect(await isPending(mutating)).toBe(true);
      expect(h.durabilityBarrier).not.toHaveBeenCalled();
      const saveFailure = await saving.catch((error: unknown) => error);
      expect(saveFailure).toBeInstanceOf(StaleProjectDocumentError);
      expect(document.snapshot()).toMatchObject({
        path: '/src/main.ts',
        dirty: true,
        staleReason: kind === 'rename' ? 'rename' : 'delete',
        conflict: {
          actualVersion: null,
          actualBytes: null,
          actualEntry: null,
        },
      });
      expect(() => document.replace('late')).toThrow(StaleProjectDocumentError);

      h.snapshots.update(collectSnapshot(h.authority, ROOT));
      await nextTurn();
      expect(h.durabilityBarrier).toHaveBeenCalledTimes(1);
      expect(await isPending(mutating)).toBe(true);
      h.durability.resolve({
        ownerEpoch: OWNER_EPOCH,
        treeRevision: h.authority.treeRevision,
        durability: 'durable',
      });
      if (kind === 'rename') {
        const renamedVersion = h.authority.versionOf(`${ROOT}/src/renamed.ts`);
        if (renamedVersion === null) throw new Error('renamed version missing');
        const result = await mutating;
        if (result === undefined) throw new Error('rename result missing');
        expect(result.path).toBe('/src/renamed.ts');
        expectOpaqueVersion(result.version, renamedVersion);
      } else {
        await expect(mutating).resolves.toBeUndefined();
      }
    });

    it('does not invalidate when save wins and the stale mutation CAS fails', async () => {
      const h = harness();
      const document = await h.controller.documents.open('/src/main.ts');
      const initialPublicVersion = document.snapshot().version;
      if (initialPublicVersion === null) throw new Error('initial public version missing');
      document.replace('saved-first');

      const saving = document.save();
      const mutating = mutate(h, kind, initialPublicVersion);
      await nextTurn();

      const mutationFailure = await mutating.catch((error: unknown) => error);
      expect(mutationFailure).toBeInstanceOf(FileConflictError);
      expect(mutationFailure).toMatchObject({
        path: '/src/main.ts',
        expectedVersion: initialPublicVersion,
        actualBytes: encoder.encode('saved-first'),
      });
      const actualRawVersion = h.authority.versionOf(`${ROOT}/src/main.ts`);
      const actualPublicVersion = (mutationFailure as FileConflictError).actualVersion;
      if (actualRawVersion === null || actualPublicVersion === null) {
        throw new Error('conflict version missing');
      }
      expectOpaqueVersion(actualPublicVersion, actualRawVersion);
      expect((mutationFailure as FileConflictError).actualEntry?.version).toBe(actualPublicVersion);
      expect(document.snapshot()).toMatchObject({ staleReason: null, dirty: true });
      expect(() => document.replace('still-editable')).not.toThrow();
      expect(await isPending(saving)).toBe(true);
      expect(h.durabilityBarrier).not.toHaveBeenCalled();

      h.snapshots.update(collectSnapshot(h.authority, ROOT));
      await nextTurn();
      expect(h.durabilityBarrier).toHaveBeenCalledTimes(1);
      expect(await isPending(saving)).toBe(true);
      h.durability.resolve({
        ownerEpoch: OWNER_EPOCH,
        treeRevision: h.authority.treeRevision,
        durability: 'durable',
      });
      await expect(saving).resolves.toBeUndefined();
      expect(document.snapshot()).toMatchObject({
        bytes: encoder.encode('still-editable'),
        dirty: true,
        staleReason: null,
      });
    });
  },
);

describe('ProjectSession content failure mapping', () => {
  it('keeps a document dirty and reports applied after generic durability rejection', async () => {
    const h = harness();
    const document = await h.controller.documents.open('/src/main.ts');
    document.replace('saved-but-not-durable');
    const saving = document.save();
    await nextTurn();
    h.snapshots.update(collectSnapshot(h.authority, ROOT));
    await nextTurn();
    h.durability.reject(new Error(`durability failed below ${ROOT} in ${OWNER_EPOCH}`));

    const failure = await saving.catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ProjectFileOperationError);
    expect(failure).toMatchObject({
      operation: 'saveDocument',
      path: '/src/main.ts',
      mutationOutcome: 'applied',
    });
    expectNoOwnerInternals(failure);
    expect(document.snapshot()).toMatchObject({
      bytes: encoder.encode('saved-but-not-durable'),
      dirty: true,
      closed: false,
    });
    const appliedRawVersion = h.authority.versionOf(`${ROOT}/src/main.ts`);
    const appliedPublicVersion = document.snapshot().version;
    if (appliedRawVersion === null || appliedPublicVersion === null) {
      throw new Error('applied save version missing');
    }
    expectOpaqueVersion(appliedPublicVersion, appliedRawVersion);

    h.setDurability(async (treeRevision) => ({
      ownerEpoch: OWNER_EPOCH,
      treeRevision,
      durability: 'durable',
    }));
    const retry = document.save();
    await nextTurn();
    h.snapshots.update(collectSnapshot(h.authority, ROOT));
    await expect(retry).resolves.toBeUndefined();
    expect(h.applyHostCommit.mock.calls[1]?.[0]).toMatchObject({
      kind: 'write',
      expectedVersion: appliedRawVersion,
    });
    const finalRawVersion = h.authority.versionOf(`${ROOT}/src/main.ts`);
    const finalPublicVersion = document.snapshot().version;
    if (finalRawVersion === null || finalPublicVersion === null) {
      throw new Error('retried save version missing');
    }
    expectOpaqueVersion(finalPublicVersion, finalRawVersion);
    expect(finalPublicVersion).not.toBe(appliedPublicVersion);
  });

  it('rejects dirty teardown without fencing either handle, then closes both after discard', async () => {
    const h = harness();
    const document = await h.controller.documents.open('/src/main.ts');
    const initialPublicVersion = document.snapshot().version;
    document.replace('keep-editing');

    await expect(h.controller.close()).rejects.toBeInstanceOf(DirtyProjectDocumentError);
    expect(() => document.replace('still-open')).not.toThrow();
    await expect(h.controller.files.readFile('/src/main.ts')).resolves.toMatchObject({
      path: '/src/main.ts',
      version: initialPublicVersion,
    });

    await document.close({ dirty: 'discard' });
    await expect(h.controller.close()).resolves.toBeUndefined();
    await expect(h.controller.documents.open('/src/main.ts')).rejects.toBeInstanceOf(
      ClosedHandleError,
    );
    await expect(h.controller.files.readFile('/src/main.ts')).rejects.toBeInstanceOf(
      ClosedHandleError,
    );
  });
});
