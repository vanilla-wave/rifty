import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  HostCommitAck,
  HostCommitRequest,
  OwnerVfsDurabilityReceipt,
  OwnerVfsRevisionFrame,
} from './owner-vfs-protocol.ts';
import { VfsCommitAppliedError, VfsVersionConflictError } from './owner-vfs-protocol.ts';
import {
  VfsCommitCoordinatorClosedError,
  VfsCommitProtocolError,
  VfsCommitTimeoutError,
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

async function settleMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  vi.useRealTimers();
});

describe('VfsCommitCoordinator fault contract', () => {
  it('propagates exact CAS conflicts without retry or durability', async () => {
    const closed = deferred<unknown>();
    const requests: HostCommitRequest[] = [];
    let barriers = 0;
    const conflict = new VfsVersionConflictError({
      path: '/src/main.ts',
      expectedVersion: 'v1',
      actualVersion: 'v2',
      actualEntry: {
        path: '/src/main.ts',
        kind: 'file',
        size: 6,
        content: new TextEncoder().encode('remote'),
        version: 'v2',
      },
      ownerEpoch: 'owner-a',
      treeRevision: 9,
    });
    const coordinator = createVfsCommitCoordinator({
      captureOwner: () => ({
        ownerEpoch: 'owner-a',
        isAlive: () => true,
        closed: closed.promise,
        applyHostCommit(request) {
          requests.push(request);
          return Promise.reject(conflict);
        },
        durabilityBarrier() {
          barriers += 1;
          return Promise.reject(new Error('must not flush'));
        },
      }),
      subscribeSnapshots: () => () => {},
      timeoutMs: 100,
    });

    await expect(
      coordinator.commit({
        kind: 'write',
        path: '/src/main.ts',
        data: new Uint8Array([1]),
        expectedVersion: 'v1',
      }),
    ).rejects.toBe(conflict);
    expect(requests).toHaveLength(1);
    expect(barriers).toBe(0);
  });

  it('rejects apply and durability failures once; late snapshots are ignored', async () => {
    const closed = deferred<unknown>();
    let listener = (_frame: OwnerVfsRevisionFrame): void => {};
    let applyCalls = 0;
    let barrierCalls = 0;
    const coordinator = createVfsCommitCoordinator({
      captureOwner: () => ({
        ownerEpoch: 'owner-a',
        isAlive: () => true,
        closed: closed.promise,
        applyHostCommit() {
          applyCalls += 1;
          return Promise.resolve({
            operationId: 'wrong-operation',
            ownerEpoch: 'owner-a',
            treeRevision: 1,
            versions: [],
          });
        },
        durabilityBarrier() {
          barrierCalls += 1;
          return Promise.reject(new Error('persist denied'));
        },
      }),
      subscribeSnapshots(next) {
        listener = next;
        return () => {};
      },
      timeoutMs: 100,
    });

    const malformed = coordinator.commit({ kind: 'mkdir', path: '/a', expectedVersion: null });
    await expect(malformed).rejects.toBeInstanceOf(VfsCommitProtocolError);
    listener({ ownerEpoch: 'owner-a', treeRevision: 100 });
    await settleMicrotasks();
    expect(applyCalls).toBe(1);
    expect(barrierCalls).toBe(0);

    let request!: HostCommitRequest;
    const durabilityCoordinator = createVfsCommitCoordinator({
      captureOwner: () => ({
        ownerEpoch: 'owner-a',
        isAlive: () => true,
        closed: closed.promise,
        applyHostCommit(next) {
          request = next;
          return Promise.resolve({
            operationId: next.operationId,
            ownerEpoch: 'owner-a',
            treeRevision: 2,
            versions: [],
          });
        },
        durabilityBarrier() {
          barrierCalls += 1;
          return Promise.reject(new Error('persist denied'));
        },
      }),
      subscribeSnapshots(next) {
        queueMicrotask(() => next({ ownerEpoch: 'owner-a', treeRevision: 2 }));
        return () => {};
      },
      timeoutMs: 100,
    });
    const durability = durabilityCoordinator.commit({
      kind: 'mkdir',
      path: '/b',
      expectedVersion: null,
    });
    const durabilityFailure = await durability.catch((error: unknown) => error);
    expect(durabilityFailure).toBeInstanceOf(VfsCommitAppliedError);
    expect(durabilityFailure).toMatchObject({
      cause: expect.objectContaining({ message: 'persist denied' }),
      applied: { ownerEpoch: 'owner-a', treeRevision: 2 },
    });
    expect(request.operationId).toMatch(/^host-vfs:/);
    expect(barrierCalls).toBe(1);
  });

  it('rejects pending work on owner death and does not wait for timeout', async () => {
    const closed = deferred<unknown>();
    const apply = deferred<HostCommitAck>();
    const coordinator = createVfsCommitCoordinator({
      captureOwner: () => ({
        ownerEpoch: 'owner-a',
        isAlive: () => true,
        closed: closed.promise,
        applyHostCommit: () => apply.promise,
        durabilityBarrier: () => Promise.reject(new Error('must not flush')),
      }),
      subscribeSnapshots: () => () => {},
      timeoutMs: 10_000,
    });

    const pending = coordinator.commit({ kind: 'mkdir', path: '/a', expectedVersion: null });
    closed.resolve(null);
    await expect(pending).rejects.toBeInstanceOf(VfsOwnerExitedError);

    apply.resolve({
      operationId: 'late',
      ownerEpoch: 'owner-a',
      treeRevision: 1,
      versions: [],
    });
  });

  it('keeps an admitted apply pending beyond the observation timeout, then settles exactly', async () => {
    vi.useFakeTimers();
    const closed = deferred<unknown>();
    const apply = deferred<HostCommitAck>();
    const durable = deferred<OwnerVfsDurabilityReceipt>();
    let listener = (_frame: OwnerVfsRevisionFrame): void => {};
    let request!: HostCommitRequest;
    let outcome = 'pending';
    const coordinator = createVfsCommitCoordinator({
      captureOwner: () => ({
        ownerEpoch: 'owner-a',
        isAlive: () => true,
        closed: closed.promise,
        applyHostCommit(next) {
          request = next;
          return apply.promise;
        },
        durabilityBarrier: () => durable.promise,
      }),
      subscribeSnapshots(next) {
        listener = next;
        return () => {};
      },
      timeoutMs: 25,
    });

    const pending = coordinator.commit({ kind: 'mkdir', path: '/a', expectedVersion: null });
    void pending.then(
      () => {
        outcome = 'resolved';
      },
      () => {
        outcome = 'rejected';
      },
    );

    await vi.advanceTimersByTimeAsync(250);
    expect(outcome).toBe('pending');

    apply.resolve({
      operationId: request.operationId,
      ownerEpoch: 'owner-a',
      treeRevision: 4,
      versions: [{ path: '/a', version: 'v4' }],
    });
    await settleMicrotasks();
    listener({ ownerEpoch: 'owner-a', treeRevision: 4 });
    durable.resolve({ ownerEpoch: 'owner-a', treeRevision: 4, durability: 'durable' });

    await expect(pending).resolves.toMatchObject({
      operationId: request.operationId,
      treeRevision: 4,
      durability: 'durable',
    });
  });

  it('times out post-ACK reflection and ignores every late message', async () => {
    vi.useFakeTimers();
    const closed = deferred<unknown>();
    let listener = (_frame: OwnerVfsRevisionFrame): void => {};
    let request!: HostCommitRequest;
    let barriers = 0;
    const coordinator = createVfsCommitCoordinator({
      captureOwner: () => ({
        ownerEpoch: 'owner-a',
        isAlive: () => true,
        closed: closed.promise,
        applyHostCommit(next) {
          request = next;
          return Promise.resolve({
            operationId: next.operationId,
            ownerEpoch: 'owner-a',
            treeRevision: 4,
            versions: [],
          });
        },
        async durabilityBarrier(): Promise<OwnerVfsDurabilityReceipt> {
          barriers += 1;
          return { ownerEpoch: 'owner-a', treeRevision: 4, durability: 'durable' };
        },
      }),
      subscribeSnapshots(next) {
        listener = next;
        return () => {};
      },
      timeoutMs: 25,
    });

    const pending = coordinator.commit({ kind: 'mkdir', path: '/a', expectedVersion: null });
    await settleMicrotasks();
    const timedOut = expect(pending).rejects.toMatchObject({
      name: VfsCommitTimeoutError.name,
      stage: 'reflection',
      ack: {
        operationId: request.operationId,
        ownerEpoch: 'owner-a',
        treeRevision: 4,
      },
      message: expect.stringContaining('applied at revision 4'),
    });
    await vi.advanceTimersByTimeAsync(25);
    await timedOut;

    listener({ ownerEpoch: 'owner-a', treeRevision: 4 });
    await settleMicrotasks();
    expect(request.operationId).toMatch(/^host-vfs:/);
    expect(barriers).toBe(0);
  });

  it('close rejects future commits but an admitted apply settles from its owner outcome', async () => {
    const closed = deferred<unknown>();
    const apply = deferred<HostCommitAck>();
    const durable = deferred<OwnerVfsDurabilityReceipt>();
    let request!: HostCommitRequest;
    let listener = (_frame: OwnerVfsRevisionFrame): void => {};
    const coordinator = createVfsCommitCoordinator({
      captureOwner: () => ({
        ownerEpoch: 'owner-a',
        isAlive: () => true,
        closed: closed.promise,
        applyHostCommit(next) {
          request = next;
          return apply.promise;
        },
        durabilityBarrier: () => durable.promise,
      }),
      subscribeSnapshots(next) {
        listener = next;
        return () => {};
      },
      timeoutMs: 100,
    });

    const pending = coordinator.commit({ kind: 'mkdir', path: '/a', expectedVersion: null });
    coordinator.close();
    await expect(
      coordinator.commit({ kind: 'mkdir', path: '/b', expectedVersion: null }),
    ).rejects.toBeInstanceOf(VfsCommitCoordinatorClosedError);

    apply.resolve({
      operationId: request.operationId,
      ownerEpoch: 'owner-a',
      treeRevision: 3,
      versions: [{ path: '/a', version: 'v3' }],
    });
    await settleMicrotasks();
    listener({ ownerEpoch: 'owner-a', treeRevision: 3 });
    durable.resolve({ ownerEpoch: 'owner-a', treeRevision: 3, durability: 'durable' });
    await expect(pending).resolves.toMatchObject({ treeRevision: 3, durability: 'durable' });
  });

  it.each(['captureOwner', 'isAlive', 'subscribeSnapshots'] as const)(
    'settles a close re-entered from %s without sending or leaking a subscription',
    async (closeAt) => {
      const ownerClosed = deferred<unknown>();
      const closeError = new Error(`closed from ${closeAt}`);
      let aliveChecks = 0;
      let subscriptions = 0;
      let unsubscriptions = 0;
      let applyCalls = 0;
      const owner = {
        ownerEpoch: 'owner-a',
        isAlive() {
          aliveChecks += 1;
          if (closeAt === 'isAlive') coordinator.close(closeError);
          return true;
        },
        closed: ownerClosed.promise,
        applyHostCommit(): Promise<HostCommitAck> {
          applyCalls += 1;
          return Promise.reject(new Error('must not apply'));
        },
        durabilityBarrier(): Promise<OwnerVfsDurabilityReceipt> {
          return Promise.reject(new Error('must not flush'));
        },
      };
      const coordinator = createVfsCommitCoordinator({
        captureOwner() {
          if (closeAt === 'captureOwner') coordinator.close(closeError);
          return owner;
        },
        subscribeSnapshots() {
          subscriptions += 1;
          if (closeAt === 'subscribeSnapshots') coordinator.close(closeError);
          return () => {
            unsubscriptions += 1;
          };
        },
        timeoutMs: 100,
      });

      const pending = coordinator.commit({ kind: 'mkdir', path: '/a', expectedVersion: null });

      await expect(pending).rejects.toBe(closeError);
      expect(applyCalls).toBe(0);
      expect(aliveChecks).toBe(closeAt === 'captureOwner' ? 0 : 1);
      expect(subscriptions).toBe(closeAt === 'subscribeSnapshots' ? 1 : 0);
      expect(unsubscriptions).toBe(closeAt === 'subscribeSnapshots' ? 1 : 0);
    },
  );

  it('rejects a durability receipt from another epoch or below the reflected revision', async () => {
    const closed = deferred<unknown>();
    let receipt: OwnerVfsDurabilityReceipt = {
      ownerEpoch: 'owner-b',
      treeRevision: 8,
      durability: 'durable',
    };
    const coordinator = createVfsCommitCoordinator({
      captureOwner: () => ({
        ownerEpoch: 'owner-a',
        isAlive: () => true,
        closed: closed.promise,
        applyHostCommit(next) {
          return Promise.resolve({
            operationId: next.operationId,
            ownerEpoch: 'owner-a',
            treeRevision: 8,
            versions: [],
          });
        },
        durabilityBarrier: () => Promise.resolve(receipt),
      }),
      subscribeSnapshots(next) {
        queueMicrotask(() => next({ ownerEpoch: 'owner-a', treeRevision: 8 }));
        return () => {};
      },
      timeoutMs: 100,
    });

    const wrongOwner = await coordinator
      .commit({ kind: 'mkdir', path: '/a', expectedVersion: null })
      .catch((error: unknown) => error);
    expect(wrongOwner).toBeInstanceOf(VfsCommitAppliedError);
    expect(wrongOwner).toMatchObject({
      applied: { ownerEpoch: 'owner-a', treeRevision: 8 },
      cause: expect.any(VfsCommitProtocolError),
    });

    receipt = { ownerEpoch: 'owner-a', treeRevision: 7, durability: 'durable' };
    const staleReceipt = await coordinator
      .commit({ kind: 'mkdir', path: '/b', expectedVersion: null })
      .catch((error: unknown) => error);
    expect(staleReceipt).toBeInstanceOf(VfsCommitAppliedError);
    expect(staleReceipt).toMatchObject({
      applied: { ownerEpoch: 'owner-a', treeRevision: 8 },
      cause: expect.any(VfsCommitProtocolError),
    });
  });
});
