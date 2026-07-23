import { describe, expect, it, vi } from 'vitest';
import * as ownerVfsIpc from './owner-vfs-ipc.ts';
import {
  type OwnerVfsAppliedCommitTerminal,
  type OwnerVfsCommitAckMessage,
  decodeOwnerVfsError,
  encodeOwnerVfsError,
  handleOwnerVfsCommitReceipt,
  handleOwnerVfsCommitRequest,
  handleOwnerVfsDurabilityRequest,
  isOwnerVfsCommitAckMessage,
  isOwnerVfsCommitCleanedMessage,
  isOwnerVfsCommitCleanupMessage,
  isOwnerVfsCommitIpcMessage,
  isOwnerVfsCommitReceivedMessage,
  isOwnerVfsCommitReleasedMessage,
  isOwnerVfsDurabilityAckMessage,
  isOwnerVfsDurabilityIpcMessage,
  validateOwnerVfsCommitTerminalForRequest,
} from './owner-vfs-ipc.ts';
import {
  type HostCommitAck,
  type HostCommitRequest,
  OperationIdReuseError,
  type OwnerVfsDurabilityReceipt,
  VfsPersistenceFailureError,
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

  it('uses the same full-terminal validator for every cleanup handshake frame', () => {
    const malformed = {
      operationId: 'save',
      ownerEpoch: 'owner-a',
      treeRevision: 1,
      versions: [{ path: '/value.txt', version: '' }],
    };

    const malformedTerminal = {
      type: 'rifty:owner-vfs-commit-ack',
      operationId: malformed.operationId,
      ok: true,
      ack: malformed,
    };
    expect(
      isOwnerVfsCommitReceivedMessage({
        type: 'rifty:owner-vfs-commit-received',
        terminal: malformedTerminal,
      }),
    ).toBe(false);
    expect(
      isOwnerVfsCommitReleasedMessage({
        type: 'rifty:owner-vfs-commit-released',
        terminal: malformedTerminal,
      }),
    ).toBe(false);
    expect(
      isOwnerVfsCommitCleanupMessage({
        type: 'rifty:owner-vfs-commit-cleanup',
        terminal: malformedTerminal,
      }),
    ).toBe(false);
    expect(
      isOwnerVfsCommitCleanedMessage({
        type: 'rifty:owner-vfs-commit-cleaned',
        terminal: malformedTerminal,
      }),
    ).toBe(false);

    const nack = {
      type: 'rifty:owner-vfs-commit-ack' as const,
      operationId: 'non-applied',
      ok: false as const,
      error: { kind: 'error' as const, name: 'Error', message: 'not applied' },
    };
    expect(
      [
        isOwnerVfsCommitReceivedMessage({
          type: 'rifty:owner-vfs-commit-received',
          terminal: nack,
        }),
        isOwnerVfsCommitReleasedMessage({
          type: 'rifty:owner-vfs-commit-released',
          terminal: nack,
        }),
        isOwnerVfsCommitCleanupMessage({
          type: 'rifty:owner-vfs-commit-cleanup',
          terminal: nack,
        }),
        isOwnerVfsCommitCleanedMessage({
          type: 'rifty:owner-vfs-commit-cleaned',
          terminal: nack,
        }),
      ].every(Boolean),
    ).toBe(true);
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
    {
      type: 'rifty:owner-vfs-durability-ack',
      barrierId: 'barrier',
      ok: false,
      error: { kind: 'persistence-failure', name: 'Error', message: 'spoofed outcome' },
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

  it('round-trips only the typed persistence outcome as trusted flush evidence', () => {
    const trusted = encodeOwnerVfsError(new VfsPersistenceFailureError('owner flush failed'));
    const spoofed = new Error('transport failed');
    spoofed.name = 'PersistFailureError';
    const untrusted = encodeOwnerVfsError(spoofed);

    expect(trusted).toEqual({
      kind: 'persistence-failure',
      name: 'PersistFailureError',
      message: 'owner flush failed',
    });
    expect(decodeOwnerVfsError(trusted)).toBeInstanceOf(VfsPersistenceFailureError);
    expect(untrusted).toEqual({
      kind: 'error',
      name: 'PersistFailureError',
      message: 'transport failed',
    });
    expect(decodeOwnerVfsError(untrusted)).not.toBeInstanceOf(VfsPersistenceFailureError);
  });

  it('correlates every NACK identity field to the exact request', () => {
    const cases: readonly {
      readonly request: HostCommitRequest;
      readonly path: string;
      readonly exactExpectedVersion: string | null;
      readonly divergentExpectedVersion: string | null;
      readonly actualVersion: string | null;
    }[] = [
      {
        request: {
          kind: 'write',
          operationId: 'write-conflict',
          path: '/workspace/write.txt',
          data: new Uint8Array([1]),
          expectedVersion: 'write-opened',
        },
        path: '/workspace/write.txt',
        exactExpectedVersion: 'write-opened',
        divergentExpectedVersion: 'write-other',
        actualVersion: null,
      },
      {
        request: {
          kind: 'mkdir',
          operationId: 'mkdir-conflict',
          path: '/workspace/new-dir',
          expectedVersion: null,
        },
        path: '/workspace/new-dir',
        exactExpectedVersion: null,
        divergentExpectedVersion: 'mkdir-other',
        actualVersion: 'mkdir-actual',
      },
      {
        request: {
          kind: 'remove',
          operationId: 'remove-conflict',
          path: '/workspace/remove.txt',
          expectedVersion: 'remove-opened',
        },
        path: '/workspace/remove.txt',
        exactExpectedVersion: 'remove-opened',
        divergentExpectedVersion: 'remove-other',
        actualVersion: null,
      },
      {
        request: {
          kind: 'rename',
          operationId: 'rename-source-conflict',
          sourcePath: '/workspace/source.txt',
          targetPath: '/workspace/target.txt',
          expectedSourceVersion: 'source-opened',
          expectedTargetVersion: null,
        },
        path: '/workspace/source.txt',
        exactExpectedVersion: 'source-opened',
        divergentExpectedVersion: 'source-other',
        actualVersion: null,
      },
      {
        request: {
          kind: 'rename',
          operationId: 'rename-target-conflict',
          sourcePath: '/workspace/source.txt',
          targetPath: '/workspace/target.txt',
          expectedSourceVersion: 'source-opened',
          expectedTargetVersion: null,
        },
        path: '/workspace/target.txt',
        exactExpectedVersion: null,
        divergentExpectedVersion: 'target-other',
        actualVersion: 'target-actual',
      },
    ];

    for (const testCase of cases) {
      const terminal = {
        type: 'rifty:owner-vfs-commit-ack',
        operationId: testCase.request.operationId,
        ok: false,
        error: {
          kind: 'version-conflict',
          name: 'VfsVersionConflictError',
          message: 'divergent request evidence',
          path: testCase.path,
          expectedVersion: testCase.divergentExpectedVersion,
          actualVersion: testCase.actualVersion,
          actualEntry:
            testCase.actualVersion === null
              ? null
              : {
                  path: testCase.path,
                  kind: 'dir',
                  size: 0,
                  version: testCase.actualVersion,
                },
          ownerEpoch: 'owner-a',
          treeRevision: 2,
        },
      } satisfies OwnerVfsCommitAckMessage;

      expect(
        validateOwnerVfsCommitTerminalForRequest(terminal, testCase.request, 'owner-a'),
      ).toMatchObject({ name: 'VfsCommitProtocolError' });
      const exactTerminal = {
        ...terminal,
        error: { ...terminal.error, expectedVersion: testCase.exactExpectedVersion },
      } satisfies OwnerVfsCommitAckMessage;
      expect(
        validateOwnerVfsCommitTerminalForRequest(exactTerminal, testCase.request, 'owner-a'),
      ).toBeNull();
      if (testCase.request.operationId === 'write-conflict') {
        const divergentSiblings: readonly OwnerVfsCommitAckMessage[] = [
          { ...exactTerminal, operationId: 'wrong-outer-operation' },
          {
            ...exactTerminal,
            error: { ...exactTerminal.error, ownerEpoch: 'owner-b' },
          },
          {
            ...exactTerminal,
            error: { ...exactTerminal.error, path: '/workspace/other.txt' },
          },
        ];
        for (const sibling of divergentSiblings) {
          expect(
            validateOwnerVfsCommitTerminalForRequest(sibling, testCase.request, 'owner-a'),
          ).toMatchObject({ name: 'VfsCommitProtocolError' });
        }
      }
    }

    const request: HostCommitRequest = {
      kind: 'mkdir',
      operationId: 'reuse-outer',
      path: '/workspace/reused',
      expectedVersion: null,
    };
    const terminal = {
      type: 'rifty:owner-vfs-commit-ack',
      operationId: request.operationId,
      ok: false,
      error: {
        kind: 'operation-id-reuse',
        name: 'OperationIdReuseError',
        message: 'divergent request evidence',
        operationId: 'reuse-inner',
      },
    } satisfies OwnerVfsCommitAckMessage;
    expect(validateOwnerVfsCommitTerminalForRequest(terminal, request, 'owner-a')).toMatchObject({
      name: 'VfsCommitProtocolError',
    });
    expect(
      validateOwnerVfsCommitTerminalForRequest(
        { ...terminal, error: { ...terminal.error, operationId: request.operationId } },
        request,
        'owner-a',
      ),
    ).toBeNull();
  });

  it('correlates same-path rename conflicts in authority assertion order', () => {
    const request: HostCommitRequest = {
      kind: 'rename',
      operationId: 'same-path-rename',
      sourcePath: '/workspace/same.txt',
      targetPath: '/workspace/same.txt',
      expectedSourceVersion: 'source-opened',
      expectedTargetVersion: null,
    };
    const terminal = (
      expectedVersion: string | null,
      actualVersion: string | null,
    ): OwnerVfsCommitAckMessage => ({
      type: 'rifty:owner-vfs-commit-ack',
      operationId: request.operationId,
      ok: false,
      error: {
        kind: 'version-conflict',
        name: 'VfsVersionConflictError',
        message: 'same-path conflict',
        path: request.sourcePath,
        expectedVersion,
        actualVersion,
        actualEntry:
          actualVersion === null
            ? null
            : {
                path: request.sourcePath,
                kind: 'dir',
                size: 0,
                version: actualVersion,
              },
        ownerEpoch: 'owner-a',
        treeRevision: 2,
      },
    });

    expect(
      validateOwnerVfsCommitTerminalForRequest(
        terminal(request.expectedSourceVersion, null),
        request,
        'owner-a',
      ),
    ).toBeNull();
    expect(
      validateOwnerVfsCommitTerminalForRequest(
        terminal(request.expectedTargetVersion, request.expectedSourceVersion),
        request,
        'owner-a',
      ),
    ).toBeNull();
    expect(
      validateOwnerVfsCommitTerminalForRequest(
        terminal(request.expectedTargetVersion, null),
        request,
        'owner-a',
      ),
    ).toMatchObject({ name: 'VfsCommitProtocolError' });
    expect(
      validateOwnerVfsCommitTerminalForRequest(
        terminal(request.expectedSourceVersion, request.expectedSourceVersion),
        request,
        'owner-a',
      ),
    ).toMatchObject({ name: 'VfsCommitProtocolError' });
  });

  it('forwards the operation authority retained applied NACK', async () => {
    const ack: HostCommitAck = {
      operationId: 'publish-failure',
      ownerEpoch: 'owner-a',
      treeRevision: 7,
      versions: [{ path: '/src/main.ts', version: 'v7' }],
    };
    const failure = new Error('snapshot publication failed');
    const sent: unknown[] = [];
    const terminal: OwnerVfsCommitAckMessage = {
      type: 'rifty:owner-vfs-commit-ack',
      operationId: ack.operationId,
      ok: false,
      error: encodeOwnerVfsError(failure),
      applied: ack,
    };

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
      admit: () => Promise.resolve(terminal),
      send: (message) => sent.push(message),
    });
    await Promise.resolve();

    expect(sent).toEqual([terminal]);
  });

  it('forwards the exact terminal resolved by the operation authority', async () => {
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
      admit: (request) => {
        events.push(`admit:${request.operationId}`);
        return Promise.resolve({
          type: 'rifty:owner-vfs-commit-ack',
          operationId: request.operationId,
          ok: true,
          ack,
        });
      },
      send: (message) => {
        events.push('ack');
        sent.push(message);
      },
    });
    await Promise.resolve();

    expect(events).toEqual(['admit:save-1', 'ack']);
    expect(sent).toEqual([
      { type: 'rifty:owner-vfs-commit-ack', operationId: 'save-1', ok: true, ack },
    ]);
    expect(isOwnerVfsCommitAckMessage(sent[0])).toBe(true);
  });

  it('moves retained certification from an applied NACK to an honest publication retry', () => {
    const ack: HostCommitAck = {
      operationId: 'publication-retry',
      ownerEpoch: 'owner-a',
      treeRevision: 7,
      versions: [{ path: '/src/main.ts', version: 'v7' }],
    };
    const appliedTerminal: OwnerVfsAppliedCommitTerminal = {
      type: 'rifty:owner-vfs-commit-ack',
      operationId: ack.operationId,
      ok: false,
      error: encodeOwnerVfsError(new Error('snapshot publication failed')),
      applied: ack,
    };
    const success: OwnerVfsAppliedCommitTerminal = {
      type: 'rifty:owner-vfs-commit-ack',
      operationId: ack.operationId,
      ok: true,
      ack,
    };
    const retained: OwnerVfsAppliedCommitTerminal = success;

    const recovered: unknown[] = [];
    handleOwnerVfsCommitReceipt({
      message: { type: 'rifty:owner-vfs-commit-received', terminal: appliedTerminal },
      retained: () => retained,
      send: (message) => recovered.push(message),
      reportError: vi.fn(),
    });
    expect(recovered).toEqual([success]);

    recovered.length = 0;
    handleOwnerVfsCommitReceipt({
      message: { type: 'rifty:owner-vfs-commit-received', terminal: success },
      retained: () => retained,
      send: (message) => recovered.push(message),
    });
    expect(recovered).toEqual([{ type: 'rifty:owner-vfs-commit-released', terminal: success }]);
  });

  it('certifies an exact retained terminal without cleaning authority state', () => {
    const events: string[] = [];
    const ack: HostCommitAck = {
      operationId: 'received-save',
      ownerEpoch: 'owner-a',
      treeRevision: 8,
      versions: [{ path: '/src/main.ts', version: 'v8' }],
    };
    const terminal = {
      type: 'rifty:owner-vfs-commit-ack' as const,
      operationId: ack.operationId,
      ok: true as const,
      ack,
    };

    handleOwnerVfsCommitReceipt({
      message: { type: 'rifty:owner-vfs-commit-received', terminal },
      retained: (operationId) => {
        expect(operationId).toBe(ack.operationId);
        events.push('read-record');
        return terminal;
      },
      send: (message) => {
        expect(message).toEqual({ type: 'rifty:owner-vfs-commit-released', terminal });
        events.push('release-frame');
      },
    });

    expect(events).toEqual(['read-record', 'release-frame']);
  });

  it('keeps the owner alive and replays the retained terminal for a divergent receipt', () => {
    const exact: HostCommitAck = {
      operationId: 'received-save',
      ownerEpoch: 'owner-a',
      treeRevision: 8,
      versions: [{ path: '/src/main.ts', version: 'v8' }],
    };
    const divergent = { ...exact, treeRevision: 7 };
    const exactTerminal = {
      type: 'rifty:owner-vfs-commit-ack' as const,
      operationId: exact.operationId,
      ok: true as const,
      ack: exact,
    };
    const divergentTerminal = { ...exactTerminal, ack: divergent };
    const send = vi.fn();
    const reportError = vi.fn();

    expect(() =>
      handleOwnerVfsCommitReceipt({
        message: { type: 'rifty:owner-vfs-commit-received', terminal: divergentTerminal },
        retained: (operationId) => (operationId === exact.operationId ? exactTerminal : null),
        send,
        reportError,
      }),
    ).not.toThrow();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(exactTerminal);
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'VfsCommitProtocolError' }),
    );
  });

  it.each(['applied NACK vs success', 'success vs applied NACK'] as const)(
    'certifies the retained full terminal for same-ACK semantic divergence: %s',
    (testCase) => {
      const ack: HostCommitAck = {
        operationId: `semantic-${testCase}`,
        ownerEpoch: 'owner-a',
        treeRevision: 8,
        versions: [{ path: '/src/main.ts', version: 'v8' }],
      };
      const success = {
        type: 'rifty:owner-vfs-commit-ack' as const,
        operationId: ack.operationId,
        ok: true as const,
        ack,
      };
      const appliedNack = {
        type: 'rifty:owner-vfs-commit-ack' as const,
        operationId: ack.operationId,
        ok: false as const,
        error: { kind: 'error' as const, name: 'Error', message: 'publication failed' },
        applied: ack,
      };
      const retained = testCase.startsWith('applied') ? appliedNack : success;
      const divergent = testCase.startsWith('applied') ? success : appliedNack;
      const sent: unknown[] = [];
      const reportError = vi.fn();
      const options = {
        message: {
          type: 'rifty:owner-vfs-commit-received',
          terminal: divergent,
        },
        retained: () => retained,
        send: (message: unknown) => sent.push(message),
        reportError,
      } as unknown as Parameters<typeof handleOwnerVfsCommitReceipt>[0];

      handleOwnerVfsCommitReceipt(options);

      expect(sent).toEqual([retained]);
      expect(reportError).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'VfsCommitProtocolError' }),
      );
    },
  );

  it('retains the exact terminal across a dropped release and divergent receipt retry', () => {
    const exactAck: HostCommitAck = {
      operationId: 'dropped-release',
      ownerEpoch: 'owner-a',
      treeRevision: 8,
      versions: [{ path: '/src/main.ts', version: 'v8' }],
    };
    const divergentAck = { ...exactAck, treeRevision: 7 };
    const exactTerminal = {
      type: 'rifty:owner-vfs-commit-ack' as const,
      operationId: exactAck.operationId,
      ok: true as const,
      ack: exactAck,
    };
    const divergentTerminal = { ...exactTerminal, ack: divergentAck };
    const sent: unknown[] = [];
    const reportError = vi.fn();
    const deliver = (terminal: typeof exactTerminal): void => {
      const options = {
        message: { type: 'rifty:owner-vfs-commit-received', terminal },
        retained: () => exactTerminal,
        send: (message: unknown) => sent.push(message),
        reportError,
      } as unknown as Parameters<typeof handleOwnerVfsCommitReceipt>[0];
      handleOwnerVfsCommitReceipt(options);
    };

    deliver(exactTerminal);
    sent.length = 0; // drop the first release frame
    deliver(divergentTerminal);

    expect(sent).toEqual([exactTerminal]);
    sent.length = 0;
    deliver(exactTerminal);

    expect(sent).toEqual([{ type: 'rifty:owner-vfs-commit-released', terminal: exactTerminal }]);
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'VfsCommitProtocolError' }),
    );
  });

  it('acknowledges a retried cleanup after the first cleaned frame was dropped', () => {
    const ack: HostCommitAck = {
      operationId: 'cleanup-ack-dropped',
      ownerEpoch: 'owner-a',
      treeRevision: 8,
      versions: [{ path: '/src/main.ts', version: 'v8' }],
    };
    const terminal = {
      type: 'rifty:owner-vfs-commit-ack' as const,
      operationId: ack.operationId,
      ok: true as const,
      ack,
    };
    let retained: typeof terminal | null = terminal;
    let cleanupCount = 0;
    const sent: unknown[] = [];
    const handleCleanup = (
      ownerVfsIpc as unknown as {
        handleOwnerVfsCommitCleanup(options: {
          readonly message: unknown;
          readonly cleanup: (candidate: typeof terminal) => void;
          readonly send: (message: unknown) => void;
        }): void;
      }
    ).handleOwnerVfsCommitCleanup;
    const deliver = (): void => {
      handleCleanup({
        message: { type: 'rifty:owner-vfs-commit-cleanup', terminal },
        cleanup: (candidate) => {
          if (retained === null) return;
          expect(candidate).toEqual(retained);
          retained = null;
          cleanupCount += 1;
        },
        send: (message) => sent.push(message),
      });
    };

    deliver();
    sent.length = 0; // drop the first cleaned frame
    deliver();

    expect(cleanupCount).toBe(1);
    expect(retained).toBeNull();
    expect(sent).toEqual([{ type: 'rifty:owner-vfs-commit-cleaned', terminal }]);
  });

  it('round-trips an exact large-file version conflict as its domain class', async () => {
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
      admit: () =>
        Promise.resolve({
          type: 'rifty:owner-vfs-commit-ack',
          operationId: 'stale-save',
          ok: false,
          error: encodeOwnerVfsError(
            new VfsVersionConflictError({
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
            }),
          ),
        }),
      send: (message) => sent.push(message),
    });
    await Promise.resolve();

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
    expect(sent[2]).toMatchObject({
      ok: false,
      error: { kind: 'persistence-failure', name: 'PersistFailureError' },
    });
    expect(sent).not.toContainEqual(expect.objectContaining({ ok: true }));
  });
});
