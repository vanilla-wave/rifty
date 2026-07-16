import { describe, expect, it, vi } from 'vitest';
import type { HostCommitOperation, OwnerVfsSnapshotEntry } from '../glue/owner-vfs-protocol.ts';
import { VfsCommitAppliedError, VfsVersionConflictError } from '../glue/owner-vfs-protocol.ts';
import type { VfsCommitReceipt } from '../glue/vfs-commit-coordinator.ts';
import {
  ClosedHandleError,
  DirtyProjectDocumentError,
  FileConflictError,
  ProjectDocumentSaveInProgressError,
  ProjectFileOperationError,
  StaleProjectDocumentError,
} from './errors.ts';
import { createProjectDocumentsController } from './project-documents.ts';
import { createProjectFileVersionBoundary } from './project-file-boundary.ts';

const ROOT = '/.rifty/workbench/projects/p-1';
const OWNER_EPOCH = 'owner-documents-contract';
const encoder = new TextEncoder();

type VersionedEntry = Extract<OwnerVfsSnapshotEntry, { readonly kind: 'file' }> & {
  readonly ownerEpoch: string;
  readonly treeRevision: number;
};

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

async function isPending<T>(promise: Promise<T>): Promise<boolean> {
  const marker = Symbol('pending');
  return (await Promise.race([promise, Promise.resolve(marker)])) === marker;
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
  const evidence = publicStrings(value).join('\n');
  expect(evidence).not.toContain(ROOT);
  expect(evidence).not.toContain(OWNER_EPOCH);
  for (const privateKey of ['ownerEpoch', 'treeRevision', 'operationId', 'ack']) {
    expect(publicStrings(value)).not.toContain(privateKey);
  }
}

function receipt(version: string, treeRevision = 2): VfsCommitReceipt {
  return {
    operationId: `save-${String(treeRevision)}`,
    ownerEpoch: OWNER_EPOCH,
    treeRevision,
    versions: [{ path: `${ROOT}/src/main.ts`, version }],
    durability: 'durable',
  };
}

function harness() {
  const versions = createProjectFileVersionBoundary('project-documents-contract');
  const readVersionedFile = vi.fn(
    async (path: string): Promise<VersionedEntry> => ({
      path,
      kind: 'file',
      size: 3,
      content: encoder.encode('old'),
      version: 'file-v1',
      ownerEpoch: OWNER_EPOCH,
      treeRevision: 1,
    }),
  );
  let commitImpl: (operation: HostCommitOperation) => Promise<VfsCommitReceipt> = async () =>
    receipt('file-v2');
  const commit = vi.fn((operation: Parameters<typeof commitImpl>[0]) => commitImpl(operation));
  const controller = createProjectDocumentsController({
    projectRoot: ROOT,
    versions,
    readVersionedFile,
    committer: { commit },
  });
  return {
    controller,
    readVersionedFile,
    commit,
    version: (ownerVersion: string) => versions.toPublic(ownerVersion),
    setCommit(next: typeof commitImpl) {
      commitImpl = next;
    },
  };
}

describe('ProjectSession documents contract', () => {
  it('opens bytes+version atomically and keeps an edit made during save dirty', async () => {
    const h = harness();
    const saving = deferred<VfsCommitReceipt>();
    h.setCommit(() => saving.promise);
    const document = await h.controller.documents.open('/src/main.ts');

    expect(document.snapshot()).toMatchObject({
      path: '/src/main.ts',
      bytes: encoder.encode('old'),
      version: h.version('file-v1'),
      dirty: false,
      conflict: null,
    });
    expect(h.readVersionedFile).toHaveBeenCalledWith(`${ROOT}/src/main.ts`);

    document.replace('one');
    const firstSave = document.save();
    expect(h.commit).toHaveBeenCalledTimes(1);
    expect(h.commit.mock.calls[0]?.[0]).toMatchObject({
      kind: 'write',
      path: `${ROOT}/src/main.ts`,
      expectedVersion: 'file-v1',
      data: encoder.encode('one'),
    });
    const secondEdit = encoder.encode('two');
    document.replace(secondEdit);
    secondEdit[0] = 0;
    saving.resolve(receipt('file-v2'));
    await firstSave;

    expect(document.snapshot()).toMatchObject({
      path: '/src/main.ts',
      bytes: encoder.encode('two'),
      version: h.version('file-v2'),
      dirty: true,
    });

    h.setCommit(async () => receipt('file-v3', 3));
    await document.save();
    expect(h.commit.mock.calls[1]?.[0]).toMatchObject({
      kind: 'write',
      path: `${ROOT}/src/main.ts`,
      expectedVersion: 'file-v2',
      data: encoder.encode('two'),
    });
  });

  it('surfaces exact remote bytes without rebasing or leaking owner identity', async () => {
    const h = harness();
    const remote = encoder.encode('new');
    h.setCommit(async () => {
      throw new VfsVersionConflictError({
        path: `${ROOT}/src/main.ts`,
        expectedVersion: 'file-v1',
        actualVersion: 'file-v2',
        actualEntry: {
          path: `${ROOT}/src/main.ts`,
          kind: 'file',
          size: remote.byteLength,
          content: remote,
          version: 'file-v2',
        },
        ownerEpoch: OWNER_EPOCH,
        treeRevision: 2,
      });
    });
    const document = await h.controller.documents.open('/src/main.ts');
    document.replace('our');

    const failure = await document.save().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(FileConflictError);
    expect(failure).toMatchObject({
      path: '/src/main.ts',
      expectedVersion: h.version('file-v1'),
      actualVersion: h.version('file-v2'),
    });
    expect((failure as FileConflictError).actualBytes).toEqual(encoder.encode('new'));
    expect(document.snapshot()).toMatchObject({
      bytes: encoder.encode('our'),
      version: h.version('file-v1'),
      dirty: true,
      conflict: {
        actualVersion: h.version('file-v2'),
        actualBytes: encoder.encode('new'),
        actualEntry: {
          path: '/src/main.ts',
          kind: 'file',
          size: 3,
          version: h.version('file-v2'),
        },
      },
    });
    expectNoOwnerInternals(failure);
    expectNoOwnerInternals(document.snapshot());
    expect(Reflect.ownKeys(document.snapshot().conflict ?? {})).not.toEqual(
      expect.arrayContaining(['ownerEpoch', 'treeRevision']),
    );
    const exposed = document.snapshot();
    exposed.bytes[0] = 0;
    if (exposed.conflict?.actualBytes !== null && exposed.conflict?.actualBytes !== undefined) {
      exposed.conflict.actualBytes[0] = 0;
    }
    if (exposed.conflict?.actualEntry !== null && exposed.conflict?.actualEntry !== undefined) {
      (exposed.conflict.actualEntry as { path: string }).path = '/mutated.ts';
    }
    expect(document.snapshot()).toMatchObject({
      bytes: encoder.encode('our'),
      conflict: {
        actualBytes: encoder.encode('new'),
        actualEntry: { path: '/src/main.ts' },
      },
    });
    expect(h.commit).toHaveBeenCalledTimes(1);
  });

  it('maps atomic-open and applied-save failures to safe public evidence', async () => {
    const opening = harness();
    opening.readVersionedFile.mockRejectedValueOnce(
      new Error(`read failed below ${ROOT} in ${OWNER_EPOCH}`),
    );
    const openFailure = await opening.controller.documents
      .open('/src/main.ts')
      .catch((error: unknown) => error);
    expect(openFailure).toBeInstanceOf(ProjectFileOperationError);
    expect(openFailure).toMatchObject({
      operation: 'openDocument',
      path: '/src/main.ts',
      mutationOutcome: null,
    });
    expectNoOwnerInternals(openFailure);

    const saving = harness();
    saving.setCommit(async () => {
      throw new VfsCommitAppliedError(
        {
          operationId: 'save-private-operation',
          ownerEpoch: OWNER_EPOCH,
          treeRevision: 2,
          versions: [{ path: `${ROOT}/src/main.ts`, version: 'file-v2' }],
        },
        new Error(`save observation failed below ${ROOT}`),
      );
    });
    const document = await saving.controller.documents.open('/src/main.ts');
    document.replace('new');
    const saveFailure = await document.save().catch((error: unknown) => error);
    expect(saveFailure).toBeInstanceOf(ProjectFileOperationError);
    expect(saveFailure).toMatchObject({
      operation: 'saveDocument',
      path: '/src/main.ts',
      mutationOutcome: 'applied',
    });
    expectNoOwnerInternals(saveFailure);
    expect(document.snapshot()).toMatchObject({
      version: saving.version('file-v2'),
      dirty: true,
      closed: false,
    });

    saving.setCommit(async () => receipt('file-v3', 3));
    await expect(document.save()).resolves.toBeUndefined();
    expect(saving.commit.mock.calls[1]?.[0]).toMatchObject({
      kind: 'write',
      path: `${ROOT}/src/main.ts`,
      expectedVersion: 'file-v2',
      data: encoder.encode('new'),
    });
    expect(document.snapshot()).toMatchObject({
      version: saving.version('file-v3'),
      dirty: false,
    });

    const unknown = harness();
    unknown.setCommit(async () => {
      throw new Error(`owner outcome unknown below ${ROOT}`);
    });
    const unknownDocument = await unknown.controller.documents.open('/src/main.ts');
    unknownDocument.replace('unknown');
    const unknownFailure = await unknownDocument.save().catch((error: unknown) => error);
    expect(unknownFailure).toBeInstanceOf(ProjectFileOperationError);
    expect(unknownFailure).toMatchObject({
      operation: 'saveDocument',
      path: '/src/main.ts',
      mutationOutcome: 'unknown',
    });
    expectNoOwnerInternals(unknownFailure);
    expect(unknownDocument.snapshot()).toMatchObject({
      version: unknown.version('file-v1'),
      dirty: true,
    });
    unknown.setCommit(async () => receipt('file-v2', 2));
    await unknownDocument.save();
    expect(unknown.commit.mock.calls[1]?.[0]).toMatchObject({
      expectedVersion: 'file-v1',
      data: encoder.encode('unknown'),
    });
  });

  it('never discards a dirty document without an explicit save or discard choice', async () => {
    const h = harness();
    const document = await h.controller.documents.open('/src/main.ts');
    document.replace('dirty');

    await expect(document.close()).rejects.toBeInstanceOf(DirtyProjectDocumentError);
    const failure = await document.close().catch((error: unknown) => error);
    expectNoOwnerInternals(failure);
    expect(document.snapshot().closed).toBe(false);
    await document.close({ dirty: 'discard' });
    expect(document.snapshot().closed).toBe(true);
    expect(() => document.replace('late')).toThrow(ClosedHandleError);
    await expect(document.save()).rejects.toBeInstanceOf(ClosedHandleError);
    expect(h.commit).not.toHaveBeenCalled();
  });

  it('saves a dirty document only when close explicitly chooses save', async () => {
    const h = harness();
    const document = await h.controller.documents.open('/src/main.ts');
    document.replace('saved-on-close');

    await document.close({ dirty: 'save' });

    expect(h.commit).toHaveBeenCalledTimes(1);
    expect(h.commit.mock.calls[0]?.[0]).toMatchObject({
      kind: 'write',
      path: `${ROOT}/src/main.ts`,
      data: encoder.encode('saved-on-close'),
      expectedVersion: 'file-v1',
    });
    expect(document.snapshot()).toMatchObject({
      path: '/src/main.ts',
      version: h.version('file-v2'),
      dirty: false,
      closed: true,
    });
  });

  it('close-save preserves an edit made during an already admitted save', async () => {
    const h = harness();
    const first = deferred<VfsCommitReceipt>();
    const second = deferred<VfsCommitReceipt>();
    let saveNumber = 0;
    h.setCommit(() => (++saveNumber === 1 ? first.promise : second.promise));
    const document = await h.controller.documents.open('/src/main.ts');
    document.replace('first');
    const admitted = document.save();
    document.replace('second');

    const closing = document.close({ dirty: 'save' });
    expect(h.commit).toHaveBeenCalledTimes(1);
    first.resolve(receipt('file-v2', 2));
    await admitted;
    await Promise.resolve();
    expect(h.commit).toHaveBeenCalledTimes(2);
    expect(h.commit.mock.calls[1]?.[0]).toMatchObject({
      kind: 'write',
      path: `${ROOT}/src/main.ts`,
      data: encoder.encode('second'),
      expectedVersion: 'file-v2',
    });
    expect(document.snapshot()).toMatchObject({ dirty: true, closed: false });

    second.resolve(receipt('file-v3', 3));
    await expect(closing).resolves.toBeUndefined();
    expect(document.snapshot()).toMatchObject({
      bytes: encoder.encode('second'),
      version: h.version('file-v3'),
      dirty: false,
      closed: true,
    });
  });

  it('close-discard during a save does not cancel or rewrite the admitted outcome', async () => {
    const h = harness();
    const saving = deferred<VfsCommitReceipt>();
    h.setCommit(() => saving.promise);
    const document = await h.controller.documents.open('/src/main.ts');
    document.replace('saving');
    const admitted = document.save();

    await expect(document.close({ dirty: 'discard' })).rejects.toBeInstanceOf(
      ProjectDocumentSaveInProgressError,
    );
    expect(document.snapshot().closed).toBe(false);
    saving.resolve(receipt('file-v2'));
    await expect(admitted).resolves.toBeUndefined();
    expect(document.snapshot()).toMatchObject({ dirty: false, closed: false });
  });

  it('invalidates every affected open document after an owner-serial rename or remove', async () => {
    const h = harness();
    const source = await h.controller.documents.open('/src/main.ts');
    const target = await h.controller.documents.open('/src/target.ts');
    const sibling = await h.controller.documents.open('/src/sibling.ts');

    h.controller.invalidate(
      {
        kind: 'rename',
        sourcePath: '/src/main.ts',
        targetPath: '/src/target.ts',
      },
      { ownerEpoch: OWNER_EPOCH, treeRevision: 5 },
    );

    expect(() => source.replace('x')).toThrow(StaleProjectDocumentError);
    expect(() => target.replace('x')).toThrow(StaleProjectDocumentError);
    expect(() => sibling.replace('x')).not.toThrow();

    h.controller.invalidate(
      { kind: 'remove', path: '/src', recursive: true },
      { ownerEpoch: OWNER_EPOCH, treeRevision: 6 },
    );
    expect(() => sibling.replace('again')).toThrow(StaleProjectDocumentError);
    const stale = (() => {
      try {
        source.replace('again');
      } catch (error) {
        return error;
      }
      throw new Error('Expected stale document failure');
    })();
    expectNoOwnerInternals(stale);
  });

  it('orders invalidation against an admitted atomic open by owner revision', async () => {
    const staleHarness = harness();
    const staleRead = deferred<VersionedEntry>();
    staleHarness.readVersionedFile.mockImplementationOnce(() => staleRead.promise);
    const staleOpening = staleHarness.controller.documents.open('/src/main.ts');
    staleHarness.controller.invalidate(
      {
        kind: 'rename',
        sourcePath: '/src/main.ts',
        targetPath: '/src/renamed.ts',
      },
      { ownerEpoch: OWNER_EPOCH, treeRevision: 2 },
    );
    staleRead.resolve({
      path: `${ROOT}/src/main.ts`,
      kind: 'file',
      size: 3,
      content: encoder.encode('old'),
      version: 'file-v1',
      ownerEpoch: OWNER_EPOCH,
      treeRevision: 1,
    });
    await expect(staleOpening).rejects.toBeInstanceOf(StaleProjectDocumentError);

    const currentHarness = harness();
    const currentRead = deferred<VersionedEntry>();
    currentHarness.readVersionedFile.mockImplementationOnce(() => currentRead.promise);
    const currentOpening = currentHarness.controller.documents.open('/src/renamed.ts');
    currentHarness.controller.invalidate(
      {
        kind: 'rename',
        sourcePath: '/src/main.ts',
        targetPath: '/src/renamed.ts',
      },
      { ownerEpoch: OWNER_EPOCH, treeRevision: 2 },
    );
    currentRead.resolve({
      path: `${ROOT}/src/renamed.ts`,
      kind: 'file',
      size: 3,
      content: encoder.encode('new'),
      version: 'file-v2',
      ownerEpoch: OWNER_EPOCH,
      treeRevision: 2,
    });
    const current = await currentOpening;
    expect(() => current.replace('editable')).not.toThrow();
    expect(current.snapshot()).toMatchObject({
      version: currentHarness.version('file-v2'),
      staleReason: null,
    });
  });

  it('unconditionally lifecycle-invalidates tracked and admitted documents', async () => {
    const h = harness();
    const tracked = await h.controller.documents.open('/src/main.ts');
    const pendingRead = deferred<VersionedEntry>();
    h.readVersionedFile.mockImplementationOnce(() => pendingRead.promise);
    const opening = h.controller.documents.open('/src/pending.ts');

    h.controller.invalidateAll('reset');
    expect(tracked.snapshot()).toMatchObject({ staleReason: 'reset', closed: false });

    pendingRead.resolve({
      path: `${ROOT}/src/pending.ts`,
      kind: 'file',
      size: 3,
      content: encoder.encode('new'),
      version: 'file-v99',
      ownerEpoch: OWNER_EPOCH,
      treeRevision: 99,
    });
    await expect(opening).rejects.toMatchObject({ reason: 'reset' });
  });

  it('rejects every invalid public path before the atomic owner read', async () => {
    const h = harness();

    for (const path of [
      '',
      'src/main.ts',
      '//src/main.ts',
      '/src//main.ts',
      '/src/',
      '/src/./main.ts',
      '/src/../main.ts',
      '/.rifty',
      '/.rifty/profile',
      '/src/\0main.ts',
    ]) {
      await expect(h.controller.documents.open(path)).rejects.toBeInstanceOf(TypeError);
    }
    expect(h.readVersionedFile).not.toHaveBeenCalled();
  });

  it('refuses controller teardown while a dirty document exists without fencing it', async () => {
    const h = harness();
    const cleanSibling = await h.controller.documents.open('/src/clean.ts');
    const document = await h.controller.documents.open('/src/main.ts');
    document.replace('dirty');

    await expect(h.controller.close()).rejects.toBeInstanceOf(DirtyProjectDocumentError);
    expect(cleanSibling.snapshot().closed).toBe(false);
    expect(() => document.replace('still-editable')).not.toThrow();
    await expect(h.controller.documents.open('/src/another.ts')).resolves.toBeDefined();

    await document.close({ dirty: 'discard' });
    await expect(h.controller.close()).resolves.toBeUndefined();
    await expect(h.controller.documents.open('/src/late.ts')).rejects.toBeInstanceOf(
      ClosedHandleError,
    );
  });

  it('does not cancel or rewrite an admitted save when controller close is attempted', async () => {
    const h = harness();
    const saving = deferred<VfsCommitReceipt>();
    h.setCommit(() => saving.promise);
    const document = await h.controller.documents.open('/src/main.ts');
    document.replace('saving');
    const admittedSave = document.save();

    await expect(h.controller.close()).rejects.toBeInstanceOf(ProjectDocumentSaveInProgressError);
    saving.resolve(receipt('file-v2'));
    await expect(admittedSave).resolves.toBeUndefined();
    expect(document.snapshot()).toMatchObject({ dirty: false, closed: false });

    await expect(h.controller.close()).resolves.toBeUndefined();
    expect(document.snapshot().closed).toBe(true);
  });

  it('fences same-tick opens and closes every clean sibling after successful preflight', async () => {
    const h = harness();
    const first = await h.controller.documents.open('/src/first.ts');
    const second = await h.controller.documents.open('/src/second.ts');
    const readsBeforeClose = h.readVersionedFile.mock.calls.length;

    const closing = h.controller.close();
    const lateOpen = h.controller.documents.open('/src/late.ts');

    await expect(lateOpen).rejects.toBeInstanceOf(ClosedHandleError);
    expect(h.readVersionedFile).toHaveBeenCalledTimes(readsBeforeClose);
    await expect(closing).resolves.toBeUndefined();
    expect(first.snapshot().closed).toBe(true);
    expect(second.snapshot().closed).toBe(true);
  });

  it('waits for an admitted open and never exposes a live document after close', async () => {
    const h = harness();
    const reading = deferred<VersionedEntry>();
    h.readVersionedFile.mockImplementationOnce(() => reading.promise);

    const opening = h.controller.documents.open('/src/main.ts');
    const closing = h.controller.close();
    expect(await isPending(closing)).toBe(true);

    reading.resolve({
      path: `${ROOT}/src/main.ts`,
      kind: 'file',
      size: 3,
      content: encoder.encode('old'),
      version: 'file-v1',
      ownerEpoch: OWNER_EPOCH,
      treeRevision: 1,
    });
    await expect(opening).rejects.toBeInstanceOf(ClosedHandleError);
    await expect(closing).resolves.toBeUndefined();
    await expect(h.controller.documents.open('/src/late.ts')).rejects.toBeInstanceOf(
      ClosedHandleError,
    );
  });
});
