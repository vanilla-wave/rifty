import { describe, expect, it } from 'vitest';
import type { OwnerVfsRevisionFrame } from '../workbench/project-vfs-contract.ts';
import type {
  HostCommitAck,
  HostCommitRequest,
  OwnerVfsDurabilityReceipt,
} from './owner-vfs-protocol.ts';
import { VfsCommitAppliedError, VfsCommitProtocolError } from './owner-vfs-protocol.ts';
import {
  type VfsCommitOwner,
  VfsOwnerExitedError,
  createVfsCommitCoordinator,
} from './vfs-commit-coordinator.ts';

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

  it('publishes each validated applied ACK before reflection and never publishes a failed apply', async () => {
    const ownerClosed = deferred<unknown>();
    const firstApply = deferred<HostCommitAck>();
    const secondFailure = new Error('CAS rejected');
    const sent: HostCommitRequest[] = [];
    const applied: unknown[] = [];
    const listeners = new Set<(frame: OwnerVfsRevisionFrame) => void>();
    let call = 0;
    const coordinator = createVfsCommitCoordinator({
      captureOwner: () => ({
        ownerEpoch: 'owner-a',
        isAlive: () => true,
        closed: ownerClosed.promise,
        applyHostCommit(request) {
          sent.push(request);
          call++;
          return call === 1 ? firstApply.promise : Promise.reject(secondFailure);
        },
        async durabilityBarrier(treeRevision) {
          return { ownerEpoch: 'owner-a', treeRevision, durability: 'durable' };
        },
      }),
      subscribeSnapshots(next) {
        listeners.add(next);
        return () => listeners.delete(next);
      },
      timeoutMs: 1_000,
    });
    const removing = coordinator.commit(
      {
        kind: 'remove',
        path: '/src/main.ts',
        expectedVersion: 'v1',
      },
      {
        onApplied: (revision: OwnerVfsRevisionFrame) => applied.push(revision),
      },
    );
    firstApply.resolve({
      operationId: sent[0]!.operationId,
      ownerEpoch: 'owner-a',
      treeRevision: 2,
      versions: [{ path: '/src/main.ts', version: null }],
    });
    await settleMicrotasks();
    try {
      expect(applied).toEqual([{ ownerEpoch: 'owner-a', treeRevision: 2 }]);
      expect(await Promise.race([removing, Promise.resolve('pending')])).toBe('pending');

      const failed = coordinator.commit(
        {
          kind: 'remove',
          path: '/src/other.ts',
          expectedVersion: 'v-other',
        },
        { onApplied: (revision: OwnerVfsRevisionFrame) => applied.push(revision) },
      );
      await expect(failed).rejects.toBe(secondFailure);
      expect(applied).toHaveLength(1);
    } finally {
      for (const listener of listeners) listener(snapshot('owner-a', 2));
      await removing.catch(() => {});
    }
  });

  it('reports an applied commit when its correctness-critical ACK observer fails', async () => {
    const ownerClosed = deferred<unknown>();
    const observerFailure = new Error('document invalidation failed');
    let durabilityCalls = 0;
    let listener = (_frame: OwnerVfsRevisionFrame): void => {};
    const coordinator = createVfsCommitCoordinator({
      captureOwner: () => ({
        ownerEpoch: 'owner-a',
        isAlive: () => true,
        closed: ownerClosed.promise,
        applyHostCommit(request) {
          return Promise.resolve({
            operationId: request.operationId,
            ownerEpoch: 'owner-a',
            treeRevision: 4,
            versions: [{ path: '/src/main.ts', version: null }],
          });
        },
        async durabilityBarrier(treeRevision) {
          durabilityCalls++;
          return { ownerEpoch: 'owner-a', treeRevision, durability: 'durable' };
        },
      }),
      subscribeSnapshots(next) {
        listener = next;
        return () => {};
      },
      timeoutMs: 1_000,
    });

    const committed = coordinator.commit(
      { kind: 'remove', path: '/src/main.ts', expectedVersion: 'v1' },
      {
        onApplied() {
          throw observerFailure;
        },
      },
    );
    const observed = committed.catch((error: unknown) => error);
    await settleMicrotasks();
    const pending = Symbol('pending');
    const failure = await Promise.race([observed, Promise.resolve(pending)]);
    listener(snapshot('owner-a', 4));
    await committed.catch(() => {});

    expect(failure).toBeInstanceOf(VfsCommitAppliedError);
    expect(failure).toMatchObject({
      cause: observerFailure,
      applied: {
        operationId: expect.any(String),
        ownerEpoch: 'owner-a',
        treeRevision: 4,
      },
    });
    expect(durabilityCalls).toBe(0);
  });

  it('preserves applied evidence when durability rejects with a generic error', async () => {
    const ownerClosed = deferred<unknown>();
    const durable = deferred<OwnerVfsDurabilityReceipt>();
    const durabilityFailure = new Error('private durability transport failed');
    let listener = (_frame: OwnerVfsRevisionFrame): void => {};
    const coordinator = createVfsCommitCoordinator({
      captureOwner: () => ({
        ownerEpoch: 'owner-a',
        isAlive: () => true,
        closed: ownerClosed.promise,
        applyHostCommit(request) {
          return Promise.resolve({
            operationId: request.operationId,
            ownerEpoch: 'owner-a',
            treeRevision: 5,
            versions: [{ path: '/src/main.ts', version: 'v2' }],
          });
        },
        durabilityBarrier: () => durable.promise,
      }),
      subscribeSnapshots(next) {
        listener = next;
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
    await settleMicrotasks();
    listener(snapshot('owner-a', 5));
    durable.reject(durabilityFailure);

    const failure = await committed.catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(VfsCommitAppliedError);
    expect(failure).toMatchObject({
      cause: durabilityFailure,
      applied: {
        ownerEpoch: 'owner-a',
        treeRevision: 5,
        versions: [{ path: '/src/main.ts', version: 'v2' }],
      },
    });
  });

  it('preserves applied evidence when the captured owner exits after ACK', async () => {
    const ownerClosed = deferred<unknown>();
    const coordinator = createVfsCommitCoordinator({
      captureOwner: () => ({
        ownerEpoch: 'owner-a',
        isAlive: () => true,
        closed: ownerClosed.promise,
        applyHostCommit(request) {
          return Promise.resolve({
            operationId: request.operationId,
            ownerEpoch: 'owner-a',
            treeRevision: 6,
            versions: [{ path: '/src/main.ts', version: 'v2' }],
          });
        },
        async durabilityBarrier(treeRevision) {
          return { ownerEpoch: 'owner-a', treeRevision, durability: 'durable' };
        },
      }),
      subscribeSnapshots: () => () => {},
      timeoutMs: 1_000,
    });

    const committed = coordinator.commit({
      kind: 'write',
      path: '/src/main.ts',
      data: new TextEncoder().encode('new'),
      expectedVersion: 'v1',
    });
    await settleMicrotasks();
    ownerClosed.resolve(new Error('owner exited'));

    const failure = await committed.catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(VfsCommitAppliedError);
    expect(failure).toMatchObject({
      applied: { ownerEpoch: 'owner-a', treeRevision: 6 },
      cause: expect.any(VfsOwnerExitedError),
    });
  });

  it('preserves applied evidence for malformed durability and cleanup failures', async () => {
    const run = async (mode: 'malformed-durability' | 'cleanup') => {
      const ownerClosed = deferred<unknown>();
      let listener = (_frame: OwnerVfsRevisionFrame): void => {};
      const cleanupFailure = new Error('snapshot unsubscribe failed');
      const coordinator = createVfsCommitCoordinator({
        captureOwner: () => ({
          ownerEpoch: 'owner-a',
          isAlive: () => true,
          closed: ownerClosed.promise,
          applyHostCommit(request) {
            return Promise.resolve({
              operationId: request.operationId,
              ownerEpoch: 'owner-a',
              treeRevision: 7,
              versions: [{ path: '/src/main.ts', version: 'v2' }],
            });
          },
          async durabilityBarrier(treeRevision) {
            return mode === 'malformed-durability'
              ? { ownerEpoch: 'owner-b', treeRevision, durability: 'durable' }
              : { ownerEpoch: 'owner-a', treeRevision, durability: 'durable' };
          },
        }),
        subscribeSnapshots(next) {
          listener = next;
          return () => {
            if (mode === 'cleanup') throw cleanupFailure;
          };
        },
        timeoutMs: 1_000,
      });
      const committed = coordinator.commit({
        kind: 'write',
        path: '/src/main.ts',
        data: new TextEncoder().encode('new'),
        expectedVersion: 'v1',
      });
      await settleMicrotasks();
      listener(snapshot('owner-a', 7));
      return committed.catch((error: unknown) => error);
    };

    const malformed = await run('malformed-durability');
    expect(malformed).toBeInstanceOf(VfsCommitAppliedError);
    expect(malformed).toMatchObject({
      applied: { ownerEpoch: 'owner-a', treeRevision: 7 },
      cause: expect.any(VfsCommitProtocolError),
    });

    const cleanup = await run('cleanup');
    expect(cleanup).toBeInstanceOf(VfsCommitAppliedError);
    expect(cleanup).toMatchObject({
      applied: { ownerEpoch: 'owner-a', treeRevision: 7 },
      cause: expect.any(Error),
    });
  });
});
