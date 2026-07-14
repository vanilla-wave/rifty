import { describe, expect, it, vi } from 'vitest';
import {
  decodeOwnerVfsError,
  encodeOwnerVfsError,
  handleOwnerVfsCommitReceipt,
  handleOwnerVfsCommitRequest,
  handleOwnerVfsDurabilityRequest,
  isOwnerVfsCommitAckMessage,
  isOwnerVfsCommitIpcMessage,
  isOwnerVfsCommitReceivedMessage,
  isOwnerVfsCommitReleasedMessage,
  isOwnerVfsDurabilityAckMessage,
  isOwnerVfsDurabilityIpcMessage,
} from './owner-vfs-ipc.ts';
import {
  type HostCommitAck,
  OperationIdReuseError,
  type OwnerVfsDurabilityReceipt,
  VfsVersionConflictError,
} from './owner-vfs-protocol.ts';

const encoder = new TextEncoder();

describe('owner VFS IPC', () => {
  it.each([
    {
      type: 'rifty:owner-vfs-commit',
      request: {
        kind: 'write',
        operationId: '',
        path: '/value.txt',
        data: new Uint8Array([1]),
        expectedVersion: null,
      },
    },
    {
      type: 'rifty:owner-vfs-commit',
      request: {
        kind: 'write',
        operationId: 'write',
        path: 'relative.txt',
        data: new ArrayBuffer(1),
        expectedVersion: null,
      },
    },
    {
      type: 'rifty:owner-vfs-commit',
      request: {
        kind: 'remove',
        operationId: 'remove',
        path: '/value.txt',
        expectedVersion: '',
        recursive: 'yes',
      },
    },
    {
      type: 'rifty:owner-vfs-commit',
      request: {
        kind: 'rename',
        operationId: 'rename',
        sourcePath: '/source.txt',
        targetPath: '',
        expectedSourceVersion: 'source',
        expectedTargetVersion: null,
      },
    },
    {
      type: 'rifty:owner-vfs-commit',
      request: { kind: 'invented', operationId: 'unknown', path: '/value.txt' },
    },
  ])('rejects a malformed discriminated commit request %#', (message) => {
    expect(isOwnerVfsCommitIpcMessage(message)).toBe(false);
  });

  it.each([
    {
      type: 'rifty:owner-vfs-commit-ack',
      operationId: '',
      ok: true,
      ack: { operationId: '', ownerEpoch: 'owner-a', treeRevision: 1, versions: [] },
    },
    {
      type: 'rifty:owner-vfs-commit-ack',
      operationId: 'save',
      ok: true,
      ack: { operationId: 'save', ownerEpoch: '', treeRevision: 1, versions: [] },
    },
    {
      type: 'rifty:owner-vfs-commit-ack',
      operationId: 'save',
      ok: true,
      ack: {
        operationId: 'save',
        ownerEpoch: 'owner-a',
        treeRevision: 1,
        versions: [{ path: '', version: '' }],
      },
    },
    {
      type: 'rifty:owner-vfs-commit-ack',
      operationId: 'save',
      ok: false,
      error: { kind: 'error', name: '', message: 7 },
    },
    {
      type: 'rifty:owner-vfs-commit-ack',
      operationId: 'save',
      ok: false,
      error: {
        kind: 'operation-id-reuse',
        name: 'OperationIdReuseError',
        message: 'reused',
        operationId: '',
      },
    },
    {
      type: 'rifty:owner-vfs-commit-ack',
      operationId: 'save',
      ok: false,
      error: {
        kind: 'version-conflict',
        name: 'VfsVersionConflictError',
        message: 'conflict',
        path: '/value.bin',
        expectedVersion: 'old',
        actualVersion: 'new',
        actualEntry: {
          path: '/value.bin',
          kind: 'file',
          size: 2,
          content: new Uint8Array([1]),
          version: 'new',
        },
        ownerEpoch: 'owner-a',
        treeRevision: 2,
      },
    },
  ])('rejects a malformed discriminated commit terminal %#', (message) => {
    expect(isOwnerVfsCommitAckMessage(message)).toBe(false);
  });

  it('uses the same exact ACK validator for received and released frames', () => {
    const malformed = {
      operationId: 'save',
      ownerEpoch: 'owner-a',
      treeRevision: 1,
      versions: [{ path: '/value.txt', version: '' }],
    };

    expect(
      isOwnerVfsCommitReceivedMessage({
        type: 'rifty:owner-vfs-commit-received',
        ack: malformed,
      }),
    ).toBe(false);
    expect(
      isOwnerVfsCommitReleasedMessage({
        type: 'rifty:owner-vfs-commit-released',
        ack: malformed,
      }),
    ).toBe(false);
  });

  it.each([
    {
      type: 'rifty:owner-vfs-durability',
      barrierId: '',
      ownerEpoch: 'owner-a',
      treeRevision: 1,
    },
    {
      type: 'rifty:owner-vfs-durability',
      barrierId: 'barrier',
      ownerEpoch: '',
      treeRevision: 1,
    },
    {
      type: 'rifty:owner-vfs-durability',
      barrierId: 'barrier',
      ownerEpoch: 'owner-a',
      treeRevision: 1.5,
    },
  ])('rejects malformed durability request sibling %#', (message) => {
    expect(isOwnerVfsDurabilityIpcMessage(message)).toBe(false);
  });

  it.each([
    {
      type: 'rifty:owner-vfs-durability-ack',
      barrierId: 'barrier',
      ok: true,
      receipt: { ownerEpoch: '', treeRevision: 1, durability: 'durable' },
    },
    {
      type: 'rifty:owner-vfs-durability-ack',
      barrierId: 'barrier',
      ok: true,
      receipt: { ownerEpoch: 'owner-a', treeRevision: -1, durability: 'invented' },
    },
    {
      type: 'rifty:owner-vfs-durability-ack',
      barrierId: 'barrier',
      ok: false,
      error: { kind: 'error', name: '', message: 'broken' },
    },
  ])('rejects malformed durability terminal sibling %#', (message) => {
    expect(isOwnerVfsDurabilityAckMessage(message)).toBe(false);
  });

  it('round-trips exact operation-id reuse evidence through the shared error validator', () => {
    const encoded = encodeOwnerVfsError(new OperationIdReuseError('reused-operation'));
    const terminal = {
      type: 'rifty:owner-vfs-commit-ack' as const,
      operationId: 'reused-operation',
      ok: false as const,
      error: encoded,
    };

    expect(isOwnerVfsCommitAckMessage(terminal)).toBe(true);
    expect(decodeOwnerVfsError(encoded)).toBeInstanceOf(OperationIdReuseError);
  });

  it.each([
    ['sync', (ack: HostCommitAck) => ack],
    ['async', (ack: HostCommitAck) => Promise.resolve(ack)],
  ])(
    'NACKs an already-applied %s commit exactly when snapshot publication throws',
    async (_kind, apply) => {
      const ack: HostCommitAck = {
        operationId: 'publish-failure',
        ownerEpoch: 'owner-a',
        treeRevision: 7,
        versions: [{ path: '/src/main.ts', version: 'v7' }],
      };
      const failure = new Error('snapshot publication failed');
      const sent: unknown[] = [];

      handleOwnerVfsCommitRequest({
        message: {
          type: 'rifty:owner-vfs-commit',
          request: {
            kind: 'write',
            operationId: ack.operationId,
            path: '/src/main.ts',
            data: encoder.encode('applied'),
            expectedVersion: 'v6',
          },
        },
        apply: () => apply(ack),
        publishSnapshot: () => {
          throw failure;
        },
        send: (message) => sent.push(message),
      });
      await Promise.resolve();
      await Promise.resolve();

      expect(sent).toEqual([
        {
          type: 'rifty:owner-vfs-commit-ack',
          operationId: ack.operationId,
          ok: false,
          error: { kind: 'error', name: 'Error', message: failure.message },
          applied: ack,
        },
      ]);
    },
  );

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

  it('releases an exact terminal only after authority cleanup', () => {
    const events: string[] = [];
    const ack: HostCommitAck = {
      operationId: 'received-save',
      ownerEpoch: 'owner-a',
      treeRevision: 8,
      versions: [{ path: '/src/main.ts', version: 'v8' }],
    };

    handleOwnerVfsCommitReceipt({
      message: { type: 'rifty:owner-vfs-commit-received', ack },
      release: (candidate) => {
        expect(candidate).toBe(ack);
        events.push('release-record');
      },
      send: (message) => {
        expect(message).toEqual({ type: 'rifty:owner-vfs-commit-released', ack });
        events.push('release-frame');
      },
    });

    expect(events).toEqual(['release-record', 'release-frame']);
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
