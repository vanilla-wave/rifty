import { afterEach, describe, expect, it, vi } from 'vitest';
import { type OwnerVfsClientOutboundFrame, createOwnerVfsClient } from './owner-vfs-client.ts';
import type { OwnerVfsCommitReleasedMessage, OwnerVfsCommitTerminal } from './owner-vfs-ipc.ts';
import type { HostCommitAck, HostCommitRequest, OwnerEpoch } from './owner-vfs-protocol.ts';
import { OperationIdReuseError, VfsCommitAppliedError } from './owner-vfs-protocol.ts';

function success(request: HostCommitRequest, revision = 1): OwnerVfsCommitTerminal {
  const paths =
    request.kind === 'rename'
      ? [
          { path: request.sourcePath, version: null },
          { path: request.targetPath, version: `v${revision}` },
        ]
      : [
          {
            path: request.path,
            version: request.kind === 'remove' ? null : `v${revision}`,
          },
        ];
  return {
    type: 'rifty:owner-vfs-commit-ack',
    operationId: request.operationId,
    ok: true,
    ack: {
      operationId: request.operationId,
      ownerEpoch: 'owner-a',
      treeRevision: revision,
      versions: paths,
    },
  };
}

function harness() {
  const sent: OwnerVfsClientOutboundFrame[] = [];
  const protocolErrors: Error[] = [];
  let alive = true;
  let epoch: OwnerEpoch | null = 'owner-a';
  let barrier = 0;
  let sendResult = true;
  const client = createOwnerVfsClient({
    send(frame) {
      sent.push(structuredClone(frame));
      return sendResult;
    },
    currentOwnerEpoch: () => epoch,
    isAlive: () => alive,
    generateBarrierId: () => `barrier-${++barrier}`,
    timers: {
      setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
      clearTimeout: (timer) => clearTimeout(timer),
    },
    commitReplayMs: 10,
    commitAckTimeoutMs: 20,
    commitReceiptRetryMs: 10,
    durabilityAckTimeoutMs: 20,
    reportProtocolError: (error) => protocolErrors.push(error),
  });
  return {
    client,
    sent,
    protocolErrors,
    setAlive(value: boolean) {
      alive = value;
    },
    setEpoch(value: OwnerEpoch | null) {
      epoch = value;
    },
    setSendResult(value: boolean) {
      sendResult = value;
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('OwnerVfsClient', () => {
  it('defaults the first-terminal deadline to the full 60-second owner drain window', () => {
    const delays: number[] = [];
    const client = createOwnerVfsClient({
      send: () => true,
      currentOwnerEpoch: () => 'owner-a',
      isAlive: () => true,
      timers: {
        setTimeout: (_callback, delayMs) => {
          delays.push(delayMs);
          return Object.freeze({}) as ReturnType<typeof setTimeout>;
        },
        clearTimeout: () => {},
      },
    });
    const applying = client.applyHostCommit({
      kind: 'mkdir',
      operationId: 'host-vfs:default-terminal-deadline',
      path: '/slow-owner',
      expectedVersion: null,
    });
    void applying.catch(() => {});

    expect(delays).toEqual([60_000, 250]);
    client.close();
  });

  // Fault class: unbounded-read. Replay improves delivery but cannot replace a
  // finite terminal deadline owned by the commit correlation map.
  it('times out a commit that never receives its first terminal', async () => {
    vi.useFakeTimers();
    const h = harness();
    const applying = h.client.applyHostCommit({
      kind: 'mkdir',
      operationId: 'host-vfs:hung-terminal',
      path: '/hung',
      expectedVersion: null,
    });
    void applying.catch(() => {});

    await vi.advanceTimersByTimeAsync(20);

    await expect(applying).rejects.toThrow(/commit ack.*timed out.*hung-terminal/i);
    const sentAtTimeout = h.sent.length;
    await vi.advanceTimersByTimeAsync(100);
    expect(h.sent).toHaveLength(sentAtTimeout);
  });

  it('retains a first terminal past the deadline until its exact release', async () => {
    vi.useFakeTimers();
    const h = harness();
    const request: HostCommitRequest = {
      kind: 'mkdir',
      operationId: 'host-vfs:delayed-release',
      path: '/delayed',
      expectedVersion: null,
    };
    const applying = h.client.applyHostCommit(request);
    void applying.catch(() => {});
    const terminal = success(request, 2);

    expect(h.client.accept(terminal)).toBe(true);
    await vi.advanceTimersByTimeAsync(50);
    expect(h.sent.filter((frame) => frame.type === 'rifty:owner-vfs-commit-received').length).toBe(
      6,
    );

    expect(h.client.accept({ type: 'rifty:owner-vfs-commit-released', terminal })).toBe(true);
    await expect(applying).resolves.toEqual(
      (terminal as Extract<typeof terminal, { ok: true }>).ack,
    );
  });

  it('owns exact request reuse and the receipt/release/cleanup handshake', async () => {
    vi.useFakeTimers();
    const h = harness();
    const bytes = new Uint8Array([1, 2, 3]);
    const request: HostCommitRequest = {
      kind: 'write',
      operationId: 'host-vfs:1',
      path: '/src/main.ts',
      data: bytes,
      expectedVersion: 'v0',
    };

    const applying = h.client.applyHostCommit(request);
    bytes[0] = 9;
    expect(h.sent).toEqual([
      {
        type: 'rifty:owner-vfs-commit',
        request: { ...request, data: new Uint8Array([1, 2, 3]) },
      },
    ]);
    expect(h.client.applyHostCommit({ ...request, data: new Uint8Array([1, 2, 3]) })).toBe(
      applying,
    );
    await expect(
      h.client.applyHostCommit({ ...request, data: new Uint8Array([1, 2, 4]) }),
    ).rejects.toBeInstanceOf(OperationIdReuseError);

    const terminal = success(request, 2);
    expect(h.client.accept(terminal)).toBe(true);
    expect(h.sent.at(-1)).toEqual({
      type: 'rifty:owner-vfs-commit-received',
      terminal,
    });
    let outcome = 'pending';
    void applying.then(() => {
      outcome = 'resolved';
    });
    await Promise.resolve();
    expect(outcome).toBe('pending');

    await vi.advanceTimersByTimeAsync(10);
    expect(h.sent.filter((frame) => frame.type === 'rifty:owner-vfs-commit-received')).toHaveLength(
      2,
    );
    const forged = success(request, 3);
    expect(h.client.accept({ type: 'rifty:owner-vfs-commit-released', terminal: forged })).toBe(
      true,
    );
    expect(outcome).toBe('pending');

    const released: OwnerVfsCommitReleasedMessage = {
      type: 'rifty:owner-vfs-commit-released',
      terminal,
    };
    expect(h.client.accept(released)).toBe(true);
    await expect(applying).resolves.toEqual(
      (terminal as Extract<typeof terminal, { ok: true }>).ack,
    );
    expect(h.sent.at(-1)).toEqual({ type: 'rifty:owner-vfs-commit-cleanup', terminal });

    await vi.advanceTimersByTimeAsync(10);
    expect(h.sent.filter((frame) => frame.type === 'rifty:owner-vfs-commit-cleanup')).toHaveLength(
      2,
    );
    expect(h.client.accept({ type: 'rifty:owner-vfs-commit-cleaned', terminal })).toBe(true);
    const afterCleaned = h.sent.length;
    await vi.advanceTimersByTimeAsync(100);
    expect(h.sent).toHaveLength(afterCleaned);
  });

  it('retains valid applied evidence from a malformed terminal', async () => {
    const h = harness();
    const request: HostCommitRequest = {
      kind: 'remove',
      operationId: 'host-vfs:applied',
      path: '/src/main.ts',
      expectedVersion: 'v1',
    };
    const applying = h.client.applyHostCommit(request);
    const ack: HostCommitAck = {
      operationId: request.operationId,
      ownerEpoch: 'owner-a',
      treeRevision: 4,
      versions: [{ path: request.path, version: null }],
    };

    expect(
      h.client.accept({
        type: 'rifty:owner-vfs-commit-ack',
        operationId: request.operationId,
        ok: 'invalid',
        applied: ack,
      }),
    ).toBe(true);
    const receipt = h.sent.at(-1);
    expect(receipt?.type).toBe('rifty:owner-vfs-commit-received');
    if (receipt?.type !== 'rifty:owner-vfs-commit-received') {
      throw new Error('missing retained terminal receipt');
    }
    expect(receipt.terminal).toMatchObject({ ok: false, applied: ack });
    expect(
      h.client.accept({ type: 'rifty:owner-vfs-commit-released', terminal: receipt.terminal }),
    ).toBe(true);

    const failure = await applying.catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(VfsCommitAppliedError);
    expect(failure).toMatchObject({ applied: ack, cause: { name: 'VfsCommitProtocolError' } });
  });

  it('replays divergent evidence and binds durability to an exact barrier', async () => {
    vi.useFakeTimers();
    const h = harness();
    const request: HostCommitRequest = {
      kind: 'mkdir',
      operationId: 'host-vfs:replay',
      path: '/assets',
      expectedVersion: null,
    };
    const applying = h.client.applyHostCommit(request);
    const candidate = success(request, 2);
    if (!candidate.ok) throw new Error('expected success');
    const divergent = { ...candidate, ack: { ...candidate.ack, ownerEpoch: 'owner-b' } };
    expect(h.client.accept(divergent)).toBe(true);
    expect(h.protocolErrors).toHaveLength(1);
    expect(h.sent.filter((frame) => frame.type === 'rifty:owner-vfs-commit')).toHaveLength(2);

    const terminal = success(request, 2);
    h.client.accept(terminal);
    h.client.accept({ type: 'rifty:owner-vfs-commit-released', terminal });
    await expect(applying).resolves.toMatchObject({ ownerEpoch: 'owner-a', treeRevision: 2 });

    const durable = h.client.durabilityBarrier(2);
    expect(h.sent.at(-1)).toEqual({
      type: 'rifty:owner-vfs-durability',
      barrierId: 'barrier-1',
      ownerEpoch: 'owner-a',
      treeRevision: 2,
    });
    expect(
      h.client.accept({
        type: 'rifty:owner-vfs-durability-ack',
        barrierId: 'unrelated',
        ok: true,
        receipt: { ownerEpoch: 'owner-a', treeRevision: 2, durability: 'durable' },
      }),
    ).toBe(true);
    h.client.accept({
      type: 'rifty:owner-vfs-durability-ack',
      barrierId: 'barrier-1',
      ok: true,
      receipt: { ownerEpoch: 'owner-a', treeRevision: 2, durability: 'durable' },
    });
    await expect(durable).resolves.toEqual({
      ownerEpoch: 'owner-a',
      treeRevision: 2,
      durability: 'durable',
    });

    const timedOut = h.client.durabilityBarrier(3);
    const timeoutFailure = expect(timedOut).rejects.toThrow(
      'owner VFS durability ack timed out (barrier-2)',
    );
    await vi.advanceTimersByTimeAsync(20);
    await timeoutFailure;
  });

  it('disconnects every admitted operation, clears retries, and fences future work', async () => {
    vi.useFakeTimers();
    const h = harness();
    const applying = h.client.applyHostCommit({
      kind: 'mkdir',
      operationId: 'host-vfs:exit',
      path: '/assets',
      expectedVersion: null,
    });
    const durable = h.client.durabilityBarrier(1);
    const sentBeforeExit = h.sent.length;
    h.setAlive(false);
    h.client.disconnect();

    await expect(applying).rejects.toThrow(
      'workspace owner exited before conditional VFS commit ack (host-vfs:exit)',
    );
    await expect(durable).rejects.toThrow(
      'workspace owner exited before VFS durability ack (barrier-1)',
    );
    await vi.advanceTimersByTimeAsync(100);
    expect(h.sent).toHaveLength(sentBeforeExit);
    await expect(
      h.client.applyHostCommit({
        kind: 'mkdir',
        operationId: 'host-vfs:future',
        path: '/future',
        expectedVersion: null,
      }),
    ).rejects.toThrow('workspace owner has exited — conditional VFS commit was not applied');
    await expect(h.client.durabilityBarrier(2)).rejects.toThrow(
      'workspace owner has exited — VFS durability cannot be proven',
    );
  });

  it('preserves the caller-owned disconnect cause for pending and future VFS operations', async () => {
    vi.useFakeTimers();
    const h = harness();
    const applying = h.client.applyHostCommit({
      kind: 'mkdir',
      operationId: 'host-vfs:disconnect-provenance',
      path: '/assets',
      expectedVersion: null,
    });
    const durable = h.client.durabilityBarrier(1);
    const disconnectCause = new Error('exact project owner disconnect');
    const pending = [applying, durable].map((operation) =>
      operation.then(
        () => null,
        (error: unknown) => error,
      ),
    );

    h.setAlive(false);
    h.client.disconnect(disconnectCause);
    h.client.disconnect(new Error('later disconnect must not replace the first cause'));

    const future = [
      h.client.applyHostCommit({
        kind: 'mkdir',
        operationId: 'host-vfs:future-after-disconnect',
        path: '/future',
        expectedVersion: null,
      }),
      h.client.durabilityBarrier(2),
    ].map((operation) =>
      operation.then(
        () => null,
        (error: unknown) => error,
      ),
    );
    const outcomes = [...(await Promise.all(pending)), ...(await Promise.all(future))];
    expect(outcomes).toEqual(outcomes.map(() => disconnectCause));
  });
});
