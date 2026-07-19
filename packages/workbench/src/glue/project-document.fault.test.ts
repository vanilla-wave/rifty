import { MemoryFsSync } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import type { OwnerVfsRevisionFrame } from '../workbench/project-vfs-contract.ts';
import { type OwnerVfsAuthority, createOwnerVfsAuthority } from '../workers/owner-vfs-authority.ts';
import type {
  HostCommitAck,
  HostCommitOperation,
  HostCommitRequest,
} from './owner-vfs-protocol.ts';
import { VfsVersionConflictError } from './owner-vfs-protocol.ts';
import {
  DirtyProjectDocumentError,
  ProjectDocumentClosedError,
  StaleProjectDocumentError,
  openProjectDocument,
} from './project-document.ts';
import { createVfsCommitCoordinator } from './vfs-commit-coordinator.ts';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

type RevisionAwareInvalidate = (
  reason: 'rename' | 'delete' | 'reset',
  owner: OwnerVfsRevisionFrame,
) => void;

function invalidateAt(
  document: Awaited<ReturnType<typeof openProjectDocument>>,
  reason: 'rename' | 'delete' | 'reset',
  owner: OwnerVfsRevisionFrame,
): void {
  (document.invalidate as RevisionAwareInvalidate)(reason, owner);
}

function invalidateOwner(
  authority: OwnerVfsAuthority,
  reason: 'rename' | 'delete' | 'reset',
): OwnerVfsRevisionFrame {
  const version = authority.versionOf('/src/main.ts');
  if (version === null) throw new Error('test document vanished before invalidation');
  switch (reason) {
    case 'rename':
      authority.applyHostCommit({
        kind: 'rename',
        operationId: `invalidate-${reason}`,
        sourcePath: '/src/main.ts',
        targetPath: '/src/renamed.ts',
        expectedSourceVersion: version,
        expectedTargetVersion: null,
      });
      break;
    case 'delete':
      authority.applyHostCommit({
        kind: 'remove',
        operationId: `invalidate-${reason}`,
        path: '/src/main.ts',
        expectedVersion: version,
      });
      break;
    case 'reset':
      authority.rmSync('/src', { recursive: true, force: false });
      authority.mkdirSync('/src', { recursive: false });
      authority.writeFileSync('/src/main.ts', encoder.encode('reset'));
      break;
  }
  return { ownerEpoch: authority.ownerEpoch, treeRevision: authority.treeRevision };
}

async function openWithRealOwner(options: { readonly applySaveImmediately: boolean }) {
  const authority = createOwnerVfsAuthority(new MemoryFsSync(), { ownerEpoch: 'owner-a' });
  authority.mkdirSync('/src', { recursive: false });
  authority.writeFileSync('/src/main.ts', encoder.encode('base'));
  const ownerClosed = deferred<unknown>();
  const saveApplied = deferred<HostCommitAck>();
  let saveRequest: HostCommitRequest | null = null;
  let reflected = (_frame: OwnerVfsRevisionFrame): void => {};

  const coordinator = createVfsCommitCoordinator({
    captureOwner: () => ({
      ownerEpoch: authority.ownerEpoch,
      isAlive: () => true,
      closed: ownerClosed.promise,
      applyHostCommit(request) {
        saveRequest = request;
        if (options.applySaveImmediately) {
          const ack = authority.applyHostCommit(request);
          void saveApplied.promise.catch(() => {});
          return saveApplied.promise.then(() => ack);
        }
        return saveApplied.promise;
      },
      async durabilityBarrier(treeRevision) {
        return {
          ownerEpoch: authority.ownerEpoch,
          treeRevision: Math.max(treeRevision, authority.treeRevision),
          durability: 'ephemeral' as const,
        };
      },
    }),
    subscribeSnapshots(listener) {
      reflected = listener;
      return () => {};
    },
    timeoutMs: 1_000,
  });
  const opened = authority.snapshot().entries.find((entry) => entry.path === '/src/main.ts');
  if (opened?.kind !== 'file') throw new Error('test document missing');
  const document = await openProjectDocument(
    '/src/main.ts',
    { readVersionedFile: () => Promise.resolve(opened) },
    coordinator,
  );

  return {
    authority,
    document,
    reflect(frame: OwnerVfsRevisionFrame) {
      reflected(frame);
    },
    finishAppliedSave() {
      saveApplied.resolve(
        options.applySaveImmediately
          ? {
              operationId: 'unused',
              ownerEpoch: authority.ownerEpoch,
              treeRevision: authority.treeRevision,
              versions: [],
            }
          : (() => {
              if (saveRequest === null) throw new Error('save request was not captured');
              return authority.applyHostCommit(saveRequest);
            })(),
      );
    },
    rejectAppliedSave(error: unknown) {
      saveApplied.reject(error);
    },
    capturedSaveRequest() {
      if (saveRequest === null) throw new Error('save request was not captured');
      return saveRequest;
    },
  };
}

function openWithCommit(
  commit: (request: HostCommitOperation) => Promise<{
    operationId: string;
    ownerEpoch: string;
    treeRevision: number;
    versions: readonly { path: string; version: string | null }[];
    durability: 'durable' | 'ephemeral';
  }>,
) {
  return openProjectDocument(
    '/src/main.ts',
    {
      async readVersionedFile(path) {
        return {
          path,
          kind: 'file' as const,
          size: 4,
          content: encoder.encode('base'),
          version: 'v1',
        };
      },
    },
    { commit },
  );
}

describe('ProjectDocument fault contract', () => {
  it('preserves the local draft and exact remote bytes after a CAS conflict', async () => {
    const remote = encoder.encode('remote bytes');
    const conflict = new VfsVersionConflictError({
      path: '/src/main.ts',
      expectedVersion: 'v1',
      actualVersion: 'v2',
      actualEntry: {
        path: '/src/main.ts',
        kind: 'file',
        size: remote.byteLength,
        content: remote,
        version: 'v2',
      },
      ownerEpoch: 'owner-a',
      treeRevision: 9,
    });
    const expectedVersions: (string | null)[] = [];
    const document = await openWithCommit(async (operation) => {
      if (operation.kind === 'write') expectedVersions.push(operation.expectedVersion);
      throw conflict;
    });
    document.replace('local draft');

    await expect(document.save()).rejects.toBe(conflict);
    const state = document.snapshot();
    expect(decoder.decode(state.bytes)).toBe('local draft');
    expect(decoder.decode(state.conflict!.remoteBytes!)).toBe('remote bytes');
    expect(state).toMatchObject({
      dirty: true,
      version: 'v1',
      conflict: {
        remoteVersion: 'v2',
        ownerEpoch: 'owner-a',
        treeRevision: 9,
      },
    });

    // A failed save cannot silently rebase. Until an explicit resolution/reopen,
    // later saves remain conditional on the last successfully captured version.
    await expect(document.save()).rejects.toBe(conflict);
    expect(expectedVersions).toEqual(['v1', 'v1']);
  });

  it.each(['rename', 'delete', 'reset'] as const)(
    'rejects a save made stale by %s without marking the draft clean',
    async (reason) => {
      const pending = deferred<{
        operationId: string;
        ownerEpoch: string;
        treeRevision: number;
        versions: readonly { path: string; version: string | null }[];
        durability: 'durable';
      }>();
      const document = await openWithCommit(() => pending.promise);
      document.replace('local');
      const saving = document.save();
      document.invalidate(reason, { ownerEpoch: 'owner-a', treeRevision: 1 });
      pending.resolve({
        operationId: 'test:1',
        ownerEpoch: 'owner-a',
        treeRevision: 2,
        versions: [{ path: '/src/main.ts', version: 'v2' }],
        durability: 'durable',
      });

      await expect(saving).rejects.toMatchObject({
        name: StaleProjectDocumentError.name,
        reason,
      });
      expect(document.snapshot().dirty).toBe(true);
    },
  );

  it.each(['rename', 'delete', 'reset'] as const)(
    'resolves a save owner-serialized before %s even when its ACK settles later',
    async (reason) => {
      const harness = await openWithRealOwner({ applySaveImmediately: true });
      harness.document.replace('saved before invalidation');
      const saving = harness.document.save();

      const invalidation = invalidateOwner(harness.authority, reason);
      invalidateAt(harness.document, reason, invalidation);
      harness.reflect(invalidation);
      harness.finishAppliedSave();

      await expect(saving).resolves.toBeUndefined();
      expect(harness.document.snapshot()).toMatchObject({
        dirty: false,
        staleReason: reason,
        conflict: null,
      });
      expect(decoder.decode(harness.document.snapshot().bytes)).toBe('saved before invalidation');
      if (reason === 'rename') {
        expect(harness.authority.existsSync('/src/main.ts')).toBe(false);
        expect(decoder.decode(harness.authority.readFileBytesSync('/src/renamed.ts'))).toBe(
          'saved before invalidation',
        );
      } else if (reason === 'delete') {
        expect(harness.authority.existsSync('/src/main.ts')).toBe(false);
      } else {
        expect(decoder.decode(harness.authority.readFileBytesSync('/src/main.ts'))).toBe('reset');
      }
    },
  );

  it.each(['rename', 'delete', 'reset'] as const)(
    'rejects a save owner-serialized after %s and preserves owner conflict evidence',
    async (reason) => {
      const harness = await openWithRealOwner({ applySaveImmediately: false });
      harness.document.replace('stale draft');
      const saving = harness.document.save();
      const outcome = expect(saving).rejects.toMatchObject({
        name: StaleProjectDocumentError.name,
        reason,
      });

      const invalidation = invalidateOwner(harness.authority, reason);
      invalidateAt(harness.document, reason, invalidation);
      const request = harness.capturedSaveRequest();
      try {
        harness.authority.applyHostCommit(request);
        throw new Error('stale save unexpectedly committed');
      } catch (error) {
        harness.rejectAppliedSave(error);
      }

      await outcome;
      expect(harness.document.snapshot()).toMatchObject({
        dirty: true,
        staleReason: reason,
        conflict: {
          ownerEpoch: 'owner-a',
          treeRevision: invalidation.treeRevision,
        },
      });
      expect(decoder.decode(harness.document.snapshot().bytes)).toBe('stale draft');
      if (reason === 'rename') {
        expect(harness.authority.existsSync('/src/main.ts')).toBe(false);
        expect(decoder.decode(harness.authority.readFileBytesSync('/src/renamed.ts'))).toBe('base');
        expect(harness.document.snapshot().conflict?.remoteBytes).toBeNull();
      } else if (reason === 'delete') {
        expect(harness.authority.existsSync('/src/main.ts')).toBe(false);
        expect(harness.document.snapshot().conflict?.remoteBytes).toBeNull();
      } else {
        expect(decoder.decode(harness.authority.readFileBytesSync('/src/main.ts'))).toBe('reset');
        expect(
          decoder.decode(harness.document.snapshot().conflict?.remoteBytes ?? new Uint8Array()),
        ).toBe('reset');
      }
    },
  );

  it('preserves a durability failure when a later invalidation also makes the document stale', async () => {
    const persistFailure = new Error('OPFS quota denied');
    const document = await openWithCommit(() => Promise.reject(persistFailure));
    document.replace('local draft');
    const saving = document.save();
    document.invalidate('rename', { ownerEpoch: 'owner-a', treeRevision: 9 });

    await expect(saving).rejects.toBe(persistFailure);
    expect(document.snapshot()).toMatchObject({
      dirty: true,
      staleReason: 'rename',
      conflict: null,
    });
    expect(decoder.decode(document.snapshot().bytes)).toBe('local draft');
  });

  it('requires an explicit dirty-close choice and closes cleanly after discard', async () => {
    const document = await openWithCommit(() => Promise.reject(new Error('must not save')));
    document.replace('local');

    await expect(document.close()).rejects.toBeInstanceOf(DirtyProjectDocumentError);
    await expect(document.close({ dirty: 'discard' })).resolves.toBeUndefined();
    expect(document.snapshot().closed).toBe(true);
    expect(() => document.replace('after close')).toThrow(ProjectDocumentClosedError);
    await expect(document.save()).rejects.toBeInstanceOf(ProjectDocumentClosedError);
  });

  it('dirty close with save crosses the commit before closing', async () => {
    let saves = 0;
    const document = await openWithCommit(async (operation) => {
      saves += 1;
      return {
        operationId: 'test:1',
        ownerEpoch: 'owner-a',
        treeRevision: 2,
        versions: [
          {
            path: operation.kind === 'rename' ? operation.targetPath : operation.path,
            version: 'v2',
          },
        ],
        durability: 'ephemeral',
      };
    });
    document.replace('local');

    await expect(document.close({ dirty: 'save' })).resolves.toBeUndefined();
    expect(saves).toBe(1);
    expect(document.snapshot()).toMatchObject({ closed: true, dirty: false, version: 'v2' });
  });
});
