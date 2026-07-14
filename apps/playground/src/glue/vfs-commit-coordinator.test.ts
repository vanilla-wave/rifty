import { describe, expect, it } from 'vitest';
import type {
  HostCommitAck,
  HostCommitRequest,
  OwnerVfsDurabilityReceipt,
  OwnerVfsRevisionFrame,
} from './owner-vfs-protocol.ts';
import { type VfsCommitOwner, createVfsCommitCoordinator } from './vfs-commit-coordinator.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function snapshot(ownerEpoch: string, treeRevision: number): OwnerVfsRevisionFrame {
  return { ownerEpoch, treeRevision };
}

async function settleMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('VfsCommitCoordinator', () => {
  it('claims and sends synchronously, then waits for captured-owner reflection before durability', async () => {
    const apply = deferred<HostCommitAck>();
    const durable = deferred<OwnerVfsDurabilityReceipt>();
    const ownerClosed = deferred<unknown>();
    const sent: HostCommitRequest[] = [];
    const barriers: number[] = [];
    let listener = (_frame: OwnerVfsRevisionFrame): void => {};

    const owner: VfsCommitOwner = {
      ownerEpoch: 'owner-a',
      isAlive: () => true,
      closed: ownerClosed.promise,
      applyHostCommit(request) {
        sent.push(request);
        return apply.promise;
      },
      durabilityBarrier(treeRevision) {
        barriers.push(treeRevision);
        return durable.promise;
      },
    };
    const replacement: VfsCommitOwner = {
      ...owner,
      ownerEpoch: 'owner-b',
    };
    let current = owner;
    const coordinator = createVfsCommitCoordinator({
      captureOwner: () => current,
      subscribeSnapshots(next) {
        listener = next;
        // Subscription may synchronously expose cached state. It predates send.
        next(snapshot('owner-a', 99));
        return () => {};
      },
      timeoutMs: 1_000,
    });

    const committed = coordinator.commit({
      kind: 'write',
      path: '/src/main.ts',
      data: new TextEncoder().encode('new'),
      expectedVersion: 'v1',
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      kind: 'write',
      path: '/src/main.ts',
      expectedVersion: 'v1',
    });
    expect(sent[0]?.operationId).toMatch(/^host-vfs:/);
    expect(barriers).toEqual([]);

    current = replacement;
    apply.resolve({
      operationId: sent[0]!.operationId,
      ownerEpoch: 'owner-a',
      treeRevision: 7,
      versions: [{ path: '/src/main.ts', version: 'v2' }],
    });
    await settleMicrotasks();

    // Pre-send, wrong-owner, and lower-revision frames cannot satisfy reflection.
    listener(snapshot('owner-b', 100));
    listener(snapshot('owner-a', 6));
    await settleMicrotasks();
    expect(barriers).toEqual([]);

    listener(snapshot('owner-a', 7));
    await settleMicrotasks();
    expect(barriers).toEqual([7]);

    durable.resolve({ ownerEpoch: 'owner-a', treeRevision: 7, durability: 'durable' });
    await expect(committed).resolves.toEqual({
      operationId: sent[0]!.operationId,
      ownerEpoch: 'owner-a',
      treeRevision: 7,
      versions: [{ path: '/src/main.ts', version: 'v2' }],
      durability: 'durable',
    });
  });

  it('remembers a post-send snapshot that races ahead of the apply ACK', async () => {
    const apply = deferred<HostCommitAck>();
    const ownerClosed = deferred<unknown>();
    const sent: HostCommitRequest[] = [];
    const barriers: number[] = [];
    let listener = (_frame: OwnerVfsRevisionFrame): void => {};

    const coordinator = createVfsCommitCoordinator({
      captureOwner: () => ({
        ownerEpoch: 'owner-a',
        isAlive: () => true,
        closed: ownerClosed.promise,
        applyHostCommit(request) {
          sent.push(request);
          return apply.promise;
        },
        async durabilityBarrier(treeRevision) {
          barriers.push(treeRevision);
          return { ownerEpoch: 'owner-a', treeRevision, durability: 'ephemeral' };
        },
      }),
      subscribeSnapshots(next) {
        listener = next;
        return () => {};
      },
      timeoutMs: 1_000,
    });

    const committed = coordinator.commit({
      kind: 'mkdir',
      path: '/src',
      expectedVersion: null,
    });
    listener(snapshot('owner-a', 12));
    expect(barriers).toEqual([]);

    apply.resolve({
      operationId: sent[0]!.operationId,
      ownerEpoch: 'owner-a',
      treeRevision: 11,
      versions: [{ path: '/src', version: 'v-dir' }],
    });

    await expect(committed).resolves.toMatchObject({
      treeRevision: 11,
      durability: 'ephemeral',
    });
    expect(barriers).toEqual([11]);
  });
});
