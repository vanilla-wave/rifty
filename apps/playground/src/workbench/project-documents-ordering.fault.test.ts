import { describe, expect, it, vi } from 'vitest';
import type { HostCommitOperation, OwnerVfsSnapshotEntry } from '../glue/owner-vfs-protocol.ts';
import { VfsCommitAppliedError } from '../glue/owner-vfs-protocol.ts';
import type { VfsCommitReceipt } from '../glue/vfs-commit-coordinator.ts';
import { DirtyProjectDocumentError, ProjectFileOperationError } from './errors.ts';
import { createProjectDocumentsController } from './project-documents.ts';
import { createProjectFileVersionBoundary } from './project-file-boundary.ts';

const ROOT = '/.rifty/workbench/projects/p-1';
const PATH = `${ROOT}/src/main.ts`;
const OWNER_EPOCH = 'owner-documents-ordering-fault';
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

function receipt(versions: VfsCommitReceipt['versions'], treeRevision = 2): VfsCommitReceipt {
  return {
    operationId: `save-${String(treeRevision)}`,
    ownerEpoch: OWNER_EPOCH,
    treeRevision,
    versions,
    durability: 'durable',
  };
}

function harness() {
  const versions = createProjectFileVersionBoundary('documents-ordering-fault');
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
    receipt([{ path: PATH, version: 'file-v2' }]);
  const commit = vi.fn((operation: HostCommitOperation) => commitImpl(operation));
  const controller = createProjectDocumentsController({
    projectRoot: ROOT,
    versions,
    readVersionedFile,
    committer: { commit },
  });

  return {
    controller,
    commit,
    version: (ownerVersion: string) => versions.toPublic(ownerVersion),
    setCommit(next: typeof commitImpl) {
      commitImpl = next;
    },
  };
}

describe('ProjectSession document ordering faults', () => {
  it('preserves applied proof and its CAS base when a later invalidation precedes observation failure', async () => {
    const h = harness();
    const observing = deferred<VfsCommitReceipt>();
    h.setCommit(() => observing.promise);
    const document = await h.controller.documents.open('/src/main.ts');
    document.replace('local');

    const saving = document.save();
    h.controller.invalidate(
      {
        kind: 'rename',
        sourcePath: '/src/main.ts',
        targetPath: '/src/renamed.ts',
      },
      { ownerEpoch: OWNER_EPOCH, treeRevision: 3 },
    );
    observing.reject(
      new VfsCommitAppliedError(
        {
          operationId: 'save-2',
          ownerEpoch: OWNER_EPOCH,
          treeRevision: 2,
          versions: [{ path: PATH, version: 'file-v2' }],
        },
        new Error('snapshot reflection or durability failed'),
      ),
    );

    const failure = await saving.catch((error: unknown) => error);
    expect.soft(failure).toBeInstanceOf(ProjectFileOperationError);
    expect.soft(failure).toMatchObject({
      operation: 'saveDocument',
      path: '/src/main.ts',
      mutationOutcome: 'applied',
    });
    expect.soft(document.snapshot()).toMatchObject({
      version: h.version('file-v2'),
      dirty: true,
      closed: false,
      staleReason: 'rename',
    });
  });

  it('keeps dirty-close priority after invalidation and permits explicit discard retry', async () => {
    const h = harness();
    const document = await h.controller.documents.open('/src/main.ts');
    document.replace('local');
    h.controller.invalidate(
      { kind: 'remove', path: '/src/main.ts' },
      { ownerEpoch: OWNER_EPOCH, treeRevision: 2 },
    );

    const failure = await document.close().catch((error: unknown) => error);
    expect.soft(failure).toBeInstanceOf(DirtyProjectDocumentError);
    expect.soft(document.snapshot()).toMatchObject({
      dirty: true,
      closed: false,
      staleReason: 'delete',
    });

    await expect(document.close({ dirty: 'discard' })).resolves.toBeUndefined();
    expect(document.snapshot()).toMatchObject({ closed: true, staleReason: 'delete' });
  });

  it.each([
    {
      name: 'an extra path',
      versions: [
        { path: PATH, version: 'file-v2' },
        { path: `${ROOT}/src/extra.ts`, version: 'extra-v1' },
      ],
    },
    {
      name: 'a duplicate path',
      versions: [
        { path: PATH, version: 'file-v2' },
        { path: PATH, version: 'file-v2-duplicate' },
      ],
    },
    {
      name: 'only the wrong path',
      versions: [{ path: `${ROOT}/src/other.ts`, version: 'other-v1' }],
    },
    {
      name: 'a null target version',
      versions: [{ path: PATH, version: null }],
    },
  ])(
    'rejects a success receipt with $name as applied without changing the CAS base',
    async ({ versions }) => {
      const h = harness();
      h.setCommit(async () => receipt(versions));
      const document = await h.controller.documents.open('/src/main.ts');
      document.replace('local');

      const failure = await document.save().then(
        () => null,
        (error: unknown) => error,
      );
      expect.soft(failure).toBeInstanceOf(ProjectFileOperationError);
      expect.soft(failure).toMatchObject({
        operation: 'saveDocument',
        path: '/src/main.ts',
        mutationOutcome: 'applied',
      });
      expect.soft(document.snapshot()).toMatchObject({
        version: h.version('file-v1'),
        dirty: true,
        closed: false,
      });

      h.setCommit(async () => receipt([{ path: PATH, version: 'file-v3' }], 3));
      await expect(document.save()).resolves.toBeUndefined();
      expect.soft(h.commit.mock.calls[1]?.[0]).toMatchObject({
        kind: 'write',
        path: PATH,
        expectedVersion: 'file-v1',
        data: encoder.encode('local'),
      });
      expect(document.snapshot()).toMatchObject({
        version: h.version('file-v3'),
        dirty: false,
      });
    },
  );
});
