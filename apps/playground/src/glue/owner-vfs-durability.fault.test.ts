import { OpfsFsSync } from '@riftydev/vfs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createOwnerVfsAuthority } from '../workers/owner-vfs-authority.ts';
import {
  type OwnerVfsDurabilityAckMessage,
  decodeOwnerVfsError,
  handleOwnerVfsCommitRequest,
  handleOwnerVfsDurabilityRequest,
} from './owner-vfs-ipc.ts';
import type {
  HostCommitAck,
  OwnerVfsDurabilityReceipt,
  OwnerVfsRevisionFrame,
} from './owner-vfs-protocol.ts';
import { SnapshotFs } from './snapshot-fs.ts';
import { type VfsCommitOwner, createVfsCommitCoordinator } from './vfs-commit-coordinator.ts';
import { collectSnapshot } from './vfs-snapshot-port.ts';

const OPFS_PERSIST_WATCHDOG_MS = 30_000;
const encoder = new TextEncoder();

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function stubRoot(): FileSystemDirectoryHandle {
  return {
    kind: 'directory',
    name: '',
    isSameEntry: () => Promise.resolve(false),
    getFileHandle: () => Promise.reject(new Error('unused OPFS file handle')),
    getDirectoryHandle: () => Promise.reject(new Error('unused OPFS directory handle')),
    removeEntry: () => Promise.reject(new Error('unused OPFS remove')),
    resolve: () => Promise.resolve([]),
    entries: () => {
      throw new Error('unused OPFS iteration');
    },
  } as unknown as FileSystemDirectoryHandle;
}

async function settleMicrotasks(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

function createHarness(writeFile: (path: string, data: Uint8Array) => Promise<void>) {
  const opfs = new OpfsFsSync(stubRoot(), {
    readFile: () => Promise.resolve(new Uint8Array()),
    writeFile,
    rm: () => Promise.resolve(),
  });
  const authority = createOwnerVfsAuthority(opfs, { ownerEpoch: 'owner-opfs' });
  const mirror = new SnapshotFs('/');
  mirror.bindOwner(authority.ownerEpoch);
  const durabilityAcks: OwnerVfsDurabilityAckMessage[] = [];
  let barrierSequence = 0;

  const owner: VfsCommitOwner = {
    ownerEpoch: authority.ownerEpoch,
    isAlive: () => true,
    closed: new Promise<never>(() => {}),
    applyHostCommit(request) {
      return new Promise<HostCommitAck>((resolve, reject) => {
        handleOwnerVfsCommitRequest({
          message: { type: 'rifty:owner-vfs-commit', request },
          apply: (candidate) => authority.applyHostCommit(candidate),
          publishSnapshot: () => mirror.update(collectSnapshot(authority, '/')),
          send: (message) => {
            if (message.ok) resolve(message.ack);
            else reject(decodeOwnerVfsError(message.error));
          },
        });
      });
    },
    durabilityBarrier(treeRevision) {
      return new Promise<OwnerVfsDurabilityReceipt>((resolve, reject) => {
        void handleOwnerVfsDurabilityRequest({
          message: {
            type: 'rifty:owner-vfs-durability',
            barrierId: `barrier-${++barrierSequence}`,
            ownerEpoch: authority.ownerEpoch,
            treeRevision,
          },
          current: () => ({
            ownerEpoch: authority.ownerEpoch,
            treeRevision: authority.treeRevision,
          }),
          durability: 'durable',
          flush: () => authority.flush(),
          send: (message) => {
            durabilityAcks.push(message);
            if (message.ok) resolve(message.receipt);
            else reject(decodeOwnerVfsError(message.error));
          },
        });
      });
    },
  };
  const coordinator = createVfsCommitCoordinator({
    captureOwner: () => owner,
    subscribeSnapshots: (listener: (frame: OwnerVfsRevisionFrame) => void) =>
      mirror.subscribeRevisions(listener),
    timeoutMs: OPFS_PERSIST_WATCHDOG_MS * 2,
  });

  return { authority, coordinator, durabilityAcks, mirror, owner };
}

describe('owner VFS durability integrated faults', () => {
  beforeEach(() => {
    vi.spyOn(OpfsFsSync, 'isSupported').mockReturnValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('reflects an applied write but rejects durability when real OPFS persistence hangs', async () => {
    vi.useFakeTimers();
    const persist = deferred<void>();
    const harness = createHarness(() => persist.promise);

    const committing = harness.coordinator.commit({
      kind: 'write',
      path: '/value.txt',
      data: encoder.encode('applied in owner'),
      expectedVersion: null,
    });
    const outcome = committing.then(
      (receipt) => ({ ok: true as const, receipt }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    await settleMicrotasks();

    expect(harness.authority.treeRevision).toBe(1);
    expect(harness.authority.readFileBytesSync('/value.txt')).toEqual(
      encoder.encode('applied in owner'),
    );
    expect(harness.mirror.readFileBytesSync('/value.txt')).toEqual(
      encoder.encode('applied in owner'),
    );
    expect(harness.mirror.entries()[0]).toMatchObject({
      path: '/value.txt',
      version: harness.authority.versionOf('/value.txt'),
    });
    expect(harness.durabilityAcks).toEqual([]);

    await vi.advanceTimersByTimeAsync(OPFS_PERSIST_WATCHDOG_MS);
    const rejected = await outcome;
    expect(rejected).toMatchObject({
      ok: false,
      error: {
        name: 'PersistFailureError',
        message: expect.stringContaining('did not settle'),
      },
    });
    expect(harness.durabilityAcks).toHaveLength(1);
    expect(harness.durabilityAcks[0]).toMatchObject({ ok: false });
    expect(harness.durabilityAcks).not.toContainEqual(expect.objectContaining({ ok: true }));

    // The browser operation cannot be cancelled. Its ordinary late success
    // heals the ledger, after which the same applied revision is provably durable.
    persist.resolve(undefined);
    await settleMicrotasks();
    await expect(harness.authority.flush()).resolves.toMatchObject({ total: 0 });
    await expect(harness.owner.durabilityBarrier(1)).resolves.toEqual({
      ownerEpoch: 'owner-opfs',
      treeRevision: 1,
      durability: 'durable',
    });
    expect(harness.durabilityAcks.at(-1)).toMatchObject({ ok: true });
  });

  it('reflects an applied write but never emits durable success after an OPFS quota rejection', async () => {
    const harness = createHarness(() => Promise.reject(new Error('quota denied')));

    const outcome = harness.coordinator
      .commit({
        kind: 'write',
        path: '/quota.txt',
        data: encoder.encode('live mirror bytes'),
        expectedVersion: null,
      })
      .then(
        (receipt) => ({ ok: true as const, receipt }),
        (error: unknown) => ({ ok: false as const, error }),
      );

    expect(await outcome).toMatchObject({
      ok: false,
      error: {
        name: 'PersistFailureError',
        message: expect.stringContaining('quota denied'),
      },
    });
    expect(harness.authority.readFileBytesSync('/quota.txt')).toEqual(
      encoder.encode('live mirror bytes'),
    );
    expect(harness.mirror.readFileBytesSync('/quota.txt')).toEqual(
      encoder.encode('live mirror bytes'),
    );
    expect(harness.durabilityAcks).toHaveLength(1);
    expect(harness.durabilityAcks[0]).toMatchObject({ ok: false });
    expect(harness.durabilityAcks).not.toContainEqual(expect.objectContaining({ ok: true }));
  });
});
