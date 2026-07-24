import { afterEach, describe, expect, it, vi } from 'vitest';
import { type OwnerVfsClientOutboundFrame, createOwnerVfsClient } from './owner-vfs-client.ts';
import type { OwnerVfsCommitTerminal } from './owner-vfs-ipc.ts';
import type { HostCommitRequest, OwnerEpoch } from './owner-vfs-protocol.ts';
import {
  OperationIdReuseError,
  VfsCommitAppliedError,
  VfsCommitProtocolError,
} from './owner-vfs-protocol.ts';

function success(request: HostCommitRequest, revision = 1): OwnerVfsCommitTerminal {
  const versions =
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
      versions,
    },
  };
}

function harness() {
  const sent: OwnerVfsClientOutboundFrame[] = [];
  const protocolErrors: Error[] = [];
  let alive = true;
  let epoch: OwnerEpoch | null = 'owner-a';
  let sendResult = true;
  let barrier = 0;
  const client = createOwnerVfsClient({
    send(frame) {
      sent.push(structuredClone(frame));
      return sendResult;
    },
    currentOwnerEpoch: () => epoch,
    isAlive: () => alive,
    generateBarrierId: () => `barrier-${++barrier}`,
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

const request: HostCommitRequest = {
  kind: 'write',
  operationId: 'host-vfs:1',
  path: '/src/main.ts',
  expectedVersion: 'v0',
  data: new Uint8Array([1, 2, 3]),
};

afterEach(() => {
  vi.useRealTimers();
});

describe('OwnerVfsClient live-port contract', () => {
  it('sends an admitted mutation exactly once and accepts a delayed terminal', async () => {
    vi.useFakeTimers();
    const h = harness();
    const applying = h.client.applyHostCommit(request);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]).toEqual({ type: 'rifty:owner-vfs-commit', request });

    expect(h.client.accept(success(request, 2))).toBe(true);
    await expect(applying).resolves.toMatchObject({
      operationId: request.operationId,
      treeRevision: 2,
    });
    expect(h.sent).toHaveLength(1);
  });

  it('treats send=false as definitely not admitted', async () => {
    const h = harness();
    h.setSendResult(false);

    await expect(h.client.applyHostCommit(request)).rejects.toThrow(/send failed/i);
    expect(h.sent).toHaveLength(1);
  });

  it('settles admitted work only when peer death is confirmed', async () => {
    vi.useFakeTimers();
    const h = harness();
    const applying = h.client.applyHostCommit(request);
    let settled = false;
    void applying.catch(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(120_000);
    expect(settled).toBe(false);
    expect(h.sent).toHaveLength(1);

    const death = new Error('owner worker exited');
    h.setAlive(false);
    h.client.disconnect(death);
    await expect(applying).rejects.toBe(death);
  });

  it('settles malformed or mis-correlated terminals loudly without replay', async () => {
    const h = harness();
    const applying = h.client.applyHostCommit(request);
    const divergent = success(request, 2);
    if (!divergent.ok) throw new Error('test setup');

    expect(
      h.client.accept({
        ...divergent,
        ack: { ...divergent.ack, ownerEpoch: 'owner-b' },
      }),
    ).toBe(true);

    await expect(applying).rejects.toBeInstanceOf(VfsCommitProtocolError);
    expect(h.protocolErrors).toHaveLength(1);
    expect(h.sent).toHaveLength(1);
  });

  it('accepts applied evidence only when every request and owner fact correlates', async () => {
    const mismatched = harness();
    const mismatchedApply = mismatched.client.applyHostCommit(request);
    const terminal = success(request, 3);
    if (!terminal.ok) throw new Error('test setup');
    mismatched.client.accept({
      type: 'rifty:owner-vfs-commit-ack',
      operationId: request.operationId,
      ok: 'malformed',
      applied: { ...terminal.ack, ownerEpoch: 'forged-owner' },
    });
    await expect(mismatchedApply).rejects.toBeInstanceOf(VfsCommitProtocolError);
    await expect(mismatchedApply).rejects.not.toBeInstanceOf(VfsCommitAppliedError);

    const exact = harness();
    const exactApply = exact.client.applyHostCommit(request);
    exact.client.accept({
      type: 'rifty:owner-vfs-commit-ack',
      operationId: request.operationId,
      ok: 'malformed',
      applied: terminal.ack,
    });
    await expect(exactApply).rejects.toBeInstanceOf(VfsCommitAppliedError);
  });

  it('rejects every pending operation-id reuse without joining or resending', async () => {
    const h = harness();
    const first = h.client.applyHostCommit(request);
    const exactDuplicate = h.client.applyHostCommit({ ...request, data: request.data.slice() });
    const divergent = h.client.applyHostCommit({
      ...request,
      data: new Uint8Array([9]),
    });

    expect(exactDuplicate).not.toBe(first);
    await expect(exactDuplicate).rejects.toBeInstanceOf(OperationIdReuseError);
    await expect(divergent).rejects.toBeInstanceOf(OperationIdReuseError);
    expect(h.sent).toHaveLength(1);
    h.client.accept(success(request));
    await expect(first).resolves.toMatchObject({ operationId: request.operationId });
  });

  it('keeps the separate durability request deadline and correlation', async () => {
    vi.useFakeTimers();
    const h = harness();
    const durable = h.client.durabilityBarrier(7);
    void durable.catch(() => {});
    expect(h.sent.at(-1)).toEqual({
      type: 'rifty:owner-vfs-durability',
      barrierId: 'barrier-1',
      ownerEpoch: 'owner-a',
      treeRevision: 7,
    });

    await vi.advanceTimersByTimeAsync(20);
    await expect(durable).rejects.toThrow(/durability ack timed out/i);
  });

  it('preserves a caller-owned local close error for pending and future work', async () => {
    const h = harness();
    const pending = h.client.applyHostCommit(request);
    const closed = new Error('project session closed');
    h.client.close(closed);

    await expect(pending).rejects.toBe(closed);
    await expect(
      h.client.applyHostCommit({ ...request, operationId: 'host-vfs:later' }),
    ).rejects.toBe(closed);
  });
});
