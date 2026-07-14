import { describe, expect, it, vi } from 'vitest';
import {
  decodeOwnerVfsError,
  handleOwnerVfsCommitRequest,
  handleOwnerVfsDurabilityRequest,
  isOwnerVfsCommitAckMessage,
  isOwnerVfsDurabilityAckMessage,
} from './owner-vfs-ipc.ts';
import {
  type HostCommitAck,
  type OwnerVfsDurabilityReceipt,
  VfsVersionConflictError,
} from './owner-vfs-protocol.ts';

const encoder = new TextEncoder();

describe('owner VFS IPC', () => {
  it('publishes the applied revision before ACKing the host commit', () => {
    const events: string[] = [];
    const ack: HostCommitAck = {
      operationId: 'save-1',
      ownerEpoch: 'owner-a',
      treeRevision: 7,
      versions: [{ path: '/src/main.ts', version: 'v7' }],
    };
    const sent: unknown[] = [];

    handleOwnerVfsCommitRequest({
      message: {
        type: 'rifty:owner-vfs-commit',
        request: {
          kind: 'write',
          operationId: 'save-1',
          path: '/src/main.ts',
          data: encoder.encode('page'),
          expectedVersion: 'v6',
        },
      },
      apply: (request) => {
        events.push(`apply:${request.operationId}`);
        return ack;
      },
      publishSnapshot: () => events.push('publish'),
      send: (message) => {
        events.push('ack');
        sent.push(message);
      },
    });

    expect(events).toEqual(['apply:save-1', 'publish', 'ack']);
    expect(sent).toEqual([
      { type: 'rifty:owner-vfs-commit-ack', operationId: 'save-1', ok: true, ack },
    ]);
    expect(isOwnerVfsCommitAckMessage(sent[0])).toBe(true);
  });

  it('round-trips an exact large-file version conflict as its domain class', () => {
    const remote = new Uint8Array(192 * 1024 + 3);
    remote.fill(0xa5);
    const sent: unknown[] = [];

    handleOwnerVfsCommitRequest({
      message: {
        type: 'rifty:owner-vfs-commit',
        request: {
          kind: 'write',
          operationId: 'stale-save',
          path: '/large.bin',
          data: new Uint8Array(remote.byteLength),
          expectedVersion: 'old',
        },
      },
      apply: () => {
        throw new VfsVersionConflictError({
          path: '/large.bin',
          expectedVersion: 'old',
          actualVersion: 'guest',
          actualEntry: {
            path: '/large.bin',
            kind: 'file',
            size: remote.byteLength,
            content: remote,
            version: 'guest',
          },
          ownerEpoch: 'owner-a',
          treeRevision: 8,
        });
      },
      publishSnapshot: vi.fn(),
      send: (message) => sent.push(message),
    });

    expect(isOwnerVfsCommitAckMessage(sent[0])).toBe(true);
    const message = sent[0];
    if (!isOwnerVfsCommitAckMessage(message) || message.ok) throw new Error('expected nack');
    const restored = decodeOwnerVfsError(message.error);
    expect(restored).toBeInstanceOf(VfsVersionConflictError);
    expect(restored).toMatchObject({
      path: '/large.bin',
      expectedVersion: 'old',
      actualVersion: 'guest',
      ownerEpoch: 'owner-a',
      treeRevision: 8,
    });
    expect((restored as VfsVersionConflictError).actualBytes).toEqual(remote);
    expect((restored as VfsVersionConflictError).actualBytes).not.toBe(remote);
  });

  it('crosses a clean bounded persistence barrier and reports the configured tier', async () => {
    const sent: unknown[] = [];
    await handleOwnerVfsDurabilityRequest({
      message: {
        type: 'rifty:owner-vfs-durability',
        barrierId: 'barrier-1',
        ownerEpoch: 'owner-a',
        treeRevision: 11,
      },
      current: () => ({ ownerEpoch: 'owner-a', treeRevision: 12 }),
      durability: 'durable',
      flush: () => Promise.resolve(undefined),
      send: (message) => sent.push(message),
    });

    const expected: OwnerVfsDurabilityReceipt = {
      ownerEpoch: 'owner-a',
      treeRevision: 12,
      durability: 'durable',
    };
    expect(sent).toEqual([
      {
        type: 'rifty:owner-vfs-durability-ack',
        barrierId: 'barrier-1',
        ok: true,
        receipt: expected,
      },
    ]);
    expect(isOwnerVfsDurabilityAckMessage(sent[0])).toBe(true);
  });

  it('rejects epoch/revision drift and an unhealed persist ledger without a durable ACK', async () => {
    const sent: unknown[] = [];
    const base = {
      current: () => ({ ownerEpoch: 'owner-a', treeRevision: 4 }),
      durability: 'durable' as const,
      send: (message: unknown) => sent.push(message),
    };

    await handleOwnerVfsDurabilityRequest({
      ...base,
      message: {
        type: 'rifty:owner-vfs-durability',
        barrierId: 'wrong-owner',
        ownerEpoch: 'owner-b',
        treeRevision: 4,
      },
      flush: vi.fn(),
    });
    await handleOwnerVfsDurabilityRequest({
      ...base,
      message: {
        type: 'rifty:owner-vfs-durability',
        barrierId: 'future-revision',
        ownerEpoch: 'owner-a',
        treeRevision: 5,
      },
      flush: vi.fn(),
    });
    await handleOwnerVfsDurabilityRequest({
      ...base,
      message: {
        type: 'rifty:owner-vfs-durability',
        barrierId: 'dirty-ledger',
        ownerEpoch: 'owner-a',
        treeRevision: 4,
      },
      flush: async () => ({
        failures: [{ path: '/src/main.ts', op: 'write', message: 'watchdog timeout' }],
        total: 1,
        anyFailure: () => true,
      }),
    });

    expect(sent).toHaveLength(3);
    for (const candidate of sent) {
      expect(isOwnerVfsDurabilityAckMessage(candidate)).toBe(true);
      if (!isOwnerVfsDurabilityAckMessage(candidate)) throw new Error('malformed ack');
      expect(candidate.ok).toBe(false);
    }
    expect(sent).not.toContainEqual(expect.objectContaining({ ok: true }));
  });
});
